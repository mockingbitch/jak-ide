//! Git feature module: an axum router mounted at `/api/git/*`, mirroring the
//! Node `gitRouter`. Handlers stay thin — they extract params, call `ops`/`clone`
//! against the live project root, and serialise the same JSON the UI expects.

mod clone;
mod exec;
mod ops;

use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        // state
        .route("/api/git/status", get(status))
        .route("/api/git/branches", get(branches))
        .route("/api/git/log", get(log))
        .route("/api/git/diff", get(diff))
        .route("/api/git/remotes", get(remotes))
        .route("/api/git/blame", get(blame))
        .route("/api/git/commit-diff", get(commit_diff))
        .route("/api/git/conflict", get(conflict))
        // lifecycle
        .route("/api/git/init", post(init))
        .route("/api/git/clone", post(clone_repo))
        .route("/api/git/clone-stream", get(clone_stream))
        // staging / commit
        .route("/api/git/stage", post(stage))
        .route("/api/git/unstage", post(unstage))
        .route("/api/git/discard", post(discard))
        .route("/api/git/resolve", post(resolve))
        .route("/api/git/commit", post(commit))
        // branches
        .route("/api/git/branch", post(branch))
        .route("/api/git/checkout", post(checkout))
        .route("/api/git/checkout-remote", post(checkout_remote))
        .route("/api/git/branch/rename", post(branch_rename))
        .route("/api/git/branch/delete", post(branch_delete))
        .route("/api/git/merge", post(merge))
        // remote
        .route("/api/git/fetch", post(fetch))
        .route("/api/git/pull", post(pull))
        .route("/api/git/push", post(push))
}

fn ok() -> Json<Value> {
    Json(json!({ "ok": true }))
}

// --- state ---------------------------------------------------------------

async fn status(State(st): State<Arc<AppState>>) -> ApiResult<Json<ops::Status>> {
    Ok(Json(ops::status(&st.root()).await?))
}

async fn branches(State(st): State<Arc<AppState>>) -> ApiResult<Json<ops::Branches>> {
    Ok(Json(ops::branches(&st.root()).await?))
}

#[derive(Deserialize)]
struct LogQuery {
    limit: Option<usize>,
    skip: Option<usize>,
    file: Option<String>,
}

async fn log(State(st): State<Arc<AppState>>, Query(q): Query<LogQuery>) -> ApiResult<Json<Vec<ops::Commit>>> {
    let limit = q.limit.unwrap_or(80).min(500);
    let skip = q.skip.unwrap_or(0);
    let file = q.file.as_deref().filter(|s| !s.is_empty());
    Ok(Json(ops::log(&st.root(), limit, skip, file).await?))
}

#[derive(Deserialize)]
struct DiffQuery {
    path: Option<String>,
    mode: Option<String>,
}

async fn diff(State(st): State<Arc<AppState>>, Query(q): Query<DiffQuery>) -> ApiResult<Json<ops::FileDiff>> {
    let path = q.path.unwrap_or_default();
    if path.is_empty() {
        return Err(ApiError::bad("path is required"));
    }
    let mode = if q.mode.as_deref() == Some("staged") { "staged" } else { "working" };
    Ok(Json(ops::diff_file(&st.root(), &path, mode).await))
}

async fn remotes(State(st): State<Arc<AppState>>) -> Json<Vec<ops::Remote>> {
    Json(ops::remotes(&st.root()).await)
}

#[derive(Deserialize)]
struct PathQuery {
    path: Option<String>,
}

async fn blame(State(st): State<Arc<AppState>>, Query(q): Query<PathQuery>) -> ApiResult<Json<Vec<ops::BlameLine>>> {
    let path = q.path.unwrap_or_default();
    if path.is_empty() {
        return Err(ApiError::bad("path is required"));
    }
    Ok(Json(ops::blame(&st.root(), &path).await?))
}

#[derive(Deserialize)]
struct CommitDiffQuery {
    hash: Option<String>,
    path: Option<String>,
}

async fn commit_diff(
    State(st): State<Arc<AppState>>,
    Query(q): Query<CommitDiffQuery>,
) -> ApiResult<Json<ops::FileDiff>> {
    let hash = q.hash.unwrap_or_default();
    let path = q.path.unwrap_or_default();
    if hash.is_empty() || path.is_empty() {
        return Err(ApiError::bad("hash and path are required"));
    }
    Ok(Json(ops::commit_diff(&st.root(), &hash, &path).await))
}

