//! Direct-API AI engine (Stage 7, apikey/oauth) — the agentic tool loop that drives
//! the Anthropic Messages API over HTTPS instead of the `claude` CLI. Streams SSE,
//! executes tool calls against the project, feeds results back, repeats.
//!
//! NOTE: gated behind `JAKIDE_NATIVE_AI=1` (mod.rs); the Node proxy remains the
//! default for apikey/oauth until this path is verified against a real API key
//! (this machine has none). The SSE state machine + tool dispatch are unit-tested.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use axum::response::sse::Event;
use serde_json::{json, Value};
use tokio::sync::mpsc::Sender;
use tokio_stream::StreamExt;

use crate::auth::{env_api_key, get_oauth_cred, OAUTH_BETA};
use crate::paths::resolve_safe;
use crate::state::ignored_dirs;

use super::AiContext;

const MAX_ITERATIONS: usize = 20;
const MAX_READ_CHARS: usize = 100_000;
const MAX_RESULT_CHARS: usize = 60_000;
const DEFAULT_BASE: &str = "https://api.anthropic.com";

const SYSTEM_PROMPT: &str = "You are JakIDE's AI coding assistant, embedded in an IDE. You pair-program like a senior staff engineer.\n\nYou have TOOLS that act directly on the user's project: list_dir, read_file, apply_edit (preferred for small changes), write_file, run_command.\n\nHow to work:\n- Read before you edit (read_file / list_dir); never guess file contents.\n- Make changes yourself with apply_edit or write_file — don't paste large code blocks for the user to copy.\n- After editing, briefly say what you changed and why; the IDE shows each change as a diff to Keep or Revert.\n- Use run_command for verification when helpful. For pure questions, just answer. Be concise.";

fn tools() -> Value {
    json!([
        { "name": "list_dir", "description": "List files/folders in the project (relative dir, or \"\" for root).",
          "input_schema": { "type": "object", "properties": { "path": { "type": "string" } }, "additionalProperties": false } },
        { "name": "read_file", "description": "Read a UTF-8 text file by project-relative path.",
          "input_schema": { "type": "object", "properties": { "path": { "type": "string" } }, "required": ["path"], "additionalProperties": false } },
        { "name": "apply_edit", "description": "Replace one exact snippet in an existing file (search must match verbatim).",
          "input_schema": { "type": "object", "properties": { "path": { "type": "string" }, "search": { "type": "string" }, "replace": { "type": "string" } }, "required": ["path", "search", "replace"], "additionalProperties": false } },
        { "name": "write_file", "description": "Create or fully overwrite a file with the given content.",
          "input_schema": { "type": "object", "properties": { "path": { "type": "string" }, "content": { "type": "string" } }, "required": ["path", "content"], "additionalProperties": false } },
        { "name": "run_command", "description": "Run a single command in the project root; returns stdout, stderr, exit code.",
          "input_schema": { "type": "object", "properties": { "command": { "type": "string" } }, "required": ["command"], "additionalProperties": false } }
    ])
}

fn evt(v: Value) -> Event {
    Event::default().data(v.to_string())
}

// ---- SSE streaming state machine (unit-tested) ----

#[derive(Default, Debug)]
struct ToolUse {
    id: String,
    name: String,
    input: Value,
}

#[derive(Default)]
struct Turn {
    text: String,
    blocks: HashMap<u64, (String, String, String)>, // index -> (id, name, partial_json)
    tool_uses: Vec<ToolUse>,
    stop_reason: Option<String>,
    error: Option<String>,
}

#[derive(Debug, PartialEq)]
enum Emit {
    Text(String),
    Thinking(String),
}

