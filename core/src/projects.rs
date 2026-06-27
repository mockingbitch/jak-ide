use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::{
    extract::{Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{ApiError, ApiResult};
use crate::paths::basename;
use crate::state::AppState;

const MAX_RECENTS: usize = 12;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/projects", get(get_projects))
        .route("/api/projects/open", post(open_project))
        .route("/api/projects/browse", get(browse))
}

fn home() -> PathBuf {
    std::env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("/"))
}
fn store_path() -> PathBuf {
    home().join(".jakide").join("projects.json")
}

fn load_recents() -> Vec<String> {
    std::fs::read_to_string(store_path())
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.get("recents").cloned())
        .and_then(|r| serde_json::from_value::<Vec<String>>(r).ok())
        .unwrap_or_default()
}

fn save_recents(recents: &[String]) {
    let path = store_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(path, serde_json::to_vec_pretty(&json!({ "recents": recents })).unwrap_or_default());
}

/// Push a folder to the front of the recents list (deduped, capped).
pub fn record_open(dir: &Path) {
    let abs = dir.to_string_lossy().to_string();
    let mut recents = load_recents();
    recents.retain(|p| p != &abs);
    recents.insert(0, abs);
    recents.truncate(MAX_RECENTS);
    save_recents(&recents);
}

#[derive(Serialize)]
struct RecentProject {
    path: String,
    name: String,
}

fn recents_existing() -> Vec<RecentProject> {
    load_recents()
        .into_iter()
        .filter(|p| Path::new(p).is_dir())
        .map(|p| {
            let name = basename(Path::new(&p));
            RecentProject { path: p, name }
        })
        .collect()
}

async fn get_projects(State(st): State<Arc<AppState>>) -> Json<Value> {
    let root = st.root();
    Json(json!({
        "current": root.to_string_lossy(),
        "name": basename(&root),
        "recents": recents_existing(),
    }))
}

#[derive(Deserialize)]
struct OpenBody {
    path: String,
}

async fn open_project(State(st): State<Arc<AppState>>, Json(b): Json<OpenBody>) -> ApiResult<Json<Value>> {
    if b.path.trim().is_empty() {
        return Err(ApiError::bad("path is required"));
    }
    let abs = PathBuf::from(&b.path);
    let meta = std::fs::metadata(&abs).map_err(|_| ApiError::bad(format!("No such directory: {}", b.path)))?;
    if !meta.is_dir() {
        return Err(ApiError::bad(format!("Not a directory: {}", b.path)));
    }
    st.set_root(abs.clone());
    record_open(&abs);
    st.reindex(); // refresh the file index for the new project
    Ok(Json(json!({ "ok": true, "current": abs.to_string_lossy(), "name": basename(&abs) })))
}

#[derive(Deserialize)]
struct BrowseQuery {
    path: Option<String>,
}

async fn browse(Query(q): Query<BrowseQuery>) -> ApiResult<Json<Value>> {
    let home = home();
    let target = q
        .path
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home.clone());
    let meta = std::fs::metadata(&target).map_err(|_| ApiError::bad(format!("Not a directory: {}", target.display())))?;
    if !meta.is_dir() {
        return Err(ApiError::bad(format!("Not a directory: {}", target.display())));
    }
    let mut entries: Vec<(String, String)> = std::fs::read_dir(&target)
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                .map(|e| e.file_name().to_string_lossy().to_string())
                .filter(|n| !n.starts_with('.'))
                .map(|n| (n.clone(), target.join(&n).to_string_lossy().to_string()))
                .collect()
        })
        .unwrap_or_default();
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    let parent = target.parent().filter(|p| *p != target).map(|p| p.to_string_lossy().to_string());
    Ok(Json(json!({
        "path": target.to_string_lossy(),
        "parent": parent,
        "home": home.to_string_lossy(),
        "entries": entries.into_iter().map(|(name, path)| json!({ "name": name, "path": path })).collect::<Vec<_>>(),
    })))
}