async fn conflict(State(st): State<Arc<AppState>>, Query(q): Query<PathQuery>) -> ApiResult<Json<ops::Conflict>> {
    let path = q.path.unwrap_or_default();
    if path.is_empty() {
        return Err(ApiError::bad("path is required"));
    }
    Ok(Json(ops::conflict(&st.root(), &path).await))
}

// --- lifecycle -----------------------------------------------------------

async fn init(State(st): State<Arc<AppState>>) -> ApiResult<Json<Value>> {
    ops::init(&st.root()).await?;
    Ok(ok())
}

#[derive(Deserialize)]
struct CloneBody {
    url: Option<String>,
    parent: Option<String>,
    name: Option<String>,
}

async fn clone_repo(State(_st): State<Arc<AppState>>, Json(b): Json<CloneBody>) -> ApiResult<Json<Value>> {
    let url = b.url.unwrap_or_default();
    let parent = b.parent.unwrap_or_default();
    if url.is_empty() || parent.is_empty() {
        return Err(ApiError::bad("url and parent are required"));
    }
    let dest = clone::clone(&url, &parent, b.name.as_deref()).await?;
    Ok(Json(json!({ "ok": true, "path": dest })))
}

#[derive(Deserialize)]
struct CloneStreamQuery {
    url: Option<String>,
    parent: Option<String>,
    name: Option<String>,
}

async fn clone_stream(Query(q): Query<CloneStreamQuery>) -> Response {
    let url = q.url.unwrap_or_default();
    let parent = q.parent.unwrap_or_default();
    if url.is_empty() || parent.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "url and parent are required" }))).into_response();
    }
    let name = q.name.filter(|s| !s.is_empty());
    clone::clone_stream_response(url, parent, name).into_response()
}

// --- staging / commit ----------------------------------------------------

#[derive(Deserialize)]
struct StageBody {
    paths: Option<Vec<String>>,
    all: Option<bool>,
}

async fn stage(State(st): State<Arc<AppState>>, Json(b): Json<StageBody>) -> ApiResult<Json<Value>> {
    let root = st.root();
    if b.all.unwrap_or(false) {
        ops::stage_all(&root).await?;
    } else {
        ops::stage(&root, &b.paths.unwrap_or_default()).await?;
    }
    Ok(ok())
}

async fn unstage(State(st): State<Arc<AppState>>, Json(b): Json<StageBody>) -> ApiResult<Json<Value>> {
    let root = st.root();
    if b.all.unwrap_or(false) {
        ops::unstage_all(&root).await?;
    } else {
        ops::unstage(&root, &b.paths.unwrap_or_default()).await?;
    }
    Ok(ok())
}

#[derive(Deserialize)]
struct DiscardBody {
    paths: Option<Vec<String>>,
}

async fn discard(State(st): State<Arc<AppState>>, Json(b): Json<DiscardBody>) -> ApiResult<Json<Value>> {
    ops::discard(&st.root(), &b.paths.unwrap_or_default()).await?;
    Ok(ok())
}

#[derive(Deserialize)]
struct ResolveBody {
    path: Option<String>,
    side: Option<String>,
}

async fn resolve(State(st): State<Arc<AppState>>, Json(b): Json<ResolveBody>) -> ApiResult<Json<Value>> {
    let path = b.path.unwrap_or_default();
    let side = b.side.unwrap_or_default();
    if path.is_empty() || (side != "ours" && side != "theirs") {
        return Err(ApiError::bad("path and side (ours|theirs) are required"));
    }
    ops::resolve(&st.root(), &path, &side).await?;
    Ok(ok())
}

#[derive(Deserialize)]
struct CommitBody {
    message: Option<String>,
    amend: Option<bool>,
    paths: Option<Vec<String>>,
}

async fn commit(State(st): State<Arc<AppState>>, Json(b): Json<CommitBody>) -> ApiResult<Json<Value>> {
    let message = b.message.unwrap_or_default();
    if message.trim().is_empty() {
        return Err(ApiError::bad("commit message is required"));
    }
    let root = st.root();
    let out = match b.paths {
        Some(paths) if !paths.is_empty() => ops::commit_files(&root, &message, &paths).await?,
        _ => ops::commit(&root, &message, b.amend.unwrap_or(false)).await?,
    };
    Ok(Json(json!({ "ok": true, "output": out })))
}

