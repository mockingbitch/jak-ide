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

Crate: `core/` (jakide-core, axum). Build: `cargo build`; test: `cargo test`.
Run standalone: `PROJECT_ROOT=<dir> JAKIDE_CORE_PORT=8787 cargo run`.
**Runbook chi tiết (giữ app luôn chạy, strangler-fig, gỡ Node ở cuối):** [RUST-MIGRATION.md](RUST-MIGRATION.md).

Thứ tự port:
1. ✅ **DONE** `files/tree`, `files/file`, save/create/delete/apply, `projects/*`
   (status/open/browse + recents), `fonts`, `health` — native Rust, cargo-tested
   + parity-tested vs Node (path-safety, 409/422/400, runtime project switch).
2. ⏳ **Index + search** (giao #3): nucleo + ripgrep + notify + SQLite.
3. ⏳ `git/*`: `git2` cho status/diff/log/blame; spawn `git` cho push/pull/fetch/clone.
4. ⏳ Terminal PTY: `portable-pty` + axum WS (thay node-pty).
5. ⏳ AI: reqwest SSE + spawn `claude` CLI; chuyển agentic tool-loop sang Rust sau cùng.

**Flip (đưa Rust thành backend chạy thật):** sau khi port thêm git+terminal+AI HOẶC
thêm reverse-proxy (HTTP/SSE → Node cho route chưa port, WS cho terminal), đổi
Electron spawn `jakide-core` thay `tsx`/server.cjs trên cùng cổng 8787. Hiện app vẫn
chạy backend Node — Rust core build/test/parity xong nhưng **chưa wire vào Electron**.

Rủi ro cao nhất: AI tool-loop + PTY → port sau cùng, chạy song song Node trong lúc chuyển.

---

## Phase 2 — Performance (#3)
- Index: walk song song → SQLite; incremental theo mtime + `notify`; đẩy thay đổi qua WS.
- Search: tên file = fuzzy (`fuzzy-matcher`) trên index; nội dung = ripgrep libs (song song, stream/giới hạn).
- RAM backend: Node idle ~60–120MB → Rust idle ~5–15MB; không giữ nội dung file; cache có giới hạn.
- Frontend: **virtualize file tree**, **dispose Monaco model** khi đóng tab, lazy-load thư mục lớn.
- Benchmark index/search/RAM trước–sau, đặt ngưỡng.

### Trạng thái
- ✅ **Backend (Rust)** — index + fuzzy file search + ripgrep content search + `notify` watcher + SQLite
  cache. Đã xong từ migration Stage 1 (`core/src/{index,search,watch}.rs`); endpoint `/api/search/files`,
  `/api/search/text`, `/api/index/refresh`; 11 cargo test.
- ✅ **Frontend** —
  - **Go to file** (`SearchEverywhere`) gọi `/api/search/files` (debounce 110ms) thay vì flatten cây
    client → không còn giữ toàn bộ tree để search; thêm `searchFiles`/`searchText` vào `api.ts`.
  - **Virtualize file tree**: `lib/fileTree.ts` (`flattenTree`/`topLevelDirs`, có vitest) + `FileExplorer`
    windowing (chỉ mount hàng trong viewport, `ROW_H=24`, overscan 8); expand state nâng lên component.
  - **Dispose Monaco model** khi đóng tab (`EditorPane`) → không leak model khi mở/đóng nhiều file.
- ✅ **Benchmark** (repo này, 169 file, core release): idle RSS **7 MB**; `search/files` **~0.4 ms**;
  `search/text` (toàn repo) **~3 ms**; `files/tree` **~1.5 ms**. Đạt mục tiêu RAM #3 (Node ~60–120MB → 7MB).
- ⏳ **Lazy-load thư mục lớn** (hoãn): `/api/files/tree` hiện trả full tree (đã chặn theo `MAX_DEPTH` +
  bỏ qua node_modules…); virtualize đã giải quyết chi phí render. Lazy-load cần đổi contract tree (thêm
  `?path=&depth=` ở Rust) → để dành làm cùng cây file ops ở Phase 3 nếu cây thực tế còn lớn.

---

## Phase 3 — Tính năng IDE cơ bản (#4) + split view (#5)
- **Split editor / editor groups** (giải quyết "không split view"), kéo-thả tab.
- **Find in Files** + replace toàn dự án (search Rust); **Find/Replace trong file** (Monaco).
- Điều hướng: Go to file (có), **Go to symbol**, **Go to line**.
- Thao tác file: rename, move, new folder, copy/paste, drag-drop trên cây.
- **LSP**: completion/diagnostics/go-to-def/hover qua Rust spawn server + `monaco-languageclient`
  cho PHP/TS-JS/Python/Go/YAML.
- **Format document**, **Problems panel** (diagnostics), **basic Run configuration** (chạy lệnh/file → output).

### Trạng thái (cập nhật)
Kế hoạch chi tiết 22 unit (U1–U22) — xem workflow `phase34-understand`. Đã chia: ~14 unit làm được NGAY
(không cần cài gì), phần LSP/DAP bị chặn vì thiếu server/adapter + client libs.
- ✅ **Split editor (keystone, U1–U6, U8)** — tab model tổng quát hoá thành union `EditorTab`
  (`file|diff|blame|history|merge`) trong `groups: EditorGroup[]` (sửa luôn bug #5 Phase 0: diff/blame/
  history/merge giờ là tab thật, cùng tồn tại). Split Right + chia đôi kéo được, kéo-thả tab giữa group,
  **Go to Line** (Ctrl/Cmd+G), **Find/Replace trong file** (Monaco). EditorPane tách thành TabBar +
  tabs/{FileEditorTab,GitDiffTab,BlameTab,HistoryTab} + EditorGroupView + hook `useEditorChrome`
  (theme, GC model theo refcount qua các group, save/go-to-line). 21 vitest.
- ✅ **File operations (U7, U9)** — Rust `POST /api/files/{rename,mkdir,copy}` (path-safe, 409, fallback
  EXDEV, copy đệ quy off-thread, refresh index). UI: context menu, inline rename, cut/copy/paste, kéo-thả
  trên cây. 18 cargo test.
- ✅ **Đã review đối kháng** (workflow `review-split-fileops`): 13 bug được xác nhận → đã sửa critical/high/
  medium (shared-model disposal khi split → `keepCurrentModel`; openTab trùng lặp xuyên group; renameTab
  rebase cả aux tab; EXDEV cleanup + spawn_blocking; refresh index sau create/mkdir/delete; remove an toàn
  symlink). Hoãn vài low/edge: clipboard copy auto-suffix, auto-expand thư mục sau create, TOCTOU rename,
  copy đi theo symlink (đã ghi chú; nhất quán với giới hạn symlink của resolve_safe).
- ✅ **Find in Files (U10–U12)** — Rust `GET /api/search/text` mở rộng options (regex · caseSensitive ·
  wholeWord · include/exclude globs qua `ignore::overrides`), trả match offset (UTF-16) + invalid-regex/glob
  → 200 kèm `error` inline. Rust `POST /api/search/replace` (crate `regex`): replace toàn dự án hoặc giới hạn
  theo `files`, literal dùng `NoExpand` ($/\ an toàn), regex expand `${1}`/`${name}`, path-safe + off-thread.
  UI: tool window thứ ba ở activity bar (`leftView:'search'`, Ctrl/Cmd+Shift+F) — `FindInFiles` + `FindResults`
  (nhóm theo file, collapse/dismiss, highlight match, click → mở file tại dòng qua `useOpenFileAt`), store
  riêng `lib/findStore.ts` (store chính đã >500 LOC). 24 cargo + 23 vitest; backend live-verified (curl) toàn
  bộ option + replace. **Lưu ý:** replacement dùng cú pháp Rust `regex` (`${1}`, không phải JS `$1`).
- ✅ **Go to Symbol (U16)** — Rust `POST /api/symbols {path, content}` (engine `core/src/symbols.rs`):
  quét file theo dòng, mỗi ngôn ngữ một bộ regex line-anchored (TS/JS · Python · Go · Rust · PHP, + ext lạ
  → rỗng); permissive + **denylist control-keyword trong code** (gọn hơn keyword-guard regex); first-rule-wins,
  indent>0 ⇒ function thành method; trả `{name,kind,line,col(UTF-16),indent}`. Bộ rule + fixtures thiết kế
  qua workflow đa-agent (1 agent/ngôn ngữ) → 8 cargo test theo fixtures. UI: modal `GoToSymbol` (Ctrl/Cmd+
  Shift+O) tái dùng `.finder*`, lọc theo tên, badge theo kind, nhảy editor đang mở qua `revealPosition`.
  32 cargo + 23 vitest; backend live-verified (curl) cả 5 ngôn ngữ. **Giới hạn heuristic:** field/property
  không có access-modifier (vd `state = 0`) bỏ qua để tránh nhiễu object-literal; signature đa dòng bỏ qua.
- ✅ **Run configuration (U14/U15)** — Rust WS `/ws/run` (`core/src/runner.rs`, tokio async process):
  `{start,command}`/`{stop}` → `{started,output(stream),exit(code)}`; spawn `sh -c` ở project root, stream
  stdout/stderr, **kill cả process group** (`process_group(0)` + `libc::kill(-pid)`) nên `stop`/disconnect
  giết cả tiến trình cháu (sleep…) — tránh treo do pipe orphan. UI: tool window thứ hai ở bottom bar
  (`bottomView:'terminal'|'run'`), Terminal vẫn mounted khi xem Run; WS sống ở module `runnerService.ts`
  (run sống sót khi đổi view); store riêng `runStore.ts` (configs persisted + output capped 1MB),
  `RunPanel` (input + saved-config chips + Run/Stop + output ANSI-stripped `ansi.ts`). 32 cargo + 27 vitest;
  backend live-verified (WS client): stdout/stderr/exit, cwd=root, stop giết group ~0.5s không orphan, empty→-1.
- ✅ **Problems panel (U21)** — không có LSP nên diagnostics suy ra từ **parse output của Run** (`lib/problems.ts`,
  pure + test): nhận tsc, cargo/rustc (state máy error→`-->`), ESLint stylish (file-header + rows), và generic
  `path.ext:line[:col][: severity]: msg` (go/gcc/python). View bottom thứ ba (`bottomView:'problems'`) +
  nút bottom-bar kèm badge số lượng; nhóm theo file, badge severity, click → mở file tại line:col qua
  `useOpenFileAt` (path chuẩn hoá về relative: bỏ prefix projectRoot + `./`). Derive qua hook `useProblems`
  (memo theo output). 32 vitest (+5 parser). Thuần frontend (parse text nhẹ, không cần Rust round-trip).
- ✅ **Hoàn tất mọi unit Phase 3 KHÔNG bị chặn** (U1–U16, U21). Chỉ còn LSP/DAP cần cài server/adapter.
### LSP (Phase 3, đang mở khoá)
- ✅ **U18 LSP transport** — Rust bridge `core/src/lsp.rs`: WS `GET /ws/lsp?lang=` spawn language server
  (cwd=project root), cầu JSON-RPC: stdio **Content-Length framed** ↔ WS **bare JSON/frame** (chuẩn
  `vscode-ws-jsonrpc`); kill khi disconnect. `server_for` map lang→cmd (typescript ✅ cài; python/go/php
  để sẵn override env). `typescript-language-server`+`typescript` = dependency của `desktop`; dev-core.mjs +
  main.js prepend `node_modules/.bin` (project trước, rồi bundle) vào PATH của core. 3 cargo test (parser
  framing). **Live-verified**: `initialize` → capabilities (hover/completion/definition=true) @314ms.
- ✅ **U19/U20 LSP features (frontend)** — client LSP tự viết gọn (`lib/lsp/{protocol,client,providers}.ts`,
  `hooks/useLsp.ts`), KHÔNG dùng `monaco-languageclient` (v9 đòi `@codingame/monaco-vscode-api` xung đột
  vanilla monaco 0.55). `client.ts`: JSON-RPC/WS, initialize→initialized, queue op tới khi ready, document
  sync full-text + debounce 300ms. `useLsp`: attach model ts/js (didOpen/didChange/didClose), publishDiagnostics
  → `setModelMarkers`; URI round-trip `file://<root>/<rel>` ↔ `Uri.parse(rel)`. `providers.ts`: completion
  (textEdit/snippet/kind), hover, definition (cùng-project). 8 protocol vitest. **Live-verified qua bridge**:
  diagnostics (type error + unused), completion (52 string methods), hover (`const msg: string`), definition
  (trỏ đúng dòng khai báo). Render GUI (squiggle/popup/tooltip/go-to-def) do user verify.
- ✅ **LSP đa ngôn ngữ** — `useLsp` quản N client (lazy theo family), provider đăng ký theo `LANG_CONFIGS`;
  `clientLang(path)` route file→server. **PHP (intelephense)** + **Python (pyright)** = desktop deps, cài
  xong; live-verified diagnostics (pyright: type mismatch @945ms; intelephense: undefined var @1737ms).
  **Go (gopls)**: đã wire (`server_for` + provider), chỉ chờ cài Go toolchain + `gopls` — bridge đóng WS
  graceful khi thiếu server.
- ⛔ **Còn chặn**: gopls (cần Go toolchain) · U22 DAP (Phase 4, thiếu adapter).

---

## Phase 4 — Tùy chọn
- Debugger (DAP), Local history. (Không thuộc "PhpStorm cơ bản".)

## Test strategy (CLAUDE.md)
- Rust: `cargo test` (index/search/git parsing/path-safety).
- Frontend: vitest + React Testing Library (store, components).
- Regression test cho từng bug đã fix.
