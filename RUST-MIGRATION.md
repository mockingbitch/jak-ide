# Rust Migration Runbook — hoàn tất Phase 1 (all-Rust, gỡ Node)

Mục tiêu: chuyển **toàn bộ** backend sang `core/` (jakide-core, axum) và **xóa `backend/` (Node)**.
Ràng buộc số 1: **app luôn hoạt động bình thường ở mọi commit** (strangler-fig).

## Nguyên tắc giữ cho mọi thứ luôn work
1. **Hợp đồng không đổi**: frontend vẫn gọi `/api/*` + `/ws/*` y như cũ → không sửa UI, không regression.
2. **Reverse-proxy fallthrough**: Rust core (`:8787`) phục vụ route đã port **native**; route chưa port →
   `axum .fallback()` **proxy sang Node (`:8788`)**. App luôn đủ tính năng (Rust phần đã port + Node phần còn lại).
3. **Mỗi domain**: port → `cargo test` + **parity test trực tiếp** (curl Rust vs Node trên cùng fixture) →
   gỡ fallthrough của domain đó → **commit**. Mỗi commit đều build+test xanh; rollback = revert 1 stage.
4. **Không xóa route Node** cho tới khi bản Rust đã parity-verified VÀ fallthrough đã gỡ.
5. **Terminal (WS) port TRƯỚC khi flip** → proxy chỉ phải xử lý HTTP/SSE (đơn giản, tin cậy), **không cần WS-proxy**.

## Topology tiến trình trong lúc migrate
- **Dev**: `concurrently` → `cargo run`(Rust `:8787`) + Node `PORT=8788`(`:8788`) + vite + electron.
  Renderer → `:8787` (Vite proxy) → Rust; Rust proxy phần chưa port → `:8788` (Node).
- **Packaged**: Electron spawn binary Rust (`:8787`) **+** Node bundle (`:8788`) cho tới khi Node nghỉ; sau đó **chỉ Rust**.

## Các stage (mỗi stage: build + cargo test + parity + commit; app vẫn chạy)
- **0. ✅ DONE** — files / projects / fonts / health (native Rust, parity-tested; chưa live).
- **1. ✅ DONE** — Index + Search + Watch (SQLite). `ignore` walk → SQLite cache (`~/.jakide/index.db`) +
  in-memory snapshot; `SkimMatcherV2` fuzzy tên file; ripgrep libs (`grep-*`) cho nội dung (binary-detection,
  line-capped, bounded). `notify` watcher cập nhật incremental (per-dir NonRecursive, bỏ qua node_modules/target;
  debounce 400ms; re-target khi đổi project). Endpoint: `GET /api/search/files`, `GET /api/search/text`,
  `POST /api/index/refresh`. 11 cargo test; live-verified (151 files, watcher create/delete ~900ms).
- **2. ✅ DONE** — git. **Quyết định: spawn `git` cho TẤT CẢ thao tác** (không dùng `git2`/libgit2). Lý do:
  porcelain output giống hệt Node → JSON contract bất biến; giữ nguyên hành vi credential/offline/editor-safe
  (`GIT_TERMINAL_PROMPT=0`, `GIT_EDITOR=true`, `GIT_PAGER=cat`); binary gọn hơn (không vendored libgit2).
  Module `core/src/git/` (exec/ops/clone/mod, mỗi file ≤500 LOC). Đủ 26 endpoint `/api/git/*` kể cả clone-stream
  (SSE qua axum). Parser test (porcelain v2, blame header, ISO-date không cần crate, repo-name). Live-verified
  toàn bộ: status/branches/log/diff/blame/commit-diff/remotes + stage/unstage/commit-files/branch/checkout/
  rename/delete + merge-conflict → conflict (3-way) → resolve, và fetch/pull/push (error shape đúng).
- **3. ✅ DONE** — terminal. `portable-pty` + axum WebSocket `/ws/terminal` (start/input/resize → data/exit,
  giữ nguyên protocol JSON) + `GET /api/terminal/shells` (port `listShells`). PTY ở project root, TERM=
  xterm-256color, env kế thừa; generation-guard cho start chồng/stale-exit; shell allowlist (chỉ exec shell
  đã liệt kê, sai → fallback default). **Bỏ node-pty.** Live-verified: spawn /bin/bash, `echo $((6*7))`→42,
  resize, exit 0, và shell sai → fallback /usr/bin/zsh. Backpressure: bounded channel + `blocking_send` ở
  reader thread → PTY tự throttle khi client chậm (gọn hơn pause/resume thủ công của Node).