// --- branches ------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BranchBody {
    name: Option<String>,
    checkout: Option<bool>,
    start_point: Option<String>,
}

async fn branch(State(st): State<Arc<AppState>>, Json(b): Json<BranchBody>) -> ApiResult<Json<Value>> {
    let name = b.name.unwrap_or_default();
    if name.is_empty() {
        return Err(ApiError::bad("name is required"));
    }
    let start = b.start_point.as_deref().filter(|s| !s.is_empty());
    ops::create_branch(&st.root(), &name, b.checkout != Some(false), start).await?;
    Ok(ok())
}

#[derive(Deserialize)]
struct NameBody {
    name: Option<String>,
}

async fn checkout(State(st): State<Arc<AppState>>, Json(b): Json<NameBody>) -> ApiResult<Json<Value>> {
    let name = b.name.unwrap_or_default();
    if name.is_empty() {
        return Err(ApiError::bad("name is required"));
    }
    ops::checkout(&st.root(), &name).await?;
    Ok(ok())
}

#[derive(Deserialize)]
struct CheckoutRemoteBody {
    remote: Option<String>,
}

async fn checkout_remote(State(st): State<Arc<AppState>>, Json(b): Json<CheckoutRemoteBody>) -> ApiResult<Json<Value>> {
    let remote = b.remote.unwrap_or_default();
    if remote.is_empty() {
        return Err(ApiError::bad("remote is required"));
    }
    ops::checkout_remote(&st.root(), &remote).await?;
    Ok(ok())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameBody {
    old_name: Option<String>,
    new_name: Option<String>,
}

async fn branch_rename(State(st): State<Arc<AppState>>, Json(b): Json<RenameBody>) -> ApiResult<Json<Value>> {
    let old_name = b.old_name.unwrap_or_default();
    let new_name = b.new_name.unwrap_or_default();
    if old_name.is_empty() || new_name.is_empty() {
        return Err(ApiError::bad("oldName and newName are required"));
    }
    ops::rename_branch(&st.root(), &old_name, &new_name).await?;
    Ok(ok())
}

#[derive(Deserialize)]
struct DeleteBody {
    name: Option<String>,
    force: Option<bool>,
}

async fn branch_delete(State(st): State<Arc<AppState>>, Json(b): Json<DeleteBody>) -> ApiResult<Json<Value>> {
    let name = b.name.unwrap_or_default();
    if name.is_empty() {
        return Err(ApiError::bad("name is required"));
    }
    ops::delete_branch(&st.root(), &name, b.force.unwrap_or(false)).await?;
    Ok(ok())
}

async fn merge(State(st): State<Arc<AppState>>, Json(b): Json<NameBody>) -> ApiResult<Json<Value>> {
    let name = b.name.unwrap_or_default();
    if name.is_empty() {
        return Err(ApiError::bad("name is required"));
    }
    let out = ops::merge(&st.root(), &name).await?;
    Ok(Json(json!({ "ok": true, "output": out })))
}

// --- remote --------------------------------------------------------------

async fn fetch(State(st): State<Arc<AppState>>) -> ApiResult<Json<Value>> {
    let out = ops::fetch(&st.root()).await?;
    Ok(Json(json!({ "ok": true, "output": out })))
}

#[derive(Deserialize, Default)]
struct PullBody {
    remote: Option<String>,
    branch: Option<String>,
    rebase: Option<bool>,
}

async fn pull(State(st): State<Arc<AppState>>, body: Option<Json<PullBody>>) -> ApiResult<Json<Value>> {
    let b = body.map(|Json(b)| b).unwrap_or_default();
    let remote = b.remote.as_deref().filter(|s| !s.is_empty());
    let branch = b.branch.as_deref().filter(|s| !s.is_empty());
    let out = ops::pull(&st.root(), remote, branch, b.rebase.unwrap_or(false)).await?;
    Ok(Json(json!({ "ok": true, "output": out })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PushBody {
    set_upstream: Option<bool>,
}

async fn push(State(st): State<Arc<AppState>>, Json(b): Json<PushBody>) -> ApiResult<Json<Value>> {
    let out = ops::push(&st.root(), b.set_upstream.unwrap_or(false)).await?;
    Ok(Json(json!({ "ok": true, "output": out })))
}
