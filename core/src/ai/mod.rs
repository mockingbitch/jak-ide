//! AI feature: `POST /api/ai/chat` (SSE). Dispatches by auth method:
//!   - claude-code → native engine driving the `claude` CLI (claude_code.rs)
//!   - none        → a native "not connected" error event
//!   - apikey/oauth → native direct-API engine (direct.rs) when JAKIDE_NATIVE_AI=1,
//!     else reverse-proxied to Node (the verified default until the native engine
//!     is tested against a real API key).
//! The SSE event contract matches the Node `aiService` (text/thinking/tool_use/
//! tool_result/file_change/done/error).

mod claude_code;
mod direct;

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

/// Native Claude options surfaced in the UI (model + permission mode + effort).
#[derive(Deserialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct ChatOptions {
    /// Model alias/full name (e.g. "opus", "sonnet"); empty/"default" = the engine default.
    pub model: String,
    /// Claude Code permission mode: default | acceptEdits | auto | plan | bypassPermissions.
    pub permission_mode: String,
    /// Claude Code reasoning effort: low | medium | high | xhigh | max; empty/"default" = the CLI default.
    pub effort: String,
}

/// An attached image for the current turn (base64, no data: prefix).
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Image {
    pub media_type: String,
    pub data: String,
}

#[derive(Deserialize)]
struct ChatBody {
    messages: Option<Vec<ChatMsg>>,
    #[serde(default)]
    context: Option<AiContext>,
    #[serde(default)]
    options: Option<ChatOptions>,
    #[serde(default)]
    images: Option<Vec<Image>>,
}

async fn chat(State(st): State<Arc<AppState>>, req: Request) -> Response {
    let method = resolve_method().await;
    let native_ai = std::env::var("JAKIDE_NATIVE_AI").map(|v| v == "1").unwrap_or(false);

    // Direct-API agent (apikey/oauth): native engine when opted in, else Node (the
    // verified default — the native path can't be tested without a real API key).
    if (method == "apikey" || method == "oauth") && !native_ai {
        return proxy::handler(State(st), req).await;
    }

    // claude-code / none / native apikey|oauth are handled here. Parse the body now.
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
    let options = body.options.unwrap_or_default();
    let images = body.images.unwrap_or_default();

    let (tx, rx) = mpsc::channel::<Event>(64);
    let root = st.root();
    if method == "claude-code" {
        tokio::spawn(async move {
            claude_code::stream(messages, ctx, images, options, root, tx).await;
        });
    } else if method == "apikey" || method == "oauth" {
        // native direct-API engine (reached only when JAKIDE_NATIVE_AI=1)
        let default_model = st.model.clone();
        tokio::spawn(async move {
            direct::stream(messages, ctx, images, options, root, default_model, tx).await;
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
