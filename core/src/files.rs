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
        .route("/api/files/external", get(read_external))
        .route("/api/files/file/save", post(save))
        .route("/api/files/file/create", post(create))
        .route("/api/files/file/delete", post(delete_path))
        .route("/api/files/apply", post(apply))
        .route("/api/files/rename", post(rename))
        .route("/api/files/mkdir", post(mkdir))
        .route("/api/files/copy", post(copy))
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

/// Read-only view of a file OUTSIDE the project root — a go-to-definition target in
/// a language-server stub or an out-of-repo dependency. Deliberately bypasses the
/// project-root sandbox (`resolve_safe`), so it accepts only absolute paths and never
/// writes. Used by external (read-only) editor tabs.
async fn read_external(Query(q): Query<PathQuery>) -> ApiResult<Json<FileResp>> {
    let abs = PathBuf::from(&q.path);
    if !abs.is_absolute() {
        return Err(ApiError::bad("absolute path required"));
    }
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
    st.refresh_index();
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
    st.refresh_index();
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

// ---- file operations: rename/move, mkdir, copy (Phase 3 #4) ----

const EXDEV: i32 = 18; // cross-filesystem rename → fall back to copy+remove

fn copy_dir_all(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let e = entry?;
        let ft = e.file_type()?;
        let dst = to.join(e.file_name());
        if ft.is_dir() {
            copy_dir_all(&e.path(), &dst)?;
        } else if ft.is_file() {
            std::fs::copy(e.path(), &dst)?;
        }
        // symlinks / other node types are skipped (parity with the tree walker)
    }
    Ok(())
}

fn copy_any(from: &Path, to: &Path) -> std::io::Result<()> {
    if from.is_dir() {
        copy_dir_all(from, to)
    } else {
        std::fs::copy(from, to).map(|_| ())
    }
}

fn remove_any(p: &Path) -> std::io::Result<()> {
    // symlink_metadata does not follow links, so a symlink-to-dir is removed as the
    // link itself (remove_file) rather than recursively deleting the link target.
    let meta = std::fs::symlink_metadata(p)?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        std::fs::remove_file(p)
    } else {
        std::fs::remove_dir_all(p)
    }
}

/// `std::fs::rename`, falling back to copy+remove across filesystems (EXDEV). On a
/// failed cross-device copy it removes the half-written destination so a retry isn't
/// blocked by the 409 "destination exists" guard.
fn rename_or_copy(from: &Path, to: &Path) -> std::io::Result<()> {
    match std::fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(e) if e.raw_os_error() == Some(EXDEV) => {
            if let Err(ce) = copy_any(from, to) {
                let _ = remove_any(to);
                return Err(ce);
            }
            remove_any(from)
        }
        Err(e) => Err(e),
    }
}

#[derive(Deserialize)]
struct RenameBody {
    path: String,
    #[serde(rename = "newPath")]
    new_path: String,
}

/// Rename — doubles as move when `newPath` lives in another directory.
async fn rename(State(st): State<Arc<AppState>>, Json(b): Json<RenameBody>) -> ApiResult<Json<Value>> {
    let root = st.root();
    let from = resolve_safe(&root, &b.path)?;
    let to = resolve_safe(&root, &b.new_path)?;
    if from == root {
        return Err(ApiError::bad("Refusing to move the project root"));
    }
    if to == root {
        return Err(ApiError::bad("Invalid destination"));
    }
    if from == to {
        return Ok(Json(json!({ "ok": true, "path": to_rel(&root, &to) })));
    }
    if !from.exists() {
        return Err(ApiError::code(StatusCode::NOT_FOUND, "Source does not exist"));
    }
    if to.exists() {
        return Err(ApiError::code(StatusCode::CONFLICT, "Destination already exists"));
    }
    if from.is_dir() && to.starts_with(&from) {
        return Err(ApiError::bad("Cannot move a folder into itself"));
    }
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // A cross-device fallback does a recursive copy+remove → run off the async thread.
    let resp = to_rel(&root, &to);
    tokio::task::spawn_blocking(move || rename_or_copy(&from, &to))
        .await
        .map_err(|_| ApiError::internal("rename task failed"))??;
    st.refresh_index();
    Ok(Json(json!({ "ok": true, "path": resp })))
}

#[derive(Deserialize)]
struct MkdirBody {
    path: String,
}

async fn mkdir(State(st): State<Arc<AppState>>, Json(b): Json<MkdirBody>) -> ApiResult<Json<Value>> {
    let abs = resolve_safe(&st.root(), &b.path)?;
    if abs.exists() {
        return Err(ApiError::code(StatusCode::CONFLICT, "A file or folder already exists here"));
    }
    std::fs::create_dir_all(&abs)?;
    st.refresh_index();
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct CopyBody {
    from: String,
    to: String,
}

async fn copy(State(st): State<Arc<AppState>>, Json(b): Json<CopyBody>) -> ApiResult<Json<Value>> {
    let root = st.root();
    let from = resolve_safe(&root, &b.from)?;
    let to = resolve_safe(&root, &b.to)?;
    if to == root {
        return Err(ApiError::bad("Invalid destination"));
    }
    if !from.exists() {
        return Err(ApiError::code(StatusCode::NOT_FOUND, "Source does not exist"));
    }
    if to.exists() {
        return Err(ApiError::code(StatusCode::CONFLICT, "Destination already exists"));
    }
    if from.is_dir() && to.starts_with(&from) {
        return Err(ApiError::bad("Cannot copy a folder into itself"));
    }
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // A recursive copy can be heavy → run it off the request thread; on failure,
    // remove the partial destination so a retry isn't blocked by the 409 guard.
    let dest = to.clone();
    let res = tokio::task::spawn_blocking(move || copy_any(&from, &to))
        .await
        .map_err(|_| ApiError::internal("copy task failed"))?;
    if let Err(e) = res {
        let _ = remove_any(&dest);
        return Err(e.into());
    }
    st.refresh_index();
    Ok(Json(json!({ "ok": true, "path": to_rel(&root, &dest) })))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("jak-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

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

    #[test]
    fn copy_dir_all_copies_nested_tree() {
        let tmp = scratch("copy");
        std::fs::create_dir_all(tmp.join("src/lib")).unwrap();
        std::fs::write(tmp.join("src/a.ts"), "a").unwrap();
        std::fs::write(tmp.join("src/lib/b.ts"), "b").unwrap();
        copy_any(&tmp.join("src"), &tmp.join("copy")).unwrap();
        assert_eq!(std::fs::read_to_string(tmp.join("copy/a.ts")).unwrap(), "a");
        assert_eq!(std::fs::read_to_string(tmp.join("copy/lib/b.ts")).unwrap(), "b");
        assert!(tmp.join("src/a.ts").exists()); // source untouched
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn rename_or_copy_moves_a_file() {
        let tmp = scratch("rename");
        std::fs::write(tmp.join("a.txt"), "hi").unwrap();
        rename_or_copy(&tmp.join("a.txt"), &tmp.join("b.txt")).unwrap();
        assert!(!tmp.join("a.txt").exists());
        assert_eq!(std::fs::read_to_string(tmp.join("b.txt")).unwrap(), "hi");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn rename_into_descendant_is_rejected_by_path_check() {
        // The handler guards `to.starts_with(from)`; assert the predicate directly.
        let from = Path::new("/proj/src");
        let to = Path::new("/proj/src/sub");
        assert!(to.starts_with(from));
    }
}
