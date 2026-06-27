use std::collections::BTreeSet;
use std::sync::Arc;

use axum::{routing::get, Json, Router};
use serde_json::{json, Value};

use crate::state::AppState;

const FALLBACK: &[&str] = &[
    "JetBrains Mono", "Fira Code", "Cascadia Code", "Source Code Pro", "Menlo", "Consolas",
    "DejaVu Sans Mono", "Ubuntu Mono", "Monaco", "monospace",
];

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/api/fonts", get(fonts))
}

async fn fonts() -> Json<Value> {
    let (list, source) = list_fonts();
    Json(json!({ "fonts": list, "source": source }))
}

/// Monospace families via fontconfig (`fc-list`), or a curated fallback.
fn list_fonts() -> (Vec<String>, &'static str) {
    if let Ok(out) = std::process::Command::new("fc-list").args([":spacing=mono", "family"]).output() {
        if out.status.success() {
            let mut set: BTreeSet<String> = BTreeSet::new();
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                if let Some(fam) = line.split(',').next() {
                    let f = fam.trim();
                    if !f.is_empty() {
                        set.insert(f.to_string());
                    }
                }
            }
            if !set.is_empty() {
                return (set.into_iter().collect(), "fontconfig");
            }
        }
    }
    (FALLBACK.iter().map(|s| s.to_string()).collect(), "fallback")
}
