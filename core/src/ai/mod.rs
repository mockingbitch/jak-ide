//! AI feature: `POST /api/ai/chat` (SSE). Dispatches by auth method:
//!   - claude-code → native engine driving the `claude` CLI (claude_code.rs)
//!   - none        → a native "not connected" error event
//!   - apikey/oauth → reverse-proxied to Node (direct-API agent not yet ported)
//! The SSE event contract matches the Node `aiService` (text/thinking/tool_use/
//! tool_result/file_change/done/error).

mod claude_code;

use std::convert::Infallible;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::Router;
use serde::Deserialize;
use serde_json::json;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tokio_stream::StreamExt;

use crate::auth::resolve_method;
use crate::proxy;
use crate::state::AppState;

const MAX_BODY: usize = 32 * 1024 * 1024;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/api/ai/chat", post(chat))
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiContext {
    pub file_path: Option<String>,
    #[allow(dead_code)] // used by the direct-API engine (not yet ported)
    pub file_content: Option<String>,
    pub selection: Option<Selection>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub start_line: i64,
    #[serde(default)]
    pub end_line: i64,
}

#[derive(Deserialize)]
struct ChatMsg {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct ChatBody {
    messages: Option<Vec<ChatMsg>>,
    #[serde(default)]
    context: Option<AiContext>,
}

async fn chat(State(st): State<Arc<AppState>>, req: Request) -> Response {
    let method = resolve_method().await;

    // Direct-API agent (apikey/oauth) is still served by Node — forward as-is.
    if method == "apikey" || method == "oauth" {
        return proxy::handler(State(st), req).await;
    }

    // claude-code / none are handled natively. Parse the body now.
    let bytes = match axum::body::to_bytes(req.into_parts().1, MAX_BODY).await {
        Ok(b) => b,
        Err(_) => return (StatusCode::PAYLOAD_TOO_LARGE, "request body too large").into_response(),
    };
    let body: ChatBody = match serde_json::from_slice(&bytes) {
        Ok(b) => b,
        Err(_) => return bad_request(),
    };
    let Some(raw_messages) = body.messages else { return bad_request() };
    let messages: Vec<(String, String)> = raw_messages
        .into_iter()
        .filter(|m| m.role == "user" || m.role == "assistant")
        .map(|m| (m.role, m.content))
        .collect();
    let ctx = body.context.unwrap_or_default();

    let (tx, rx) = mpsc::channel::<Event>(64);
    if method == "claude-code" {
        let root = st.root();
        tokio::spawn(async move {
            claude_code::stream(messages, ctx, root, tx).await;
        });
    } else {
        // none → emit the "not connected" guidance, then done.
        tokio::spawn(async move {
            let _ = tx
                .send(Event::default().data(
                    json!({
                        "type": "error",
                        "error": "Not connected to Claude. Sign in with Anthropic, log into Claude Code (run `claude`), or set ANTHROPIC_API_KEY."
                    })
                    .to_string(),
                ))
                .await;
            let _ = tx.send(Event::default().data(json!({ "type": "done" }).to_string())).await;
        });
    }

    let stream = ReceiverStream::new(rx).map(Ok::<Event, Infallible>);
    Sse::new(stream).keep_alive(KeepAlive::default()).into_response()
}

fn bad_request() -> Response {
    (StatusCode::BAD_REQUEST, [(axum::http::header::CONTENT_TYPE, "application/json")], Body::from(json!({ "error": "messages array is required" }).to_string()))
        .into_response()
}
