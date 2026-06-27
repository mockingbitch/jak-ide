# JakIDE — Execution Plan

Stack đích (theo [CLAUDE.md](CLAUDE.md)): **Electron + React + TypeScript + Rust + Monaco + SQLite**.
Nguyên tắc: heavy task ở Rust · IPC async · file ≤ 500 LOC · feature-based + DI · không `any` ·
mỗi feature kèm test.

## Quyết định đã khoá
- **Rust core** = **sidecar HTTP/WS (axum + tokio)**, Electron spawn, loopback. Frontend giữ hợp đồng
  `/api/*` ⇒ thay đổi tối thiểu. Migrate kiểu **strangler-fig** (Rust phục vụ route đã port, Node giữ
  phần còn lại, flip proxy dần) — JakIDE luôn chạy được.
- **Target = chỉ desktop (Electron)** — web/trình duyệt đã **gỡ bỏ**: Electron là lối chạy
  duy nhất (`cd desktop && npm run dev`). Vite chỉ còn là công cụ dev/build cho renderer
  bên trong Electron; đã bỏ CORS (backend) và script `preview` (frontend).
- **LSP** = PHP (Intelephense), TypeScript/JavaScript, Python (Pyright), Go (gopls), YAML.
- **SQLite (rusqlite)**: index file/symbol, recent projects, settings → khởi động nhanh, RAM thấp.

## Thứ tự phase
| Phase | Mục tiêu | Hạng mục |
|---|---|---|
| 0 | Ổn định & dọn (commit baseline, fix bug, tách file, test harness) | #2, #5 |
| 1 | Nền Rust sidecar + SQLite, port route dễ→khó | #1 (+#3) |
| 2 | Index/search/watcher Rust; virtualize tree; Monaco dispose; benchmark RAM | #3 |
| 3 | Split editor, find-in-files, file ops, LSP, run config | #4, #5 |
| 4 | (tùy chọn) Debugger DAP, local history | #4 |

---

## Phase 0 — Ổn định & dọn

### #5 Bug
- **Mở git diff/blame/history/merge → không mở được file khác**: trong [EditorPane.tsx](frontend/src/components/EditorPane.tsx)
  các view này *early-return* chiếm vùng editor và không bị clear khi mở file.
  **Fix đúng:** tổng quát hoá tab model — tab có `kind: 'file' | 'diff' | 'blame' | 'history' | 'merge'`;
  diff/blame… mở thành **tab riêng** (như PhpStorm). (Mở đường cho split view.)
- **Không split view**: chưa có (1 editor) → làm ở Phase 3 dựa trên tab model.
- **Bug sweep**: lập danh sách đầy đủ, reproduce → fix → regression test.

### #2 Clean source
- Commit ~16 file đang dở (baseline sạch).
- Tách >500 LOC: [gitService.ts](backend/src/services/gitService.ts) → `git/{status,branch,commit,diff,remote}.ts`;
  [styles.css](frontend/src/styles.css) (2422) → CSS theo feature.
- Xóa dead code (export icon/CSS/api không dùng, `gitStage*`).
- Feature-based folders + ESLint: `no-explicit-any`, `max-lines:500`, `import/no-cycle`.
- Test harness: **vitest** (frontend), `cargo test` (Rust).

---

## Phase 1 — Rust core (#1)

Crates: `axum`, `tokio`, `ignore` (walk gitignore-aware), `nucleo` (fuzzy), `grep`/ripgrep libs
(content search), `notify(-debouncer)` (watch), `git2` (git), `portable-pty` (terminal),
`reqwest` (AI/Anthropic SSE), `rusqlite` (index), `serde`.

Thứ tự port:
1. `files/tree`, `files/file`, fonts, health.
2. **Index + search** (giao #3): nucleo + ripgrep + notify + SQLite.
3. `git/*`: `git2` cho status/diff/log/blame; spawn `git` cho push/pull/fetch/clone.
4. Terminal PTY: `portable-pty` + axum WS (thay node-pty).
5. AI: reqwest SSE + spawn `claude` CLI; chuyển agentic tool-loop sang Rust sau cùng.

Rủi ro cao nhất: AI tool-loop + PTY → port sau cùng, chạy song song Node trong lúc chuyển.

---

## Phase 2 — Performance (#3)
- Index: walk song song → SQLite; incremental theo mtime + `notify`; đẩy thay đổi qua WS.
- Search: tên file = fuzzy nucleo trên index; nội dung = ripgrep libs (mmap, song song, stream/giới hạn).
- RAM backend: Node idle ~60–120MB → Rust idle ~5–15MB; không giữ nội dung file; cache có giới hạn.
- Frontend: **virtualize file tree**, **dispose Monaco model** khi đóng tab, lazy-load thư mục lớn.
- Benchmark index/search/RAM trước–sau, đặt ngưỡng.

---

## Phase 3 — Tính năng IDE cơ bản (#4) + split view (#5)
- **Split editor / editor groups** (giải quyết "không split view"), kéo-thả tab.
- **Find in Files** + replace toàn dự án (search Rust); **Find/Replace trong file** (Monaco).
- Điều hướng: Go to file (có), **Go to symbol**, **Go to line**.
- Thao tác file: rename, move, new folder, copy/paste, drag-drop trên cây.
- **LSP**: completion/diagnostics/go-to-def/hover qua Rust spawn server + `monaco-languageclient`
  cho PHP/TS-JS/Python/Go/YAML.
- **Format document**, **Problems panel** (diagnostics), **basic Run configuration** (chạy lệnh/file → output).

---

## Phase 4 — Tùy chọn
- Debugger (DAP), Local history. (Không thuộc "PhpStorm cơ bản".)

## Test strategy (CLAUDE.md)
- Rust: `cargo test` (index/search/git parsing/path-safety).
- Frontend: vitest + React Testing Library (store, components).
- Regression test cho từng bug đã fix.
