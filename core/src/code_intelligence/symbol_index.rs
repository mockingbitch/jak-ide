//! Project-wide PHP symbol index: FQN → declaration locations, kept in memory
//! and updated incrementally by the fs watcher. Follows FileIndex's concurrency
//! recipe: slow work off-lock, atomic swap, and a monotonic generation token so
//! a stale rebuild of an old project can't clobber a newer project's index.
//!
//! `vendor/` is NOT walked by default — vendor definitions resolve via Composer
//! PSR-4 path computation (composer.rs) and are parsed on demand, then cached
//! here. `set_include_vendor(true)` opts in to a full vendor walk.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::RwLock;
use std::time::Instant;

use ignore::WalkBuilder;
use serde::Serialize;

use super::composer::ComposerMaps;
use super::parser::extract_declarations;
use super::types::SymbolKind;

/// Skip huge/generated PHP (index stays snappy; such files are never nav targets).
const MAX_PHP_BYTES: u64 = 1_500_000;

/// An indexed declaration (absolute path; API layer relativises).
#[derive(Debug, Clone)]
pub struct IndexedDecl {
    pub path: PathBuf,
    pub name: String,
    pub fqn: String,
    pub kind: SymbolKind,
    pub line: u32,
    pub col: u32,
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStats {
    pub files: usize,
    pub symbols: usize,
    pub last_index_ms: Option<u64>,
}

#[derive(Default)]
struct IndexData {
    root: PathBuf,
    /// Lowercased FQN → declarations (PHP class lookup is case-insensitive).
    by_fqn: HashMap<String, Vec<IndexedDecl>>,
    /// Lowercased short name → canonical lowercased FQNs (last-resort search).
    by_name: HashMap<String, Vec<String>>,
    /// Abs file → lowercased FQNs it declares (incremental invalidation).
    files: HashMap<PathBuf, Vec<String>>,
    composer: ComposerMaps,
    stats: IndexStats,
}

impl IndexData {
    fn insert(&mut self, path: &Path, decls: Vec<super::types::Declaration>) {
        let mut keys = Vec::with_capacity(decls.len());
        for d in decls {
            let key = d.fqn.to_lowercase();
            let short = d.name.to_lowercase();
            self.by_fqn.entry(key.clone()).or_default().push(IndexedDecl {
                path: path.to_path_buf(),
                name: d.name,
                fqn: d.fqn,
                kind: d.kind,
                line: d.line,
                col: d.col,
            });
            let names = self.by_name.entry(short).or_default();
            if !names.contains(&key) {
                names.push(key.clone());
            }
            keys.push(key);
        }
        self.files.insert(path.to_path_buf(), keys);
    }