/// Apply one parsed SSE event to the turn, returning any user-facing text to stream.
fn apply_event(turn: &mut Turn, ev: &Value) -> Vec<Emit> {
    let mut out = Vec::new();
    match ev.get("type").and_then(Value::as_str) {
        Some("content_block_start") => {
            let idx = ev.get("index").and_then(Value::as_u64).unwrap_or(0);
            let cb = ev.get("content_block");
            if cb.and_then(|c| c.get("type")).and_then(Value::as_str) == Some("tool_use") {
                let id = cb.and_then(|c| c.get("id")).and_then(Value::as_str).unwrap_or("").to_string();
                let name = cb.and_then(|c| c.get("name")).and_then(Value::as_str).unwrap_or("").to_string();
                turn.blocks.insert(idx, (id, name, String::new()));
            }
        }
        Some("content_block_delta") => {
            let idx = ev.get("index").and_then(Value::as_u64).unwrap_or(0);
            let delta = ev.get("delta");
            match delta.and_then(|d| d.get("type")).and_then(Value::as_str) {
                Some("text_delta") => {
                    if let Some(t) = delta.and_then(|d| d.get("text")).and_then(Value::as_str) {
                        turn.text.push_str(t);
                        out.push(Emit::Text(t.to_string()));
                    }
                }
                Some("thinking_delta") => {
                    if let Some(t) = delta.and_then(|d| d.get("thinking")).and_then(Value::as_str) {
                        out.push(Emit::Thinking(t.to_string()));
                    }
                }
                Some("input_json_delta") => {
                    if let (Some(b), Some(pj)) = (turn.blocks.get_mut(&idx), delta.and_then(|d| d.get("partial_json")).and_then(Value::as_str)) {
                        b.2.push_str(pj);
                    }
                }
                _ => {}
            }
        }
        Some("content_block_stop") => {
            let idx = ev.get("index").and_then(Value::as_u64).unwrap_or(0);
            if let Some((id, name, pj)) = turn.blocks.remove(&idx) {
                let input = if pj.trim().is_empty() { json!({}) } else { serde_json::from_str(&pj).unwrap_or_else(|_| json!({})) };
                turn.tool_uses.push(ToolUse { id, name, input });
            }
        }
        Some("message_delta") => {
            if let Some(sr) = ev.get("delta").and_then(|d| d.get("stop_reason")).and_then(Value::as_str) {
                turn.stop_reason = Some(sr.to_string());
            }
        }
        Some("error") => {
            let msg = ev.get("error").and_then(|e| e.get("message")).and_then(Value::as_str).unwrap_or("API error");
            turn.error = Some(msg.to_string());
        }
        _ => {}
    }
    out
}

/// Reconstruct the assistant turn's `content` array (text + tool_use blocks) to
/// carry into the next request.
fn assistant_content(turn: &Turn) -> Value {
    let mut blocks = Vec::new();
    if !turn.text.is_empty() {
        blocks.push(json!({ "type": "text", "text": turn.text }));
    }
    for tu in &turn.tool_uses {
        blocks.push(json!({ "type": "tool_use", "id": tu.id, "name": tu.name, "input": tu.input }));
    }
    Value::Array(blocks)
}

/// Extract complete SSE event JSON values from a buffer, returning the leftover.
fn drain_sse(buf: &str) -> (Vec<Value>, String) {
    let mut events = Vec::new();
    let mut rest = buf;
    while let Some(pos) = rest.find("\n\n") {
        let (block, after) = rest.split_at(pos);
        for line in block.lines() {
            if let Some(data) = line.strip_prefix("data:") {
                if let Ok(v) = serde_json::from_str::<Value>(data.trim()) {
                    events.push(v);
                }
            }
        }
        rest = &after[2..];
    }
    (events, rest.to_string())
}

// ---- engine ----

