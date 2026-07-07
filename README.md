# JakIDE — AI-first IDE

A native desktop IDE (Electron) with a **Rust core** for fast, non-blocking file
and language operations, a **Monaco** editor, a **Claude-powered agentic
assistant**, and PhpStorm-style tooling: a git tool window, a 3-way merge
conflict editor, LSP-backed code intelligence, project-wide search, an
interactive terminal, and Docker / database panels.

> Status: pre-1.0. The app runs **only as a native Electron window** — there is
> no standalone browser mode.

## Install (Linux x64)

Grab a prebuilt installer from the [**latest release**](https://github.com/mockingbitch/jak-ide/releases/latest) — no build step needed:

- **`.deb`** (Debian/Ubuntu): `sudo dpkg -i JakIDE-*.deb` (then launch **JakIDE** from your app menu).
- **`.AppImage`** (portable): `chmod +x JakIDE-*.AppImage && ./JakIDE-*.AppImage`.
  Needs FUSE — `sudo apt install libfuse2`, or run with `./JakIDE-*.AppImage --appimage-extract-and-run`.

The AppImage auto-updates from future GitHub releases. To build from source instead
(or to develop), see [Quick start](#quick-start) below.

## Architecture

JakIDE is a 4-part monorepo. The **Rust core is the front door**: the renderer
talks only to it over loopback HTTP/WebSocket, and any route the core hasn't
taken yet falls through to the legacy Node backend (a strangler-fig migration
that is nearly complete).

```
JakIDE/
  frontend/   React 18 + Vite + Zustand + Monaco — the renderer (UI)
  core/       Rust (axum) sidecar on 127.0.0.1:8787 — files, search, symbols,
              git, docker, db, terminal/run (PTY), LSP bridge, code intelligence,
              and a reverse-proxy fallthrough to Node
  backend/    Node + Express (legacy) — serves the built renderer + the
              direct-API AI engine; being retired route-by-route
  desktop/    Electron shell + build scripts + bundled LSP servers + updater
```

Data plane: the renderer uses plain same-origin `fetch` to `/api/*` and
WebSockets to `/ws/*` (Vite proxies both to `:8787` in dev; in the packaged app
the window loads directly from the core's port). CPU-bound work (indexing,
parsing, search) runs off the async workers in Rust so the UI thread never
blocks.

## Features

### Editor & workspace
- **PhpStorm-style layout** — top toolbar, toggleable left/right/bottom
  tool-window stripes, draggable splitters, **split editor groups**, multi-file
  tabs, and a status bar. Panel sizes and layout persist.
- **Monaco editor** with syntax highlighting for TS/JS/React, Vue, Python, Go,
  PHP, Rust, Docker, and more; **markdown preview** (Edit / Split / Preview, GFM,
  sanitized); **PhpStorm-style file icons**.
- **Themes & fonts** — presets (Darcula, IntelliJ Light, Dracula, Nord, One Dark,
  Solarized Dark), a free-form accent-colour picker, and an OS-installed code-font
  picker (`fc-list`), applied live to UI + editor + terminal and saved locally.
- **File explorer** over a local project folder (open / edit / save / create /
  rename / delete / copy / mkdir), with git status decorations on the tree.

### Code intelligence & navigation
- **LSP** over a Rust WebSocket bridge (`/ws/lsp`): completion, hover,
  diagnostics, go-to-definition and go-to-implementation for **PHP (Intelephense),
  TypeScript/JavaScript, Python (Pyright), Go (gopls)**. PHP and Python servers
  are bundled with the desktop app.
- **Native PHP code intelligence** (tree-sitter, in the Rust core) — Ctrl/Cmd+Click
  go-to-definition for classes, interfaces, traits, enums, and functions, with
  full namespace / `use` / alias / PSR-4 (composer) resolution, including jumps
  into `vendor/` via the autoload map without indexing it. Results merge with the
  language server's, native first. **Back/Forward** jump history (Ctrl/Cmd+Alt+←/→).
- **Go to file** (Ctrl/Cmd+P), **Go to symbol** (Ctrl/Cmd+Shift+O), **go to line**
  (Ctrl/Cmd+G); project-wide **find in files** + **find & replace** (ripgrep).

### Git
- **Git tool window** — status, staged/unstaged changes, PhpStorm-style
  per-file checkbox commit, **Commit** and **Commit & Push** (one click), branch
  switch/create/rename/delete, fetch, **Pull** (with merge/rebase dialog), push
  (auto-publishes a branch with no upstream), a **commit graph** log, per-file
  diff, blame, init, and clone (with streaming progress).
- **3-way merge conflict editor** (PhpStorm-style) — Ours │ Base │ Result
  (editable) │ Theirs, block-aligned panes, synced scrolling, conflict
  highlighting + minimap markers, F7 / Shift+F7 navigation with a
  "Conflict *i* of *N*" counter, Accept Ours/Theirs/Both/line-level, gutter
  arrows, context menu, and a save guard that warns on unresolved conflicts.

### AI assistant
- **Agentic Claude assistant** (Cursor-style) — it reads the project tree, the
  active file, and your selection, then calls tools itself (`list_dir`,
  `read_file`, `apply_edit`, `write_file`, `run_command`) shown as tool chips.
- **Cursor-style changes** — every AI edit is tracked; the editor shows a unified
  diff and a Changes list lets you **Keep / Revert** per file or all at once.
- Image attachments, model/permission options, and a streamed (SSE) reply with a
  live processing indicator and token counter.

### Runtime tooling
- **Interactive terminal** with tabs (xterm + PTY via `node-pty`) — full shells
  you pick (bash / zsh / fish / …), colours, and TUIs.
- **Run configurations** — streaming command runner (`/ws/run`) that kills the
  whole process group on stop; a one-shot allowlisted `POST /api/run-command`.
- **Problems panel** — diagnostics parsed from run output (tsc, cargo/rustc,
  ESLint, generic `path:line:col`), click to jump.
- **Docker panel** — containers/images, start/stop/restart, logs and exec over
  WebSockets, inspect.
- **Database panel** — connect to MySQL / Postgres / SQLite, browse tables and
  columns, run queries (typed per-engine pools).
- **Auto-updates** from GitHub Releases (AppImage), and a categorized Settings modal.

## Quick start

### Prerequisites
- **Node.js 18+** (tested on 22)
- **Rust toolchain** (`rustup`, stable) — required to build the core
- **git** on `PATH`
- An **Anthropic API key** (or a Claude Code / Anthropic OAuth login — see
  [Authentication](#authentication)) for the AI assistant
- Optional: `docker` for the Docker panel; a database server for the DB panel; the
  Go toolchain + `gopls` for Go LSP (PHP/Python/TS servers are bundled)

### One-time setup
```bash
( cd backend  && npm install && cp -n .env.example .env )   # set ANTHROPIC_API_KEY in backend/.env
( cd frontend && npm install )
( cd desktop  && npm install )
```

`backend/.env` (dev): `ANTHROPIC_API_KEY` (AI), `ANTHROPIC_MODEL`
(default `claude-opus-4-8`), `PROJECT_ROOT` (folder the IDE opens — defaults to
`backend/workspace`), `PORT`, `ALLOWED_COMMANDS`.

### Develop (native window + hot reload)
```bash
cd desktop
npm run dev
```
Starts, via `concurrently`: the Rust core (`:8787`), the Node backend (`:8788`),
the Vite renderer dev server (`:5173`, HMR), and an Electron window pointed at it.

> Editing Rust? `npm run dev` prefers a prebuilt `core/target/debug/jakide-core`,
> so run `cargo build` (or delete that binary) to pick up core changes. `cargo`
> at `~/.cargo/bin` is resolved by the dev scripts even if it's off your `PATH`.

### Run the packaged experience locally
```bash
cd desktop
npm run build && npm start
```

### Build installers (.AppImage and .deb)
```bash
cd desktop
npm run dist           # → desktop/release/JakIDE-<version>.AppImage and .deb
```
On minimal/headless Linux the app may need `--no-sandbox`; the AppImage needs
FUSE (`sudo apt install libfuse2`) or run it with `--appimage-extract-and-run`.

## Authentication

The assistant resolves Anthropic credentials in this order:

1. **API key** — `ANTHROPIC_API_KEY` (backend `.env`, or the in-app **Set
   Anthropic API Key**). Uses JakIDE's own agent (custom tools + Keep/Revert diffs).
2. **Claude Code login** — if [`@anthropic-ai/claude-code`](https://www.npmjs.com/package/@anthropic-ai/claude-code)
   is installed and logged in, JakIDE routes inference **through the `claude` CLI**
   (file tools only, Bash excluded) — no API key needed. JakIDE never reads Claude
   Code's stored token.
3. **Sign in with Anthropic (OAuth)** — via the [Anthropic CLI](https://github.com/anthropics/anthropic-cli)
   (`ant auth login`), used as an auto-refreshing Bearer token.

`GET /api/auth/status` reports the active method; the status dot in the bottom bar
reflects it.

## Keyboard shortcuts (selection)

| Shortcut | Action |
| --- | --- |
| Ctrl/Cmd+P | Go to file |
| Ctrl/Cmd+Shift+O | Go to symbol |
| Ctrl/Cmd+Shift+F | Find in files |
| Ctrl/Cmd+S | Save |
| Ctrl/Cmd+G | Go to line |
| Ctrl/Cmd+Click | Go to definition (PHP + LSP languages) |
| Ctrl/Cmd+Alt+← / → | Navigate back / forward |
| F7 / Shift+F7 | Next / previous merge conflict |
| Alt+O / T / B / R | (merge) Accept ours / theirs / both / mark resolved |

## Core API surface (selected)

All under `http://127.0.0.1:8787`. Anything unmatched proxies to the Node backend.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Status, model, project root, api-key present |
| GET/POST | `/api/files/*` | tree, read, external read, save, create, delete, rename, mkdir, copy, apply |
| GET/POST | `/api/projects*` | list recents, open/switch, browse |
| GET/POST | `/api/search/*`, `/api/symbols` | fuzzy file search, ripgrep text search, replace, go-to-symbol |
| POST/GET | `/api/intel/*` | PHP go-to-definition, symbol-at, (re)index, status |
| GET/POST | `/api/git/*` | 26 endpoints: status, branches, log, diff, blame, commit, stage, merge, pull, push, clone… |
| GET/POST/DELETE | `/api/docker/*`, `/api/db/*` | container/image ops; db test/tables/columns/query |
| POST | `/api/run-command`, `/api/ai/chat` | one-shot runner; SSE assistant stream |
| WS | `/ws/lsp?lang=`, `/ws/terminal`, `/ws/run`, `/ws/docker/*` | LSP bridge, PTY, streaming runner, docker logs/exec |

## Project layout

```
frontend/src/   App.tsx, store.ts (Zustand), api.ts (single fetch layer),
                components/ (panels, tabs, merge/), lib/ (lsp/, merge/, codeIntel/), hooks/
core/src/       main.rs (router), state.rs, one module per feature
                (files, search, symbols, git/, docker/, db, lsp, code_intelligence/, …)
desktop/        main.js (process orchestration), preload.js, updater.js,
                electron-builder.yml, scripts/ (build + dev launchers)
```

## Tech

Frontend: React 18, Zustand, `@monaco-editor/react` (Monaco 0.55), Vite, Vitest.
Core: Rust (edition 2021), axum + tokio, rusqlite, tree-sitter (tree-sitter-php),
sqlx, portable-pty, notify, ignore/grep. Backend: Express, `ws`, `node-pty`,
`@anthropic-ai/sdk`. Desktop: Electron + electron-builder + electron-updater;
bundled Intelephense, Pyright, typescript-language-server.

## Testing

```bash
( cd core     && cargo test )        # Rust unit/integration tests
( cd frontend && npm run test )      # Vitest
( cd frontend && npm run typecheck ) # tsc --noEmit
```

## Security notes

- All file operations are confined to `PROJECT_ROOT` (lexical path-traversal
  blocked); the read-only "external file" route exists for opening go-to-definition
  targets outside the root (e.g. `vendor/` dependencies).
- The one-shot runner is allowlisted and rejects shell operators. The **interactive
  terminal is a real, unsandboxed shell** — run JakIDE only against machines and
  projects you trust, locally.
- The core binds `127.0.0.1` only. The Anthropic key stays on the core/backend and
  is never sent to the renderer.

## Known limitations

- **Monaco loads from a CDN** (`@monaco-editor/react` fetches from jsDelivr), so the
  first editor load needs internet; bundle `monaco-editor` + `loader.config` to run
  fully offline.
- Native PHP go-to-definition covers classes/interfaces/traits/enums/functions
  (Phase 1); methods/properties/constants, local variables, find-references, and
  rename are on the roadmap. The merge editor's side panes are reconstructed from
  conflict markers (a full-file 3-way diff view is a future enhancement); the Base
  pane needs `merge.conflictStyle=diff3`.
- Auto-update currently targets the AppImage build.

## License

MIT — see [LICENSE](LICENSE).