    fn remove(&mut self, path: &Path) {
        let Some(keys) = self.files.remove(path) else { return };
        for key in keys {
            if let Some(list) = self.by_fqn.get_mut(&key) {
                list.retain(|d| d.path != path);
                if list.is_empty() {
                    self.by_fqn.remove(&key);
                    // The by_name key is the (lowercased) short name of this FQN;
                    // target it directly instead of scanning the whole map, and
                    // drop the entry entirely once empty (no leaked empty Vecs).
                    let short = key.rsplit('\\').next().unwrap_or(&key).to_string();
                    if let Some(names) = self.by_name.get_mut(&short) {
                        names.retain(|k| k != &key);
                        if names.is_empty() {
                            self.by_name.remove(&short);
                        }
                    }
                }
            }
        }
    }
}

pub struct SymbolIndex {
    inner: RwLock<IndexData>,
    gen: AtomicU64,
    building: AtomicBool,
    include_vendor: AtomicBool,
}

impl SymbolIndex {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(IndexData::default()),
            gen: AtomicU64::new(0),
            building: AtomicBool::new(false),
            include_vendor: AtomicBool::new(false),
        }
    }

    pub fn set_include_vendor(&self, v: bool) {
        self.include_vendor.store(v, Ordering::SeqCst);
    }

    /// Walk `root`, parse every PHP file, and atomically swap the index in.
    /// Superseded rebuilds (an older project still parsing) are discarded.
    pub fn rebuild(&self, root: &Path) {
        let my_gen = self.gen.fetch_add(1, Ordering::SeqCst) + 1;
        self.building.store(true, Ordering::SeqCst);
        let started = Instant::now();

        let mut data = IndexData { root: root.to_path_buf(), composer: ComposerMaps::load(root), ..Default::default() };
        for file in walk_php(root, self.include_vendor.load(Ordering::SeqCst)) {
            if self.gen.load(Ordering::SeqCst) != my_gen {
                // A newer rebuild started and owns the `building` flag now; abandon
                // this one WITHOUT clearing the flag (the winner clears it).
                return;
            }
            if let Ok(content) = std::fs::read_to_string(&file) {
                data.insert(&file, extract_declarations(&content));
            }
        }
        data.stats = IndexStats {
            files: data.files.len(),
            symbols: data.by_fqn.values().map(Vec::len).sum(),
            last_index_ms: Some(started.elapsed().as_millis() as u64),
        };

        let mut inner = self.inner.write().unwrap();
        if self.gen.load(Ordering::SeqCst) == my_gen {
            *inner = data;
            // Only the winning rebuild clears the flag; a superseded one must not
            // report "done" while the newer rebuild is still running.
            self.building.store(false, Ordering::SeqCst);
        }
    }

    /// Incremental update for watcher events: re-parse changed/created files,
    /// drop deleted ones. Applies the SAME exclusion rules as a full rebuild
    /// (vendor / storage / bootstrap-cache / size cap) so the index contents are
    /// identical whether a file was picked up incrementally or by a rebuild.
    pub fn handle_fs_paths(&self, paths: &[PathBuf]) {
        let (root, vendor_ok) = {
            let inner = self.inner.read().unwrap();
            (inner.root.clone(), self.include_vendor.load(Ordering::SeqCst))
        };
        if root.as_os_str().is_empty() {
            return; // no index built yet
        }
        for path in paths {
            let is_php = path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("php")).unwrap_or(false);
            if !is_php || !path.starts_with(&root) {
                continue;
            }
            let exists = path.is_file();
            // Existing files must pass the rebuild's filters; deletions always
            // remove (a file that was excluded simply isn't in the index anyway).
            if exists && !php_indexable(&root, path, vendor_ok) {
                continue;
            }
            // Parse OUTSIDE the write lock.
            let decls = if exists {
                std::fs::read_to_string(path).ok().map(|c| extract_declarations(&c))
            } else {
                None
            };
            let mut inner = self.inner.write().unwrap();
            inner.remove(path);
            if let Some(d) = decls {
                inner.insert(path, d);
            }
            inner.stats.files = inner.files.len();
            inner.stats.symbols = inner.by_fqn.values().map(Vec::len).sum();
        }
    }

    /// Exact (case-insensitive) FQN lookup.
    pub fn lookup_fqn(&self, fqn: &str) -> Vec<IndexedDecl> {
        let inner = self.inner.read().unwrap();
        inner.by_fqn.get(&fqn.to_lowercase()).cloned().unwrap_or_default()
    }

    /// Last-resort lookup by short name across all namespaces.
    pub fn lookup_name(&self, name: &str, limit: usize) -> Vec<IndexedDecl> {
        let inner = self.inner.read().unwrap();
        let Some(fqns) = inner.by_name.get(&name.to_lowercase()) else { return Vec::new() };
        fqns.iter()
            .filter_map(|k| inner.by_fqn.get(k))
            .flatten()
            .take(limit)
            .cloned()
            .collect()
    }

    /// Parse a file on demand (vendor targets resolved via PSR-4) and cache its
    /// declarations so repeat lookups are index-fast.
    pub fn parse_and_cache(&self, path: &Path) -> Vec<IndexedDecl> {
        if let Some(cached) = {
            let inner = self.inner.read().unwrap();
            inner.files.get(path).map(|keys| {
                keys.iter()
                    .filter_map(|k| inner.by_fqn.get(k))
                    .flatten()
                    .filter(|d| d.path == path)
                    .cloned()
                    .collect::<Vec<_>>()
            })
        } {
            return cached;
        }
        let Ok(content) = std::fs::read_to_string(path) else { return Vec::new() };
        let decls = extract_declarations(&content); // parse off the write lock
        let mut inner = self.inner.write().unwrap();
        // Double-checked: a concurrent definition request may have cached this
        // same file while we parsed — inserting again would duplicate its decls.
        if !inner.files.contains_key(path) {
            inner.insert(path, decls);
            inner.stats.symbols = inner.by_fqn.values().map(Vec::len).sum();
            // `files` count intentionally tracks the rebuild-walked set; vendor
            // files parsed on demand aren't part of the walked project.
        }
        inner
            .files
            .get(path)
            .map(|keys| {
                keys.iter()
                    .filter_map(|k| inner.by_fqn.get(k))
                    .flatten()
                    .filter(|d| d.path == path)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn composer_candidates(&self, fqn: &str) -> Vec<PathBuf> {
        self.inner.read().unwrap().composer.candidate_files(fqn)
    }

    pub fn status(&self) -> (PathBuf, IndexStats, bool) {
        let inner = self.inner.read().unwrap();
        (inner.root.clone(), inner.stats.clone(), self.building.load(Ordering::SeqCst))
    }
}

/// Directories excluded from PHP indexing, on top of the shared ignore set.
fn intel_ignored_dirs(include_vendor: bool) -> std::collections::HashSet<&'static str> {
    let mut ignore = crate::state::ignored_dirs();
    ignore.insert("storage"); // Laravel: logs/compiled views, never nav targets
    if include_vendor {
        ignore.remove("vendor");
    }
    ignore
}

/// Whether a specific existing PHP file should be indexed — the single source of
/// truth shared by `walk_php` (full rebuild) and `handle_fs_paths` (incremental),
/// so both agree on vendor / storage / bootstrap-cache / size-cap exclusions.
fn php_indexable(root: &Path, path: &Path, include_vendor: bool) -> bool {
    let is_php = path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("php")).unwrap_or(false);
    if !is_php {
        return false;
    }
    let Ok(rel) = path.strip_prefix(root) else { return false };
    let ignore = intel_ignored_dirs(include_vendor);
    let comps: Vec<&str> =
        rel.components().filter_map(|c| if let std::path::Component::Normal(s) = c { s.to_str() } else { None }).collect();
    if comps.iter().any(|c| ignore.contains(c)) {
        return false;
    }
    if comps.windows(2).any(|w| w == ["bootstrap", "cache"]) {
        return false;
    }
    !std::fs::metadata(path).map(|m| m.len() > MAX_PHP_BYTES).unwrap_or(false)
}