pub async fn stream(messages: Vec<(String, String)>, ctx: AiContext, root: PathBuf, model: String, tx: Sender<Event>) {
    let mut api_messages = build_initial_messages(&messages, &ctx, &root).await;
    let client = reqwest::Client::new();

    for _ in 0..MAX_ITERATIONS {
        let (headers, base_url) = match auth_headers().await {
            Ok(h) => h,
            Err(e) => {
                let _ = tx.send(evt(json!({ "type": "error", "error": e }))).await;
                break;
            }
        };
        let body = json!({
            "model": model,
            "max_tokens": 16000,
            "system": [{ "type": "text", "text": SYSTEM_PROMPT, "cache_control": { "type": "ephemeral" } }],
            "tools": tools(),
            "messages": api_messages,
            "stream": true,
        });

        let mut req = client.post(format!("{base_url}/v1/messages")).json(&body);
        for (k, v) in &headers {
            req = req.header(k.as_str(), v.as_str());
        }
        let resp = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                let _ = tx.send(evt(json!({ "type": "error", "error": format!("Request failed: {e}") }))).await;
                break;
            }
        };
        if !resp.status().is_success() {
            let code = resp.status().as_u16();
            let txt = resp.text().await.unwrap_or_default();
            let _ = tx.send(evt(json!({ "type": "error", "error": format!("API {code}: {}", txt.chars().take(400).collect::<String>()) }))).await;
            break;
        }

        let mut turn = Turn::default();
        let mut buf = String::new();
        let mut bytes = resp.bytes_stream();
        'read: while let Some(chunk) = bytes.next().await {
            let Ok(chunk) = chunk else { break };
            buf.push_str(&String::from_utf8_lossy(&chunk));
            let (events, rest) = drain_sse(&buf);
            buf = rest;
            for ev in events {
                if ev.get("type").and_then(Value::as_str) == Some("message_stop") {
                    break 'read;
                }
                for emit in apply_event(&mut turn, &ev) {
                    let v = match emit {
                        Emit::Text(t) => json!({ "type": "text", "text": t }),
                        Emit::Thinking(t) => json!({ "type": "thinking", "text": t }),
                    };
                    if tx.send(evt(v)).await.is_err() {
                        return; // client disconnected
                    }
                }
            }
        }

        if let Some(err) = turn.error {
            let _ = tx.send(evt(json!({ "type": "error", "error": err }))).await;
            break;
        }

        api_messages.push(json!({ "role": "assistant", "content": assistant_content(&turn) }));

        if turn.stop_reason.as_deref() != Some("tool_use") || turn.tool_uses.is_empty() {
            break;
        }

        // Execute each tool call, stream the activity, and collect results.
        let mut results = Vec::new();
        for tu in &turn.tool_uses {
            let _ = tx.send(evt(json!({ "type": "tool_use", "id": tu.id, "name": tu.name, "input": tu.input }))).await;
            let r = exec_tool(&root, &tu.name, &tu.input).await;
            if let Some(fc) = &r.file_change {
                let _ = tx
                    .send(evt(json!({ "type": "file_change", "path": fc.path, "before": fc.before, "after": fc.after, "created": fc.created })))
                    .await;
            }
            let _ = tx.send(evt(json!({ "type": "tool_result", "id": tu.id, "ok": r.ok, "summary": r.summary }))).await;
            results.push(json!({ "type": "tool_result", "tool_use_id": tu.id, "content": r.content, "is_error": !r.ok }));
        }
        api_messages.push(json!({ "role": "user", "content": results }));
    }

    let _ = tx.send(evt(json!({ "type": "done" }))).await;
}

async fn build_initial_messages(messages: &[(String, String)], ctx: &AiContext, root: &Path) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    if messages.is_empty() {
        return out;
    }
    let (last_role, last_content) = &messages[messages.len() - 1];
    for (role, content) in &messages[..messages.len() - 1] {
        out.push(json!({ "role": role, "content": content }));
    }
    if last_role == "user" {
        let block = context_block(ctx, root).await;
        out.push(json!({ "role": "user", "content": format!("{block}\n\n## User request\n{last_content}") }));
    } else {
        out.push(json!({ "role": last_role, "content": last_content }));
    }
    out
}

