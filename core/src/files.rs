use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{ApiError, ApiResult};
use crate::paths::{basename, resolve_safe, to_rel};
use crate::state::{ignored_dirs, AppState};

const MAX_DEPTH: usize = 8;
const MAX_ENTRIES: usize = 500;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/files/tree", get(tree))
        .route("/api/files/file", get(read_file))
        .route("/api/files/file/save", post(save))
        .route("/api/files/file/create", post(create))
        .route("/api/files/file/delete", post(delete_path))
        .route("/api/files/apply", post(apply))
}

#[derive(Serialize)]
struct TreeNode {
    name: String,
    path: String,
    #[serde(rename = "type")]
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    children: Option<Vec<TreeNode>>,
}

fn build_tree(root: &Path) -> TreeNode {
    let ignore = ignored_dirs();
    TreeNode {
        name: basename(root),
        path: String::new(),
        kind: "dir",
        children: Some(walk(root, root, 0, &ignore)),
    }
}

fn walk(dir: &Path, root: &Path, depth: usize, ignore: &HashSet<&str>) -> Vec<TreeNode> {
    if depth >= MAX_DEPTH {
        return vec![];
    }
    let mut entries: Vec<(bool, String, PathBuf)> = match std::fs::read_dir(dir) {
        Ok(rd) => rd
            .flatten()
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                let ft = e.file_type().ok()?;
                let is_dir = ft.is_dir();
                if name == ".git" || (is_dir && ignore.contains(name.as_str())) {
                    return None;
                }
                if !is_dir && !ft.is_file() {
                    return None;
                }
                Some((is_dir, name, e.path()))
            })
            .collect(),
        Err(_) => return vec![],
    };
    entries.truncate(MAX_ENTRIES);
    entries.sort_by(|a, b| {
        let (ad, bd) = (!a.0 as u8, !b.0 as u8); // dirs (false→0) first
        ad.cmp(&bd).then_with(|| a.1.cmp(&b.1))
    });
    entries
        .into_iter()
        .map(|(is_dir, name, abs)| {
            let path = to_rel(root, &abs);
            if is_dir {
                TreeNode { name, path, kind: "dir", children: Some(walk(&abs, root, depth + 1, ignore)) }
            } else {
                TreeNode { name, path, kind: "file", children: None }
            }
        })
        .collect()
}

async fn tree(State(st): State<Arc<AppState>>) -> Json<TreeNode> {
    let root = st.root();
    Json(tokio::task::spawn_blocking(move || build_tree(&root)).await.unwrap())
}

#[derive(Deserialize)]
struct PathQuery {
    path: String,
}

#[derive(Serialize)]
struct FileResp {
    content: String,
    path: String,
}

async fn read_file(State(st): State<Arc<AppState>>, Query(q): Query<PathQuery>) -> ApiResult<Json<FileResp>> {
    if q.path.is_empty() {
        return Err(ApiError::bad("path query param is required"));
    }
    let abs = resolve_safe(&st.root(), &q.path)?;
    let meta = std::fs::metadata(&abs)?;
    if !meta.is_file() {
        return Err(ApiError::bad("Not a file"));
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err(ApiError::code(StatusCode::PAYLOAD_TOO_LARGE, "File too large to open in the editor"));
    }
    let content = String::from_utf8_lossy(&std::fs::read(&abs)?).into_owned();
    Ok(Json(FileResp { content, path: q.path }))
}

#[derive(Deserialize)]
struct SaveBody {
    path: String,
    content: String,
}

async fn save(State(st): State<Arc<AppState>>, Json(b): Json<SaveBody>) -> ApiResult<Json<Value>> {
    let abs = resolve_safe(&st.root(), &b.path)?;
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&abs, b.content)?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct CreateBody {
    path: String,
    #[serde(default)]
    content: String,
}

async fn create(State(st): State<Arc<AppState>>, Json(b): Json<CreateBody>) -> ApiResult<Json<Value>> {
    let abs = resolve_safe(&st.root(), &b.path)?;
    if abs.exists() {
        return Err(ApiError::code(StatusCode::CONFLICT, "File already exists"));
    }
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&abs, b.content)?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct DeleteBody {
    path: String,
}

async fn delete_path(State(st): State<Arc<AppState>>, Json(b): Json<DeleteBody>) -> ApiResult<Json<Value>> {
    let root = st.root();
    let abs = resolve_safe(&root, &b.path)?;
    if abs == root {
        return Err(ApiError::bad("Refusing to delete the project root"));
    }
    if abs.is_dir() {
        std::fs::remove_dir_all(&abs)?;
    } else {
        std::fs::remove_file(&abs)?;
    }
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct Hunk {
    search: String,
    replace: String,
}

#[derive(Deserialize)]
struct ApplyBody {
    path: String,
    #[serde(rename = "type")]
    kind: Option<String>,
    hunks: Option<Vec<Hunk>>,
    content: Option<String>,
}

async fn apply(State(st): State<Arc<AppState>>, Json(b): Json<ApplyBody>) -> ApiResult<Json<Value>> {
    let abs = resolve_safe(&st.root(), &b.path)?;
    if b.kind.as_deref() == Some("create") {
        let content = b.content.unwrap_or_default();
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&abs, &content)?;
        return Ok(Json(json!({ "ok": true, "content": content })));
    }
    let hunks = b.hunks.ok_or_else(|| ApiError::bad("hunks array is required for an edit"))?;
    let mut content = String::from_utf8_lossy(&std::fs::read(&abs)?).into_owned();
    for h in hunks {
        if h.search.is_empty() {
            content = h.replace;
            continue;
        }
        match content.find(&h.search) {
            Some(idx) => content.replace_range(idx..idx + h.search.len(), &h.replace),
            None => {
                return Err(ApiError::code(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    format!("Could not locate the SEARCH block in {}. The file may have changed.", b.path),
                ))
            }
        }
    }
    std::fs::write(&abs, &content)?;
    Ok(Json(json!({ "ok": true, "content": content })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tree_lists_dirs_first_and_skips_ignored() {
        let tmp = std::env::temp_dir().join(format!("jak-tree-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join("src")).unwrap();
        std::fs::create_dir_all(tmp.join("node_modules")).unwrap();
        std::fs::write(tmp.join("z.txt"), "z").unwrap();
        std::fs::write(tmp.join("src/a.ts"), "a").unwrap();
        let t = build_tree(&tmp);
        let kids = t.children.unwrap();
        let names: Vec<_> = kids.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names, vec!["src", "z.txt"]); // node_modules skipped, dir before file
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
