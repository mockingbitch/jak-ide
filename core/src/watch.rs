//! Filesystem watcher (Stage 1b): triggers a debounced, in-place index refresh
//! when files are added/removed/renamed under the current project root, and
//! re-targets its watches on a project switch.
//!
//! Watches are registered per non-ignored directory (NonRecursive) rather than
//! one recursive watch on the root, so we never add inotify watches inside
//! node_modules / target / .git — keeping idle watch counts bounded.

use std::path::{Component, Path};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::Duration;

use ignore::WalkBuilder;
use notify::event::ModifyKind;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use crate::state::{ignored_dirs, AppState};

/// Quiet period before a burst of changes triggers a single reindex.
const DEBOUNCE: Duration = Duration::from_millis(400);

/// Internal events on the watcher thread's unified channel.
enum Msg {
    /// A relevant fs change occurred (path set changed somewhere).
    Changed,
    /// The project root switched; re-target watches.
    Reroot(std::path::PathBuf),
}

/// Spawn the watcher. Best-effort: if the OS watcher can't be created the index
/// still works (it just won't live-update until the next explicit refresh).
pub fn spawn(state: Arc<AppState>) {
    let (tx, rx) = channel::<Msg>();

    // Reroot path: `set_root` sends a PathBuf; forward it onto the unified channel
    // so the thread can select fs-events and reroots from one receiver.
    let (reroot_tx, reroot_rx) = channel::<std::path::PathBuf>();
    state.set_watch_tx(reroot_tx);
    {
        let tx = tx.clone();
        std::thread::spawn(move || {
            while let Ok(p) = reroot_rx.recv() {
                if tx.send(Msg::Reroot(p)).is_err() {
                    break;
                }
            }
        });
    }

    std::thread::spawn(move || {
        let mut current = state.root();
        let mut watcher = make_watcher(tx.clone(), &current);
        let mut dirty = false;
        loop {
            match rx.recv_timeout(DEBOUNCE) {
                Ok(Msg::Changed) => dirty = true,
                Ok(Msg::Reroot(p)) => {
                    current = p;
                    // Dropping the old watcher releases ALL its per-dir watches;
                    // a fresh one watches only the new project's tree.
                    watcher = make_watcher(tx.clone(), &current);
                    dirty = true;
                }
                Err(RecvTimeoutError::Timeout) => {
                    if dirty {
                        dirty = false;
                        // Pick up any directories created since the last walk.
                        if let Some(w) = watcher.as_mut() {
                            watch_tree(w, &current);
                        }
                        state.refresh_index();
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    });
}

/// Build a watcher whose callback forwards relevant changes onto `tx`, and watch
/// the current tree. Returns `None` if the OS watcher couldn't be created.
fn make_watcher(tx: Sender<Msg>, root: &Path) -> Option<RecommendedWatcher> {
    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<Event>| {
            if let Ok(ev) = res {
                if is_relevant(&ev) {
                    let _ = tx.send(Msg::Changed);
                }
            }
        },
        Config::default(),
    )
    .ok()?;
    watch_tree(&mut watcher, root);
    Some(watcher)
}

/// Register a NonRecursive watch on every non-ignored directory under `root`.
/// Idempotent: re-watching an already-watched path is a no-op replace, so this
/// is safe to call again to pick up newly created directories.
fn watch_tree(watcher: &mut RecommendedWatcher, root: &Path) {
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
    for dent in walker.flatten() {
        if dent.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            let _ = watcher.watch(dent.path(), RecursiveMode::NonRecursive);
        }
    }
}

/// Only create/remove/rename events change the file *set* (the index is
/// filename-only), and only outside ignored dirs. Content edits are skipped so
/// every save doesn't trigger a needless rebuild.
fn is_relevant(ev: &Event) -> bool {
    let kind_ok = matches!(
        ev.kind,
        EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(_))
    );
    if !kind_ok {
        return false;
    }
    let ignore = ignored_dirs();
    !ev.paths.iter().any(|p| {
        p.components()
            .any(|c| matches!(c, Component::Normal(s) if ignore.contains(s.to_string_lossy().as_ref())))
    })
}
