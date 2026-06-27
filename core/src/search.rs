use std::path::Path;
use std::sync::Arc;

use axum::{
    extract::{Query, State},
    routing::{get, post},
    Json, Router,
};
use grep_regex::RegexMatcherBuilder;
use grep_searcher::sinks::UTF8;
use grep_searcher::{BinaryDetection, SearcherBuilder};
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::state::{ignored_dirs, AppState};

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/search/files", get(search_files))
        .route("/api/search/text", get(search_text))
        .route("/api/index/refresh", post(refresh_index))
}

#[derive(Deserialize)]
struct SearchQuery {
    q: Option<String>,
    limit: Option<usize>,
}

async fn search_files(State(st): State<Arc<AppState>>, Query(q): Query<SearchQuery>) -> Json<Value> {
    let limit = q.limit.unwrap_or(50).min(500);
    let results = st.index.search(q.q.as_deref().unwrap_or(""), limit);
    Json(json!({ "results": results }))
}

#[derive(Serialize)]
struct Hit {
    path: String,
    line: u64,
    text: String,
}

async fn search_text(State(st): State<Arc<AppState>>, Query(q): Query<SearchQuery>) -> Json<Value> {
    let query = q.q.unwrap_or_default();
    if query.trim().is_empty() {
        return Json(json!({ "results": [] }));
    }
    let limit = q.limit.unwrap_or(200).min(2000);
    let root = st.root();
    let hits = tokio::task::spawn_blocking(move || search_text_impl(&root, &query, limit))
        .await
        .unwrap_or_default();
    Json(json!({ "results": hits }))
}

/// Content search across the project (ripgrep libs): literal, case-insensitive,
/// gitignore-aware, pruning ignored dirs, bounded to `limit` total matches.
fn search_text_impl(root: &Path, query: &str, limit: usize) -> Vec<Hit> {
    let matcher = match RegexMatcherBuilder::new().case_insensitive(true).fixed_strings(true).build(query) {
        Ok(m) => m,
        Err(_) => return Vec::new(),
    };
    let ignore = ignored_dirs();
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_global(false)
        .parents(false)
        .filter_entry(move |e| {
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            !(is_dir && ignore.contains(e.file_name().to_string_lossy().as_ref()))
        })
        .build();

    // One reusable searcher with binary detection (skip binary files instead of
    // dumping garbage / aborting mid-file).
    let mut searcher = SearcherBuilder::new().binary_detection(BinaryDetection::quit(b'\x00')).build();
    let mut out: Vec<Hit> = Vec::new();
    for dent in walker.flatten() {
        if out.len() >= limit {
            break;
        }
        if !dent.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        // posix rel path; skip non-UTF8 paths the editor can't round-trip
        let rel = match dent.path().strip_prefix(root).ok().and_then(|p| p.to_str()) {
            Some(s) => s.replace('\\', "/"),
            None => continue,
        };
        let _ = searcher.search_path(
            &matcher,
            dent.path(),
            UTF8(|lnum, line| {
                let t = line.trim_end_matches(['\n', '\r']);
                // cap a single match line so a minified/no-newline file can't emit megabytes
                let text = if t.len() > 500 {
                    let mut end = 500;
                    while !t.is_char_boundary(end) {
                        end -= 1;
                    }
                    t[..end].to_string()
                } else {
                    t.to_string()
                };
                out.push(Hit { path: rel.clone(), line: lnum, text });
                Ok(out.len() < limit)
            }),
        );
    }
    out
}

async fn refresh_index(State(st): State<Arc<AppState>>) -> Json<Value> {
    let root = st.root();
    let idx = st.index.clone();
    let _ = tokio::task::spawn_blocking(move || idx.rebuild(&root)).await;
    Json(json!({ "ok": true, "count": st.index.len() }))
}
