//! Code intelligence: PhpStorm-style project-wide navigation, starting with
//! PHP go-to-definition (Phase 1).
//!
//! Architecture (one file per concern, all pure below the HTTP layer):
//!   parser.rs        tree-sitter-php: declarations, namespace/use context
//!   refs.rs          what class/function does the cursor token reference?
//!   composer.rs      PSR-4 maps (composer.json + vendor autoload map)
//!   symbol_index.rs  in-memory FQN → declaration index, watcher-updated
//!   resolver.rs      PHP name-resolution rules → ranked candidates
//!   navigation.rs    request orchestration → wire-shaped locations
//!
//! Phase roadmap: 1 classes/functions (this) · 2 methods/properties/constants ·
//! 3 variables · 4 implementations/trait usage · 5 PHPDoc types + references.
//! The frontend merges these results with the PHP LSP's (intelephense), native
//! first — see frontend/src/lib/codeIntel/definitionProvider.ts.

pub mod composer;
pub mod navigation;
pub mod parser;
pub mod refs;
pub mod resolver;
pub mod symbol_index;
pub mod types;

use std::sync::Arc;

use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/intel/definition", post(definition))
        .route("/api/intel/symbol-at", post(symbol_at))
        .route("/api/intel/index", post(index_workspace))
        .route("/api/intel/reindex-file", post(reindex_file))
        .route("/api/intel/status", get(status))
}

#[derive(Deserialize)]
struct PositionBody {
    path: String,
    /// Live editor buffer, so unsaved edits resolve correctly (like /api/symbols).
    content: String,
    /// 1-based line.
    line: u32,
    /// 1-based UTF-16 column (Monaco's native convention).
    column: u32,
}

async fn definition(State(st): State<Arc<AppState>>, Json(b): Json<PositionBody>) -> ApiResult<Json<Value>> {
    crate::paths::resolve_safe(&st.root(), &b.path)?; // reject traversal early
    let root = st.root();
    let intel = st.intel.clone();
    // Parsing + resolution is CPU-bound → off the async worker (matches symbols.rs).
    let locations = tokio::task::spawn_blocking(move || {
        navigation::definition(&root, &intel, &b.path, &b.content, b.line, b.column)
    })
    .await
    .map_err(|_| ApiError::internal("definition task failed"))?;
    Ok(Json(json!({ "locations": locations })))
}

async fn symbol_at(State(_st): State<Arc<AppState>>, Json(b): Json<PositionBody>) -> ApiResult<Json<Value>> {
    let sym = tokio::task::spawn_blocking(move || navigation::symbol_at(&b.content, b.line, b.column))
        .await
        .map_err(|_| ApiError::internal("symbol task failed"))?;
    Ok(Json(match sym {
        Some(r) => json!({ "symbol": {
            "name": r.text,
            "kind": match r.kind { types::RefKind::ClassLike => "class", types::RefKind::Function => "function" },
            "fullyQualified": r.fully_qualified,
        }}),
        None => json!({ "symbol": null }),
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexBody {
    #[serde(default)]
    include_vendor: bool,
}

/// Kick off a full (re)index in the background; poll /api/intel/status.
async fn index_workspace(State(st): State<Arc<AppState>>, Json(b): Json<IndexBody>) -> Json<Value> {
    st.intel.set_include_vendor(b.include_vendor);
    st.reindex_intel();
    Json(json!({ "started": true }))
}

#[derive(Deserialize)]
struct FileBody {
    path: String,
}

async fn reindex_file(State(st): State<Arc<AppState>>, Json(b): Json<FileBody>) -> ApiResult<Json<Value>> {
    let abs = crate::paths::resolve_safe(&st.root(), &b.path)?;
    let intel = st.intel.clone();
    tokio::task::spawn_blocking(move || intel.handle_fs_paths(&[abs]))
        .await
        .map_err(|_| ApiError::internal("reindex task failed"))?;
    Ok(Json(json!({ "ok": true })))
}

async fn status(State(st): State<Arc<AppState>>) -> Json<Value> {
    let (root, stats, building) = st.intel.status();
    Json(json!({
        "root": root.to_string_lossy(),
        "indexing": building,
        "files": stats.files,
        "symbols": stats.symbols,
        "lastIndexMs": stats.last_index_ms,
    }))
}