async fn auth_headers() -> Result<(Vec<(String, String)>, String), String> {
    if let Some(key) = env_api_key() {
        return Ok((
            vec![("x-api-key".into(), key), ("anthropic-version".into(), "2023-06-01".into())],
            DEFAULT_BASE.into(),
        ));
    }
    if let Some(cred) = get_oauth_cred().await {
        let base = cred.base_url.unwrap_or_else(|| DEFAULT_BASE.into());
        return Ok((
            vec![
                ("authorization".into(), format!("Bearer {}", cred.token)),
                ("anthropic-version".into(), "2023-06-01".into()),
                ("anthropic-beta".into(), OAUTH_BETA.into()),
            ],
            base,
        ));
    }
    Err("Not connected to Claude (no API key or OAuth credential).".into())
}

// ---- tools ----

struct FileChange {
    path: String,
    before: String,
    after: String,
    created: bool,
}
struct ToolResult {
    ok: bool,
    content: String,
    summary: String,
    file_change: Option<FileChange>,
}

fn clip(s: String, max: usize) -> String {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n… [truncated, {} chars]", &s[..end], s.len())
}

async fn exec_tool(root: &Path, name: &str, input: &Value) -> ToolResult {
    let s = |k: &str| input.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    match name {
        "list_dir" => list_dir(root, &s("path")),
        "read_file" => read_file(root, &s("path")),
        "apply_edit" => apply_edit(root, &s("path"), &s("search"), &s("replace")),
        "write_file" => write_file(root, &s("path"), &s("content")),
        "run_command" => run_command(root, &s("command")).await,
        other => ToolResult { ok: false, content: format!("Unknown tool: {other}"), summary: format!("unknown {other}"), file_change: None },
    }
}

fn err_result(content: String, summary: String) -> ToolResult {
    ToolResult { ok: false, content, summary, file_change: None }
}

fn list_dir(root: &Path, rel: &str) -> ToolResult {
    let abs = match resolve_safe(root, rel) {
        Ok(p) => p,
        Err(e) => return err_result(e.message, format!("list {rel}")),
    };
    let Ok(rd) = std::fs::read_dir(&abs) else {
        return err_result(format!("Not a directory: {}", if rel.is_empty() { "." } else { rel }), format!("list {rel}"));
    };
    let ignore = ignored_dirs();
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir && (ignore.contains(name.as_str()) || name == ".git") {
            continue;
        }
        if is_dir {
            dirs.push(format!("{name}/"));
        } else {
            files.push(name);
        }
    }
    dirs.sort();
    files.sort();
    let base = if rel.is_empty() { String::new() } else { format!("{}/", rel.trim_end_matches('/')) };
    let mut lines: Vec<String> = dirs.into_iter().chain(files).map(|l| format!("{base}{l}")).collect();
    let n = lines.len();
    if lines.is_empty() {
        lines.push("(empty)".into());
    }
    ToolResult { ok: true, content: clip(lines.join("\n"), MAX_RESULT_CHARS), summary: format!("list {} ({n})", if rel.is_empty() { "." } else { rel }), file_change: None }
}

fn read_file(root: &Path, rel: &str) -> ToolResult {
    let abs = match resolve_safe(root, rel) {
        Ok(p) => p,
        Err(e) => return err_result(e.message, format!("read {rel}")),
    };
    match std::fs::read_to_string(&abs) {
        Ok(c) => {
            let lines = c.lines().count();
            ToolResult { ok: true, content: clip(c, MAX_READ_CHARS), summary: format!("read {rel} ({lines} lines)"), file_change: None }
        }
        Err(e) => err_result(format!("Error reading {rel}: {e}"), format!("read {rel} (error)")),
    }
}