/// PHP files under `root`, pruning the shared ignore set (node_modules, .git,
/// storage, …). `vendor/` and Laravel's `bootstrap/cache` are skipped unless
/// `include_vendor` (vendor only) is set.
fn walk_php(root: &Path, include_vendor: bool) -> Vec<PathBuf> {
    let ignore = intel_ignored_dirs(include_vendor);
    let root_owned = root.to_path_buf();
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_global(false)
        .parents(false)
        .filter_entry(move |e| {
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if !is_dir {
                return true;
            }
            let name = e.file_name().to_string_lossy();
            if ignore.contains(name.as_ref()) {
                return false;
            }
            // Laravel's compiled-service cache.
            !(name == "cache" && e.path().parent().map(|p| p.ends_with("bootstrap") && p.starts_with(&root_owned)).unwrap_or(false))
        })
        .build();

    let mut out = Vec::new();
    for dent in walker.flatten() {
        let is_file = dent.file_type().map(|t| t.is_file()).unwrap_or(false);
        if !is_file {
            continue;
        }
        let is_php = dent.path().extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("php")).unwrap_or(false);
        if !is_php {
            continue;
        }
        if dent.metadata().map(|m| m.len() > MAX_PHP_BYTES).unwrap_or(false) {
            continue;
        }
        out.push(dent.into_path());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("jak-sidx-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn write(root: &Path, rel: &str, content: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, content).unwrap();
    }

    #[test]
    fn rebuild_indexes_php_and_skips_vendor_by_default() {
        let root = scratch("build");
        write(&root, "app/Models/User.php", "<?php namespace App\\Models; class User {}");
        write(&root, "app/helpers.php", "<?php function my_helper() {}");
        write(&root, "vendor/pkg/src/Thing.php", "<?php namespace Pkg; class Thing {}");
        write(&root, "storage/framework/views/abc.php", "<?php class Compiled {}");

        let idx = SymbolIndex::new();
        idx.rebuild(&root);

        assert_eq!(idx.lookup_fqn("App\\Models\\User").len(), 1);
        assert_eq!(idx.lookup_fqn("app\\models\\user").len(), 1); // case-insensitive
        assert_eq!(idx.lookup_fqn("my_helper").len(), 1);
        assert!(idx.lookup_fqn("Pkg\\Thing").is_empty()); // vendor skipped
        assert!(idx.lookup_fqn("Compiled").is_empty()); // storage skipped
        let (_, stats, building) = idx.status();
        assert_eq!(stats.files, 2);
        assert!(!building);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn include_vendor_opt_in() {
        let root = scratch("vend");
        write(&root, "vendor/pkg/src/Thing.php", "<?php namespace Pkg; class Thing {}");
        let idx = SymbolIndex::new();
        idx.set_include_vendor(true);
        idx.rebuild(&root);
        assert_eq!(idx.lookup_fqn("Pkg\\Thing").len(), 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn incremental_update_and_remove() {
        let root = scratch("incr");
        write(&root, "app/A.php", "<?php namespace App; class A {}");
        let idx = SymbolIndex::new();
        idx.rebuild(&root);
        assert_eq!(idx.lookup_fqn("App\\A").len(), 1);

        // Edit: A gains a sibling class B.
        write(&root, "app/A.php", "<?php namespace App; class A {} class B {}");
        idx.handle_fs_paths(&[root.join("app/A.php")]);
        assert_eq!(idx.lookup_fqn("App\\B").len(), 1);

        // New file.
        write(&root, "app/C.php", "<?php namespace App; class C {}");
        idx.handle_fs_paths(&[root.join("app/C.php")]);
        assert_eq!(idx.lookup_fqn("App\\C").len(), 1);

        // Delete.
        std::fs::remove_file(root.join("app/C.php")).unwrap();
        idx.handle_fs_paths(&[root.join("app/C.php")]);
        assert!(idx.lookup_fqn("App\\C").is_empty());
        assert!(idx.lookup_name("c", 5).is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn incremental_respects_exclusions() {
        let root = scratch("excl");
        write(&root, "app/A.php", "<?php namespace App; class A {}");
        let idx = SymbolIndex::new();
        idx.rebuild(&root);
        // A storage/ PHP file edit must NOT enter the index (parity with rebuild).
        write(&root, "storage/framework/views/x.php", "<?php class Compiled {}");
        idx.handle_fs_paths(&[root.join("storage/framework/views/x.php")]);
        assert!(idx.lookup_fqn("Compiled").is_empty());
        // A vendor/ file edit is likewise skipped when vendor isn't included.
        write(&root, "vendor/p/V.php", "<?php namespace P; class V {}");
        idx.handle_fs_paths(&[root.join("vendor/p/V.php")]);
        assert!(idx.lookup_fqn("P\\V").is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn parse_and_cache_is_idempotent() {
        let root = scratch("idem");
        write(&root, "vendor/x/C.php", "<?php namespace X; class C {}");
        let idx = SymbolIndex::new();
        idx.rebuild(&root);
        let file = root.join("vendor/x/C.php");
        idx.parse_and_cache(&file);
        idx.parse_and_cache(&file); // second call must not duplicate
        assert_eq!(idx.lookup_fqn("X\\C").len(), 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn lookup_by_short_name() {
        let root = scratch("short");
        write(&root, "a/User.php", "<?php namespace A; class User {}");
        write(&root, "b/User.php", "<?php namespace B; class User {}");
        let idx = SymbolIndex::new();
        idx.rebuild(&root);
        assert_eq!(idx.lookup_name("User", 10).len(), 2);
        assert_eq!(idx.lookup_name("user", 1).len(), 1); // limit respected
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn parse_and_cache_vendor_file() {
        let root = scratch("cache");
        write(&root, "vendor/x/C.php", "<?php namespace X; class C {}");
        let idx = SymbolIndex::new();
        idx.rebuild(&root);
        let file = root.join("vendor/x/C.php");
        let decls = idx.parse_and_cache(&file);
        assert_eq!(decls.len(), 1);
        assert_eq!(decls[0].fqn, "X\\C");
        // Cached now: lookup works without another parse.
        assert_eq!(idx.lookup_fqn("X\\C").len(), 1);
        let _ = std::fs::remove_dir_all(&root);
    }
}
