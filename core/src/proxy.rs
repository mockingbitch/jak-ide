//! Reverse-proxy fallthrough (Stage 4). Any request not matched by a native
//! route is forwarded to the Node backend (ai/auth/run + the static renderer)
//! and its response is streamed back — so SSE (`/api/ai/chat`) flows through
//! unbuffered. This is the bridge that lets the Rust core become the front door
//! while Node still owns the not-yet-ported features; it is deleted at Stage 8.

use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};

use crate::state::AppState;

const MAX_REQUEST_BODY: usize = 32 * 1024 * 1024;

/// Headers that must not be copied verbatim — they describe the *previous*
/// connection/framing, which reqwest/axum re-derive for the new hop.
fn is_hop_by_hop(name: &str) -> bool {
    matches!(
        name,
        "host" | "content-length" | "connection" | "transfer-encoding" | "accept-encoding" | "keep-alive" | "upgrade"
    )
}

pub async fn handler(State(st): State<Arc<AppState>>, req: Request) -> Response {
    let (parts, body) = req.into_parts();
    let path_q = parts.uri.path_and_query().map(|p| p.as_str()).unwrap_or("/");
    let url = format!("{}{}", st.node_base(), path_q);

    // AI/auth/run requests carry a small JSON body (or none); collect it fully.
    let bytes = match axum::body::to_bytes(body, MAX_REQUEST_BODY).await {
        Ok(b) => b,
        Err(_) => return (StatusCode::PAYLOAD_TOO_LARGE, "proxy: request body too large").into_response(),
    };

    let method = reqwest::Method::from_bytes(parts.method.as_str().as_bytes()).unwrap_or(reqwest::Method::GET);
    let mut rb = st.http.request(method, &url).body(bytes.to_vec());
    for (name, value) in parts.headers.iter() {
        if is_hop_by_hop(name.as_str()) {
            continue;
        }
        rb = rb.header(name.as_str(), value.as_bytes());
    }

    let resp = match rb.send().await {
        Ok(r) => r,
        Err(e) => {
            return (StatusCode::BAD_GATEWAY, format!("proxy to backend failed: {e}")).into_response();
        }
    };

    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let mut headers = HeaderMap::new();
    for (name, value) in resp.headers().iter() {
        // Drop framing/length headers: we re-stream the body, so hyper sets these.
        if matches!(name.as_str(), "transfer-encoding" | "content-length" | "connection") {
            continue;
        }
        if let (Ok(hn), Ok(hv)) =
            (HeaderName::from_bytes(name.as_str().as_bytes()), HeaderValue::from_bytes(value.as_bytes()))
        {
            headers.append(hn, hv); // append: preserve multi-value headers (e.g. set-cookie)
        }
    }

    // Stream the response body — SSE keeps flowing token-by-token.
    let body = Body::from_stream(resp.bytes_stream());
    (status, headers, body).into_response()
}