fn apply_edit(root: &Path, rel: &str, search: &str, replace: &str) -> ToolResult {
    let abs = match resolve_safe(root, rel) {
        Ok(p) => p,
        Err(e) => return err_result(e.message, format!("edit {rel}")),
    };
    let Ok(before) = std::fs::read_to_string(&abs) else {
        return err_result(format!("File not found: {rel}. Use write_file to create it."), format!("edit {rel} (not found)"));
    };
    if search.is_empty() || !before.contains(search) {
        return err_result(format!("Could not find the search snippet in {rel}."), format!("edit {rel} (not found)"));
    }
    let after = before.replace(search, replace);
    if std::fs::write(&abs, &after).is_err() {
        return err_result(format!("Could not write {rel}."), format!("edit {rel} (write failed)"));
    }
    ToolResult { ok: true, content: format!("Edited {rel}."), summary: format!("edit {rel}"), file_change: Some(FileChange { path: rel.to_string(), before, after, created: false }) }
}

fn write_file(root: &Path, rel: &str, content: &str) -> ToolResult {
    let abs = match resolve_safe(root, rel) {
        Ok(p) => p,
        Err(e) => return err_result(e.message, format!("write {rel}")),
    };
    let prior = std::fs::read_to_string(&abs).ok();
    if let Some(parent) = abs.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if std::fs::write(&abs, content).is_err() {
        return err_result(format!("Could not write {rel}."), format!("write {rel} (failed)"));
    }
    let created = prior.is_none();
    ToolResult {
        ok: true,
        content: format!("Wrote {rel} ({} chars).", content.len()),
        summary: format!("write {rel}"),
        file_change: Some(FileChange { path: rel.to_string(), before: prior.unwrap_or_default(), after: content.to_string(), created }),
    }
}

async fn run_command(root: &Path, command: &str) -> ToolResult {
    if command.trim().is_empty() {
        return err_result("Empty command".into(), "$ (empty)".into());
    }
    let child = tokio::process::Command::new("sh")
        .arg("-c")
        .arg(command)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn();
    let child = match child {
        Ok(c) => c,
        Err(e) => return err_result(format!("Failed to run: {e}"), format!("$ {command}")),
    };
    let out = match tokio::time::timeout(Duration::from_secs(20), child.wait_with_output()).await {
        Ok(Ok(o)) => o,
        _ => return err_result("Command timed out or failed.".into(), format!("$ {command}")),
    };
    let code = out.status.code().unwrap_or(-1);
    let mut parts = vec![format!("exit code: {code}")];
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !stdout.is_empty() {
        parts.push(format!("--- stdout ---\n{stdout}"));
    }
    if !stderr.is_empty() {
        parts.push(format!("--- stderr ---\n{stderr}"));
    }
    ToolResult { ok: code == 0, content: clip(parts.join("\n"), MAX_RESULT_CHARS), summary: format!("$ {command}"), file_change: None }
}

/// Bounded project context block prepended to the user's latest message.
async fn context_block(ctx: &AiContext, root: &Path) -> String {
    let mut parts = Vec::new();
    parts.push(format!("## Project structure (max depth 3)\n{}", render_tree(root, 3)));
    if let Some(fp) = &ctx.file_path {
        parts.push(format!("## Active file\nPath: `{fp}`"));
        if let Some(content) = &ctx.file_content {
            let numbered: String = content.lines().enumerate().map(|(i, l)| format!("{}: {l}", i + 1)).collect::<Vec<_>>().join("\n");
            let capped = clip(numbered, 20_000);
            parts.push(format!("## Active file content (line-numbered)\n```\n{capped}\n```"));
        }
    }
    if let Some(sel) = &ctx.selection {
        if !sel.text.is_empty() {
            parts.push(format!("## Selected code (lines {}-{})\n```\n{}\n```", sel.start_line, sel.end_line, sel.text));
        }
    }
    parts.join("\n\n")
}

