# Changelog

All notable changes to JakIDE are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [0.2.1] — 2026-07-07

### Added
- **Chat code blocks are syntax-highlighted** — using Monaco's own colorizer, so
  they match the editor theme (no extra highlighter dependency). Each block also
  gets an **Insert** button (insert the snippet into the active editor at the
  cursor) alongside the existing Copy + language label.
- **Open File** in the Version Control context menu — open a changed file's
  working copy directly (vs. Show Diff).

### Fixed
- **Renamed/moved files** in Local Changes now show `newname ← old/path` (with the
  full `old → new` on hover) instead of only the new name, which looked like an
  unfamiliar/new file.

## [0.2.0] — 2026-07-07

Expands the Git tool window to a near-complete, PhpStorm-style VCS action set.

### Added
- **Local Changes context menu** — right-click a changed file for Show Diff,
  Stage / Unstage (with a staged indicator), Rollback, Show History, Annotate,
  and Copy (relative) Path; explicit `git` index staging alongside the
  checkbox-commit flow.
- **Stash manager** — list, create (with include-untracked / keep-index), apply,
  pop, drop, and show-diff.
- **History-affecting actions** — `reset` (soft / mixed / hard, with a guarded
  dialog), `clean` untracked (dry-run preview + confirm), `revert`, `cherry-pick`,
  and `rebase onto`; **Abort / Continue** for merge, rebase, cherry-pick, and
  revert, surfaced by an **in-progress banner** driven by live operation-state
  detection.
- **Git log commit context menu** — checkout revision, cherry-pick, revert,
  reset-current-to-here, new-branch-from-commit, and copy hash.
- **Remote management** — add / remove / edit remote URLs (credentials stay with
  the user's git credential helper; never stored by JakIDE).
- **Commit options** — amend, sign-off, and no-verify toggles in the commit panel
  (amend resets per commit, PhpStorm-style).
- A **VCS Operations** popup consolidating stash / remotes / reset / clean.

### Notes
- Every mutating action refreshes git status afterward; dangerous actions
  (reset --hard, clean, drop stash, rollback, remove remote) confirm first.
- New Rust `git/{stash,actions,remote_ops}` modules wrap the git CLI safely
  (argument arrays, no shell interpolation, injection/flag guards) with unit
  tests for the output parsers. Hardened via adversarial multi-agent review.

## [0.1.0] — 2026-07-06

First tagged release. JakIDE is a native (Electron) AI-first IDE with a Rust core
front door, a Monaco editor, an agentic Claude assistant, and PhpStorm-style
tooling. This release consolidates the initial UI, the Node→Rust core migration,
and the code-intelligence / git / merge feature set.

### Added

#### Editor & workspace
- PhpStorm-style shell: toggleable tool-window stripes, draggable splitters,
  split editor groups, multi-file tabs, status bar, persisted layout; frameless
  window with an in-app hamburger menu.
- Monaco editor with multi-language highlighting, markdown preview
  (Edit/Split/Preview, GFM, sanitized), and PhpStorm-style file icons.
- Themes (Darcula, IntelliJ Light, Dracula, Nord, One Dark, Solarized Dark),
  accent-colour picker, and an OS-installed code-font picker — applied live and
  saved locally. Categorized Settings modal.
- File explorer with open/edit/save/create/rename/delete/copy/mkdir and git
  status decorations on the tree.

#### Rust core (Node → Rust strangler-fig migration)
- `jakide-core` axum sidecar on `127.0.0.1:8787` is the front door for all
  `/api` + `/ws` traffic; unported routes reverse-proxy to the Node backend.
- Native modules: file engine + project management, SQLite-backed file index with
  fuzzy + ripgrep content search and a live fs watcher, spawn-git module (full
  `/api/git/*`), PTY terminal and streaming run-command over WebSockets, LSP
  transport bridge, auth, and a direct-API AI engine.
- Build/dev scripts resolve `cargo` without relying on `PATH`.

#### Code intelligence & navigation
- LSP over a WebSocket bridge: completion, hover, diagnostics, go-to-definition,
  and go-to-implementation for PHP (Intelephense), TypeScript/JavaScript,
  Python (Pyright), and Go (gopls); PHP/Python/TS servers bundled and packaged.
- Native PHP code intelligence (tree-sitter, in the Rust core): Ctrl/Cmd+Click
  go-to-definition for classes, interfaces, traits, enums, and functions, with
  namespace / `use` / alias / PSR-4 (composer) resolution, jumps into `vendor/`
  via the autoload map, results merged with the language server's (native first),
  and Back/Forward jump history (Ctrl/Cmd+Alt+←/→).
- Go to file, go to symbol, go to line; project-wide find-in-files and
  find & replace; a Problems panel aggregating LSP diagnostics + run output.

#### Git
- Git tool window: status, checkbox commit, **Commit** and **Commit & Push**,
  branch create/switch/rename/delete, fetch, Pull (merge/rebase dialog), push
  (auto-publishes upstream-less branches), commit-graph log, diff, blame, init,
  and streaming clone.
- PhpStorm-style **3-way merge conflict editor**: Ours │ Base │ Result │ Theirs,
  block-aligned panes, synced scroll, conflict highlighting + minimap markers,
  F7/Shift+F7 navigation with a conflict counter, Accept Ours/Theirs/Both and
  line-level resolution, gutter arrows, context menu, and an unresolved-conflict
  save guard.

#### AI assistant
- Agentic Claude assistant (Cursor-style) with self-directed tool calls
  (`list_dir`, `read_file`, `apply_edit`, `write_file`, `run_command`) shown as
  tool chips; three auth methods (API key, Claude Code CLI, Anthropic OAuth).
- Cursor-style tracked changes with per-file unified diff and Keep/Revert.
- Redesigned Claude-native AI panel: image attachments, model/permission options,
  SSE streaming with a live processing indicator and token counter, chat queue,
  and Esc-to-interrupt scoped to the chat panel.

#### Runtime tooling
- Interactive tabbed terminal (xterm + `node-pty`) with selectable shells.
- Run configurations (streaming, kills the whole process group on stop).
- Docker panel (containers/images, start/stop/restart, logs + exec over WS,
  inspect) and Database panel (MySQL/Postgres/SQLite: tables, columns, queries).
- Auto-updates from GitHub Releases (AppImage).

### Notes
- Toast notifications for save success/error.
- Extensive Rust `cargo test` + frontend Vitest coverage; several features
  hardened via adversarial multi-agent review.

[Unreleased]: https://github.com/mockingbitch/jak-ide/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/mockingbitch/jak-ide/releases/tag/v0.2.1
[0.2.0]: https://github.com/mockingbitch/jak-ide/releases/tag/v0.2.0
[0.1.0]: https://github.com/mockingbitch/jak-ide/releases/tag/v0.1.0
