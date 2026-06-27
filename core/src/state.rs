use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::mpsc::Sender;
use std::sync::{Arc, RwLock};

use crate::index::FileIndex;

/// Directories never shown in the tree or walked (matches the Node IGNORE_DIRS).
pub fn ignored_dirs() -> HashSet<&'static str> {
    [
        "node_modules", ".git", "dist", "build", ".next", ".nuxt", ".cache", ".turbo", "vendor",
        "__pycache__", ".venv", "venv", ".idea", ".vscode", "coverage", "target", ".svelte-kit",
    ]
    .into_iter()
    .collect()
}

/// Shared server state. The project root is mutable at runtime (project switch).
pub struct AppState {
    root: RwLock<PathBuf>,
    pub model: String,
    pub has_api_key: bool,
    pub desktop: bool,
    pub index: Arc<FileIndex>,
    /// Set by the fs watcher; `set_root` pushes the new root so the watcher can
    /// re-target its watches on a project switch. `None` until the watcher spawns.
    watch_tx: RwLock<Option<Sender<PathBuf>>>,
}

impl AppState {
    pub fn from_env() -> Self {
        let raw = std::env::var("PROJECT_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default().join("workspace"));
        let root = if raw.is_absolute() {
            raw
        } else {
            std::env::current_dir().unwrap_or_default().join(raw)
        };
        std::fs::create_dir_all(&root).ok();
        Self {
            root: RwLock::new(root),
            model: std::env::var("ANTHROPIC_MODEL").unwrap_or_else(|_| "claude-opus-4-8".into()),
            has_api_key: std::env::var("ANTHROPIC_API_KEY").map(|v| !v.is_empty()).unwrap_or(false),
            desktop: std::env::var("JAKIDE_DESKTOP").map(|v| v == "1").unwrap_or(false),
            index: Arc::new(FileIndex::open()),
            watch_tx: RwLock::new(None),
        }
    }

    /// Full reindex for a project switch: clear the snapshot first so search never
    /// returns the previous project's paths during the (brief) rebuild window.
    pub fn reindex(&self) {
        self.index.clear();
        self.refresh_index();
    }

    /// Rebuild the index in place, off the request path, WITHOUT clearing first.
    /// Used by the fs watcher: `rebuild` swaps the snapshot atomically at the end,
    /// so a same-project refresh never blanks out search results mid-edit.
    pub fn refresh_index(&self) {
        let idx = self.index.clone();
        let root = self.root();
        std::thread::spawn(move || idx.rebuild(&root));
    }

    pub fn root(&self) -> PathBuf {
        self.root.read().unwrap().clone()
    }

    pub fn set_root(&self, p: PathBuf) {
        *self.root.write().unwrap() = p.clone();
        // Notify the fs watcher (if running) to re-target the new project.
        if let Some(tx) = self.watch_tx.read().unwrap().as_ref() {
            let _ = tx.send(p);
        }
    }

    /// Register the watcher's reroot channel (called once when the watcher spawns).
    pub fn set_watch_tx(&self, tx: Sender<PathBuf>) {
        *self.watch_tx.write().unwrap() = Some(tx);
    }
}