fn render_tree(root: &Path, max_depth: usize) -> String {
    fn walk(dir: &Path, base: &Path, depth: usize, max: usize, ignore: &std::collections::HashSet<&str>, out: &mut Vec<String>) {
        if depth > max {
            return;
        }
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        let mut entries: Vec<_> = rd.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let name = e.file_name().to_string_lossy().into_owned();
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if is_dir && (ignore.contains(name.as_str()) || name == ".git") {
                continue;
            }
            let rel = e.path().strip_prefix(base).map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or(name.clone());
            out.push(format!("{}{} {}", "  ".repeat(depth), if is_dir { "📁" } else { "📄" }, rel));
            if is_dir && depth < max {
                walk(&e.path(), base, depth + 1, max, ignore, out);
            }
        }
    }
    let mut out = Vec::new();
    walk(root, root, 0, max_depth, &ignored_dirs(), &mut out);
    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drain_sse_splits_events_and_keeps_remainder() {
        let buf = "event: x\ndata: {\"type\":\"a\"}\n\nevent: y\ndata: {\"type\":\"b\"}\n\ndata: {\"partial";
        let (events, rest) = drain_sse(buf);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0]["type"], "a");
        assert_eq!(events[1]["type"], "b");
        assert_eq!(rest, "data: {\"partial");
    }

    #[test]
    fn apply_event_streams_text_and_accumulates_tool_use() {
        let mut turn = Turn::default();
        let emits = apply_event(&mut turn, &json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "text_delta", "text": "Hello" } }));
        assert_eq!(emits, vec![Emit::Text("Hello".into())]);

        // a tool_use block streamed across start → input_json_delta → stop
        apply_event(&mut turn, &json!({ "type": "content_block_start", "index": 1, "content_block": { "type": "tool_use", "id": "t1", "name": "read_file" } }));
        apply_event(&mut turn, &json!({ "type": "content_block_delta", "index": 1, "delta": { "type": "input_json_delta", "partial_json": "{\"path\":\"a" } }));
        apply_event(&mut turn, &json!({ "type": "content_block_delta", "index": 1, "delta": { "type": "input_json_delta", "partial_json": ".ts\"}" } }));
        apply_event(&mut turn, &json!({ "type": "content_block_stop", "index": 1 }));
        apply_event(&mut turn, &json!({ "type": "message_delta", "delta": { "stop_reason": "tool_use" } }));

        assert_eq!(turn.text, "Hello");
        assert_eq!(turn.stop_reason.as_deref(), Some("tool_use"));
        assert_eq!(turn.tool_uses.len(), 1);
        assert_eq!(turn.tool_uses[0].name, "read_file");
        assert_eq!(turn.tool_uses[0].input["path"], "a.ts");
    }

    #[test]
    fn apply_event_captures_api_error() {
        let mut turn = Turn::default();
        apply_event(&mut turn, &json!({ "type": "error", "error": { "message": "overloaded" } }));
        assert_eq!(turn.error.as_deref(), Some("overloaded"));
    }

    #[test]
    fn assistant_content_includes_text_then_tool_uses() {
        let mut turn = Turn::default();
        turn.text = "hi".into();
        turn.tool_uses.push(ToolUse { id: "t1".into(), name: "read_file".into(), input: json!({ "path": "a" }) });
        let c = assistant_content(&turn);
        let arr = c.as_array().unwrap();
        assert_eq!(arr[0]["type"], "text");
        assert_eq!(arr[1]["type"], "tool_use");
        assert_eq!(arr[1]["name"], "read_file");
    }

    #[test]
    fn apply_edit_and_read_round_trip() {
        let dir = std::env::temp_dir().join(format!("jak-ai-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.txt"), "hello world").unwrap();
        let r = apply_edit(&dir, "a.txt", "world", "rust");
        assert!(r.ok);
        assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "hello rust");
        let fc = r.file_change.unwrap();
        assert_eq!(fc.before, "hello world");
        assert_eq!(fc.after, "hello rust");
        // missing snippet → error
        assert!(!apply_edit(&dir, "a.txt", "nope", "x").ok);
    }
}
