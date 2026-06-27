# JakIDE — AI-Powered Code Editor (MVP)

A web-based IDE in the spirit of VS Code + Cursor: a Monaco editor, a file
explorer over a local project folder, a Claude-powered assistant that
understands your code and proposes applicable edits, a basic terminal, and a
project-aware context system.

```
JakIDE/
  backend/    Node + TypeScript: file API, command runner, Claude AI service, WebSocket terminal
  frontend/   React + Vite: Monaco editor, file explorer, AI chat, xterm terminal
```

## Features

- **PhpStorm-style layout**: top toolbar, left/right/bottom tool-window stripes you can toggle, draggable splitters, multi-file editor tabs, and a status bar. Panel sizes persist.
- **Customizable theme**: ⚙ Settings offers presets (Darcula, IntelliJ Light, Dracula, Nord, One Dark, Solarized Dark), a free-form **accent colour** picker, and font size — applied live to the UI, Monaco, and the terminal, and saved locally.
- **Code font picker**: choose from the **fonts installed on your OS** (listed via `fontconfig`/`fc-list`, monospace) or type a custom CSS `font-family`; applies live to the editor, terminal, and code blocks. Falls back to a curated list on systems without fontconfig.
- **Monaco editor** with syntax highlighting for TS/JS/React/Vue, Python, Go, PHP, Docker, and more; multiple open tabs.
- **Markdown preview** — open a `.md`/`.markdown` file and toggle **Edit / Split / Preview** (GFM: tables, code, lists; sanitized with DOMPurify; links open externally).
- **PhpStorm-style file icons** — colour-coded file-type badges (TS/JS/PY/GO/PHP/…) and tinted folder glyphs in the explorer.
- **File explorer** over a local project folder (open / edit / save / create / delete; right-click a file to delete).
- **Agentic AI assistant (Claude)** — like Cursor's agent. It gets the project tree, the active file, and any selection, then **calls tools itself**: `list_dir`, `read_file`, `apply_edit` (minimal search/replace), `write_file`, and `run_command`. You see each step as a tool chip; it reads and edits files autonomously.
- **Cursor-style changes**: every file the AI edits is tracked. Open it and the editor shows a **unified diff**; a **Changes** list in the assistant panel (and a bar over the editor) lets you **Keep** or **Revert** per file, or Keep all / Revert all.
- **Real terminal with tabs** (xterm + WebSocket + a PTY via `node-pty`): full interactive shells with prompt, colours, and TUIs. Open **multiple terminals**, each on a **local shell you pick** (bash / zsh / fish / dash / your `$SHELL` / …).
- **One-shot command runner**: `POST /api/run-command` (allowlisted, for quick non-interactive runs).
- **Path-safe file API** confined to the project root.

## Prerequisites

- Node.js 18+ (tested on Node 22)
- An Anthropic API key — https://console.anthropic.com

## Run (desktop app)

JakIDE runs **only as a native desktop app (Electron)** — there is no standalone
browser mode. The `desktop/` package launches everything (backend + the
Vite-built renderer + the Electron window) in one command.

### One-time setup

```bash
( cd backend  && npm install && cp -n .env.example .env )   # then set ANTHROPIC_API_KEY in backend/.env
( cd frontend && npm install )
( cd desktop  && npm install )
```

`backend/.env` knobs (dev): `ANTHROPIC_API_KEY` (required for AI),
`ANTHROPIC_MODEL` (default `claude-opus-4-8`), `PROJECT_ROOT` (folder the IDE
opens — defaults to `backend/workspace`), `PORT`, `ALLOWED_COMMANDS`.

### Develop (native window + hot reload)

```bash
cd desktop
npm run dev
```

One command starts the backend, the Vite renderer dev server (HMR) and an
Electron window pointed at it. The window is the only UI — nothing is opened in a
browser. Vite is used purely as the renderer's dev/build tool inside Electron.

### Run the packaged experience locally

```bash
cd desktop
npm start              # builds the backend bundle + renderer, then launches Electron
```

Here the Electron main process **embeds the backend** (a single bundled
`app/server.cjs`) which also serves the built UI on a loopback port, so the
window loads `http://127.0.0.1:<port>` (same-origin; no CORS). In-app:

- **☰ menu → Open Folder…** (or the project chip ▾) — open / switch the project folder.
- **☰ menu → Set Anthropic API Key…** — stored locally (`~/.config/JakIDE/config.json`).

> All actions live in the in-app **hamburger (☰) menu** — there is no native
> File/View/Help menu bar.

### Build installers (.AppImage and .deb)

```bash
cd desktop
npm run dist           # outputs to desktop/release/
```

Produces `JakIDE-0.1.0.AppImage` and a `.deb`. On minimal/headless Linux,
Electron may need `--no-sandbox`.

## Authentication

The assistant needs Anthropic credentials. JakIDE resolves them in this order:

1. **API key** — set `ANTHROPIC_API_KEY` (backend `.env`, or the desktop **File →
   Set Anthropic API Key** menu). Sent as `x-api-key`. Uses JakIDE's own agent
   (custom tools + the Cursor-style diff UI).