- **4. ✅ DONE (FLIP)** — Rust core là **front door**; Node là backend cho phần chưa port. `core/src/proxy.rs`:
  `.fallback()` reverse-proxy mọi request không khớp route native → Node (`JAKIDE_NODE_PORT`), **stream body**
  nên SSE (`/api/ai/chat`) chảy qua không buffer; static renderer cũng proxy về Node (tới Stage 8 mới cho Rust
  serve trực tiếp). reqwest (no-TLS, localhost). Desktop wiring:
  - `main.js`: `startBackends()` chọn 2 free port, chạy Node bundle (static + ai/auth/run), spawn binary core
    (JAKIDE_CORE_PORT/JAKIDE_NODE_PORT/JAKIDE_DESKTOP=1/PROJECT_ROOT), chờ `/api/health`, load cổng core.
    Fallback an toàn: thiếu binary core → Node làm front door (hành vi cũ).
  - `dev`: concurrently chạy `dev-core.mjs` (đọc PROJECT_ROOT từ backend/.env) + Node `PORT=8788` + Vite (proxy
    →8787) + electron (`wait-on tcp:5173 tcp:8787`). `build:core.mjs` build release + copy vào `app/bin/`.
  - Verified headless (mô phỏng đúng logic main.js): front door Rust phục vụ native (health desktop:true, files
    tree) + proxy `/` (index.html static), `/api/auth/status`, và SSE `/api/ai/chat` (frame text→done) qua Node.
    **Chưa chạy**: GUI Electron + `electron-builder dist` (cần máy có display; user tự verify `npm run dev`/`dist`).
- **5. ✅ DONE** — run-command. `core/src/run.rs`: `POST /api/run-command`, chặn shell-operator, allowlist token
  đầu (env `ALLOWED_COMMANDS` hoặc default), chạy `sh -c` ở project root, timeout 20s (kill_on_drop), cap 4MB.
  Live-verified: echo có quote, pwd=root, rm bị chặn allowlist, `&&` bị chặn meta, exit≠0 giữ stderr, thiếu field→400.
- **6. auth** — `/api/auth/status|login|logout`: dò CLI `claude`/`ant`, spawn `ant auth login`, đọc token
  `~/.config/anthropic`, method = apikey/oauth/claude-code/none. Gỡ fallthrough.
- **7. AI** — `POST /api/ai/chat` (SSE):
  - **claude-code / oauth(ant)**: spawn CLI (`claude -p` / `ant`), stream event → SSE. *(nhẹ)*
  - **api key trực tiếp**: `reqwest` streaming POST `/v1/messages`, chạy vòng lặp tool (≤20) với
    list_dir/read_file/apply_edit/write_file/run_command, phát text/thinking/tool_use/tool_result/file_change/done.
    *(phần nặng duy nhất — làm cuối)*. Gỡ fallthrough.
- **8. Retire Node** — gỡ `.fallback()` proxy; Electron spawn **chỉ** Rust; xóa `backend/`, node-pty,
  `desktop/app/server.cjs` + `build-backend.mjs`; sửa `desktop/package.json` scripts + README/PLAN.
  Kết quả: **một process Rust duy nhất**, không còn Node runtime.

## Cổng kiểm chứng (CLAUDE.md: test mỗi feature)
- `cargo test` mỗi module (parser, path-safety, git porcelain, search, conflict).
- Script parity mỗi domain: curl Rust vs Node trên cùng fixture (như đã làm ở stage 0).
- Sau FLIP: smoke toàn app (mở/sửa/lưu file, git commit, terminal, AI chat, split/diff).
- **Benchmark RAM** trước/sau (Node baseline → Rust) để xác nhận mục tiêu #3.

## Quyết định mở (ảnh hưởng công sức stage 7 — AI)
- Dùng AI qua **Claude Code/`ant` CLI** → Rust chỉ spawn CLI → AI port **nhẹ**, all-Rust dễ.
- Dùng **API key trực tiếp** (agent custom) → cần `reqwest` + vòng lặp tool → **nặng hơn**, làm cuối.

> Tóm tắt đảm bảo: hợp đồng `/api`+`/ws` bất biến + proxy fallthrough → **không có thời điểm nào app mất tính năng**;
> mỗi stage là một commit xanh, revert được; Node chỉ bị xóa khi Rust đã thay 100% và đã parity-verified.
