use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, RwLock};

use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;
use ignore::WalkBuilder;
use rusqlite::Connection;

use crate::state::ignored_dirs;

/// A project file index: an on-disk SQLite cache plus an in-memory snapshot of
/// relative paths used for fast fuzzy filename search. Rebuilt on startup and
/// on project switch (walk respects .gitignore + the IGNORE_DIRS set).
pub struct FileIndex {
    db: Mutex<Connection>,
    paths: RwLock<Vec<String>>,
    /// Monotonic rebuild token — only the latest rebuild is allowed to commit,
    /// so a slow walk of an old project can't clobber a newer project's index.
    gen: AtomicU64,
}

impl FileIndex {
    /// Open (or create) the index DB under ~/.jakide and load any cached paths.
    pub fn open() -> Self {
        let conn = home_db().unwrap_or_else(|| Connection::open_in_memory().expect("sqlite mem"));
        Self::with_conn(conn)
    }

    fn with_conn(conn: Connection) -> Self {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY);
             CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);",
        )
        .ok();
        // Start empty: the shared DB cache may belong to a *different* project,
        // so we never seed from it (the startup/switch reindex repopulates within
        // a moment; search just returns empty until then). Avoids wrong-project hits.
        Self { db: Mutex::new(conn), paths: RwLock::new(Vec::new()), gen: AtomicU64::new(0) }
    }

    /// Empty the snapshot immediately (call on project switch so search never
    /// returns the previous project's paths during the rebuild window).
    pub fn clear(&self) {
        *self.paths.write().unwrap() = Vec::new();
    }

    /// Re-walk `root` and atomically replace the in-memory snapshot + SQLite cache.
    /// Superseded rebuilds (an older project still walking) are discarded.
    pub fn rebuild(&self, root: &Path) {
        let my_gen = self.gen.fetch_add(1, Ordering::SeqCst) + 1;
        let list = walk_files(root); // slow walk done WITHOUT holding any lock
        // Hold the DB lock across the snapshot write + the transaction so the
        // commit is atomic relative to other rebuilds (searches use a separate lock).
        let mut conn = match self.db.lock() {
            Ok(c) => c,
            Err(_) => return,
        };
        if my_gen < self.gen.load(Ordering::SeqCst) {
            return; // a newer rebuild started — drop this stale result
        }
        *self.paths.write().unwrap() = list.clone();
        // Bind the transaction to a named local (not an `if let` scrutinee) so its
        // borrow of `conn` ends before `conn` drops at function exit.
        let tx = match conn.transaction() {
            Ok(t) => t,
            Err(_) => return,
        };
        let _ = tx.execute("DELETE FROM files", []);
        if let Ok(mut stmt) = tx.prepare("INSERT OR IGNORE INTO files(path) VALUES (?1)") {
            for p in &list {
                let _ = stmt.execute([p]);
            }
        }
        let _ = tx.execute("INSERT OR REPLACE INTO meta(k,v) VALUES('root', ?1)", [root.to_string_lossy()]);
        let _ = tx.commit();
    }

    pub fn len(&self) -> usize {
        self.paths.read().unwrap().len()
    }

    /// Fuzzy filename search; empty query returns the first `limit` paths.
    pub fn search(&self, q: &str, limit: usize) -> Vec<String> {
        let paths = self.paths.read().unwrap();
        if q.trim().is_empty() {
            return paths.iter().take(limit).cloned().collect();
        }
        let matcher = SkimMatcherV2::default();
        let mut scored: Vec<(i64, &String)> =
            paths.iter().filter_map(|p| matcher.fuzzy_match(p, q).map(|s| (s, p))).collect();
        scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.len().cmp(&b.1.len())));
        scored.into_iter().take(limit).map(|(_, p)| p.clone()).collect()
    }
}

fn home_db() -> Option<Connection> {
    let dir = std::path::PathBuf::from(std::env::var("HOME").ok()?).join(".jakide");
    std::fs::create_dir_all(&dir).ok()?;
    Connection::open(dir.join("index.db")).ok()
}

/// Walk `root` for files, pruning ignored directories (so it never descends into
/// node_modules/.git/target/…) and honouring .gitignore. Returns posix rel paths.
fn walk_files(root: &Path) -> Vec<String> {
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

    let mut out = Vec::new();
    for dent in walker.flatten() {
        if dent.path() == root {
            continue;
        }
        // filter_entry already prunes ignored dirs; here just collect files.
        if dent.file_type().map(|t| t.is_file()).unwrap_or(false) {
            // posix rel path; skip non-UTF8 paths the editor can't round-trip
            if let Some(s) = dent.path().strip_prefix(root).ok().and_then(|p| p.to_str()) {
                out.push(s.replace('\\', "/"));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("jak-idx-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn rebuild_indexes_files_and_skips_ignored() {
        let root = tmp("rebuild");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::write(root.join("README.md"), "x").unwrap();
        std::fs::write(root.join("src/main.rs"), "fn main(){}").unwrap();
        std::fs::write(root.join("node_modules/pkg/index.js"), "junk").unwrap();

        let idx = FileIndex::with_conn(Connection::open_in_memory().unwrap());
        idx.rebuild(&root);
        let mut all = idx.search("", 100);
        all.sort();
        assert_eq!(all, vec!["README.md".to_string(), "src/main.rs".to_string()]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn fuzzy_search_ranks_matches() {
        let root = tmp("fuzzy");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/MergeEditor.tsx"), "").unwrap();
        std::fs::write(root.join("src/store.ts"), "").unwrap();
        let idx = FileIndex::with_conn(Connection::open_in_memory().unwrap());
        idx.rebuild(&root);
        let hits = idx.search("merge", 10);
        assert!(hits.first().map(|p| p.contains("MergeEditor")).unwrap_or(false));
        let _ = std::fs::remove_dir_all(&root);
    }
}
