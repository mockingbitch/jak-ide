use std::sync::Arc;

use axum::{extract::State, routing::get, Json, Router};
use serde_json::{json, Value};

use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/api/health", get(health))
}

async fn health(State(st): State<Arc<AppState>>) -> Json<Value> {
    Json(json!({
        "ok": true,
        "projectRoot": st.root().to_string_lossy(),
        "model": st.model,
        "hasApiKey": st.has_api_key,
        "desktop": st.desktop,
    }))
}