2. **Claude Code login** — if you have [Claude Code](https://www.npmjs.com/package/@anthropic-ai/claude-code)
   installed (`npm i -g @anthropic-ai/claude-code`) and are logged in (run
   `claude` once), JakIDE detects it and routes the assistant **through the
   `claude` CLI** (`claude -p`), reusing that login — no API key needed. Claude
   Code does the agent work (reading/editing files); JakIDE restricts it to file
   tools (`Read/Edit/Write/MultiEdit/Grep/Glob` — **Bash excluded**) and still
   shows every change as a Keep/Revert diff.
   > Note: JakIDE never reads or extracts Claude Code's stored token — Anthropic
   > does not permit reusing a Claude Code *subscription* login to power a separate
   > app's direct API calls, so JakIDE runs inference *through* the CLI instead.
3. **Sign in with Anthropic (OAuth)** — click **Sign in with Anthropic** in the AI
   panel (or Settings → Account). Runs `ant auth login` (the [Anthropic
   CLI](https://github.com/anthropics/anthropic-cli)), stores a token under
   `~/.config/anthropic/`, and the backend uses it as a Bearer token
   (`anthropic-beta: oauth-2025-04-20`), refreshing automatically.

`GET /api/auth/status` reports `{ method: 'apikey' | 'claude-code' | 'oauth' | 'none', hasAuth, antInstalled, claudeInstalled, claudeLoggedIn }`.
The status dot in the bottom bar shows the active method.

## API surface (backend)

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET  | `/api/health` | Status, model, project root, whether the API key is set |
| GET  | `/api/files/tree` | Bounded project tree |
| GET  | `/api/files/file?path=` | Read a file |
| POST | `/api/files/file/save` | `{ path, content }` — write a file |
| POST | `/api/files/file/create` | `{ path, content? }` — create a file |
| POST | `/api/files/file/delete` | `{ path }` — delete a file/dir |
| POST | `/api/files/apply` | Apply an AI edit (`edit` search/replace, or `create`) |
| POST | `/api/run-command` | `{ command }` — run one allowlisted command |
| GET  | `/api/terminal/shells` | List local shells + the default |
| GET  | `/api/fonts` | List installed monospace fonts (`fc-list`) + source |
| GET  | `/api/auth/status` | `{ method, hasAuth, antInstalled }` |
| POST | `/api/auth/login` / `logout` | OAuth sign-in via the Anthropic CLI |
| POST | `/api/ai/chat` | `{ messages, context }` — SSE stream of the assistant reply |
| WS   | `/ws/terminal` | Interactive PTY terminal. Client → `{type:'start',shell,cols,rows}` / `{type:'input',data}` / `{type:'resize',cols,rows}`; server → `{type:'data'\|'started'\|'exit'}` |

## How the AI makes changes (agentic tool-calling)

`POST /api/ai/chat` runs a streaming agentic loop on the backend. Each turn Claude
may call tools; the server executes them against `PROJECT_ROOT` and feeds results
back until the model is done (capped at 20 iterations):

| Tool | Action |
| ---- | ------ |
| `list_dir(path?)` | Discover the project layout |
| `read_file(path)` | Read exact file contents |
| `apply_edit(path, search, replace)` | Minimal, exact-match edit (preferred) |
| `write_file(path, content)` | Create / overwrite a file |
| `run_command(command)` | Run one allowlisted command (tests, git, …) |

The SSE stream carries `text`, `thinking`, `tool_use`, `tool_result`, `file_change`,
`done`, and `error` events. The UI renders tool calls as chips and tracks every
`file_change` (capturing the before/after) so it can show a **diff** and offer
**Keep / Revert** — the file is written immediately (autonomous), but you stay in
control of whether to keep it. `apply_edit` uses exact search/replace, so a stale
snippet fails cleanly (the model reads the file and retries) instead of corrupting it.

## Security notes (MVP)

- All file operations are confined to `PROJECT_ROOT` (path-traversal blocked).
- The one-shot `POST /api/run-command` uses a configurable allowlist and rejects
  shell operators (`;`, `&&`, `|`, `` ` ``, `$`, redirects).
- The **interactive terminal is a full shell** (like a real IDE terminal) — not
  allowlisted. It only spawns a shell from the server-enumerated list (no
  arbitrary path), but once running it has the user's normal permissions. This is
  **not** a sandbox — run the IDE only against projects/machines you trust, locally.
- The Anthropic key lives only on the backend and is never sent to the browser.

## Notes / known limitations (MVP)

- **Monaco loads from a CDN.** `@monaco-editor/react` fetches the editor from
  jsDelivr at runtime, so the first load of the editor needs internet access. To
  run fully offline, add the `monaco-editor` package and point the loader at it
  (`loader.config({ monaco })`) with Vite worker setup.
- The terminal uses `node-pty` (a native module). In dev (`backend`) and in the
  packaged app it's built automatically; if it ever fails to load, the terminal
  shows a one-line message telling you to run `cd backend && npm rebuild node-pty`.
- LSP is "MVP-lite": Monaco's built-in highlighting + bracket matching only; no
  language server / cross-file completion.
- Theme/layout preferences are stored in `localStorage` (browser) / the Electron
  renderer's local storage (desktop).

## Tech

Backend: Express, `ws`, `node-pty`, `fs-extra`, `@anthropic-ai/sdk` (model
`claude-opus-4-8`, adaptive thinking, SSE streaming), run with `tsx`.
Frontend: React, Vite, `@monaco-editor/react`, `@xterm/xterm`, Zustand.
