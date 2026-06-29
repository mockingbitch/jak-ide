//! AI engine that drives the Claude Code CLI (`claude -p`), reusing the user's
//! login. Maps Claude Code's stream-json to JakIDE's AiEvent SSE stream
//! (text/thinking/tool_use/tool_result/file_change), with before/after diffs from
//! a pre-run project snapshot. Ported from the Node `claudeCodeService`.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;

use axum::response::sse::Event;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc::Sender;

use super::{AiContext, ChatOptions, Image};
use crate::state::ignored_dirs;

const ALLOWED_TOOLS: &[&str] = &["Read", "Edit", "Write", "MultiEdit", "Grep", "Glob"];

fn is_file_edit_tool(name: &str) -> bool {
    matches!(name, "Edit" | "Write" | "MultiEdit" | "NotebookEdit")
}

const SNAP_MAX_FILE: u64 = 512 * 1024;
const SNAP_MAX_TOTAL: u64 = 48 * 1024 * 1024;
const SNAP_MAX_FILES: usize = 4000;

struct Snapshot {
    content: HashMap<String, String>,
    existed: HashSet<String>,
}

/// Snapshot the project's text files so edits can be shown as before/after diffs.
fn snapshot(root: &Path) -> Snapshot {
    let ignore = ignored_dirs();
    let mut content = HashMap::new();
    let mut existed = HashSet::new();
    let mut total: u64 = 0;
    fn walk(
        dir: &Path,
        root: &Path,
        depth: usize,
        ignore: &std::collections::HashSet<&'static str>,
        content: &mut HashMap<String, String>,
        existed: &mut HashSet<String>,
        total: &mut u64,
    ) {
        if depth > 12 || existed.len() >= SNAP_MAX_FILES {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            if existed.len() >= SNAP_MAX_FILES {
                return;
            }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let ft = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if ft.is_dir() {
                if ignore.contains(name.as_str()) || name == ".git" {
                    continue;
                }
                walk(&path, root, depth + 1, ignore, content, existed, total);
            } else if ft.is_file() {
                let rel = match path.strip_prefix(root).ok().and_then(|p| p.to_str()) {
                    Some(s) => s.replace('\\', "/"),
                    None => continue,
                };
                existed.insert(rel.clone());
                if let Ok(meta) = entry.metadata() {
                    if meta.len() > SNAP_MAX_FILE || *total >= SNAP_MAX_TOTAL {
                        continue;
                    }
                    if let Ok(text) = std::fs::read_to_string(&path) {
                        *total += meta.len();
                        content.insert(rel, text);
                    }
                }
            }
        }
    }
    walk(root, root, 0, &ignore, &mut content, &mut existed, &mut total);
    Snapshot { content, existed }
}

/// Resolve a Claude-Code path to a project-relative posix path, or None if outside root.
fn rel_of(root: &Path, p: Option<&str>) -> Option<String> {
    let p = p?;
    let abs = if Path::new(p).is_absolute() { PathBuf::from(p) } else { root.join(p) };
    if abs != root && !abs.starts_with(root) {
        return None;
    }
    abs.strip_prefix(root).ok().and_then(|r| r.to_str()).map(|s| s.replace('\\', "/"))
}

fn build_prompt(messages: &[(String, String)], ctx: &AiContext) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut c: Vec<String> = Vec::new();
    if let Some(fp) = ctx.file_path.as_deref().filter(|s| !s.is_empty()) {
        c.push(format!("Active file: {fp}"));
    }
    if let Some(sel) = &ctx.selection {
        if !sel.text.is_empty() {
            c.push(format!("Selected (lines {}-{}):\n{}", sel.start_line, sel.end_line, sel.text));
        }
    }
    if !c.is_empty() {
        parts.push(format!("[IDE context]\n{}", c.join("\n")));
    }
    if messages.len() > 1 {
        let hist: Vec<String> = messages[..messages.len() - 1]
            .iter()
            .map(|(role, content)| format!("{}: {}", if role == "user" { "User" } else { "Assistant" }, content))
            .collect();
        parts.push(format!("[Earlier conversation]\n{}", hist.join("\n\n")));
    }
    let last = messages.last().map(|(_, c)| c.as_str()).unwrap_or("");
    parts.push(format!("[Request]\n{last}"));
    parts.join("\n\n")
}

fn ev(v: Value) -> Event {
    Event::default().data(v.to_string())
}

/// Run a turn through `claude -p`, streaming events to `tx`. Returns when the CLI
/// finishes (or the client disconnects, in which case the child is killed).
pub async fn stream(messages: Vec<(String, String)>, ctx: AiContext, images: Vec<Image>, options: ChatOptions, root: PathBuf, tx: Sender<Event>) {
    let snap_root = root.clone();
    let snap = tokio::task::spawn_blocking(move || snapshot(&snap_root)).await.unwrap_or(Snapshot {
        content: HashMap::new(),
        existed: HashSet::new(),
    });
    let prompt = build_prompt(&messages, &ctx);

    // Images travel via stream-json input (a user message with base64 image blocks);
    // the plain-text path stays the default for the common no-image case.
    let use_stream_input = !images.is_empty();
    let perm = if options.permission_mode.is_empty() { "acceptEdits".to_string() } else { options.permission_mode.clone() };
    let mut args: Vec<String> = vec!["-p".into(), "--output-format".into(), "stream-json".into(), "--verbose".into(), "--permission-mode".into(), perm];
    if use_stream_input {
        args.push("--input-format".into());
        args.push("stream-json".into());
    }
    if !options.model.is_empty() && options.model != "default" {
        args.push("--model".into());
        args.push(options.model.clone());
    }
    args.push("--allowedTools".into());
    for t in ALLOWED_TOOLS {
        args.push((*t).to_string());
    }

    let spawned = Command::new("claude")
        .args(&args)
        .current_dir(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn();
    let mut child = match spawned {
        Ok(c) => c,
        Err(e) => {
            let _ = tx.send(ev(json!({ "type": "error", "error": format!("Failed to launch Claude Code (`claude`): {e}") }))).await;
            let _ = tx.send(ev(json!({ "type": "done" }))).await;
            return;
        }
    };

    if let Some(mut stdin) = child.stdin.take() {
        if use_stream_input {
            // One stream-json user message carrying the prompt + base64 image blocks.
            let mut content = vec![json!({ "type": "text", "text": prompt })];
            for img in &images {
                content.push(json!({ "type": "image", "source": { "type": "base64", "media_type": img.media_type, "data": img.data } }));
            }
            let msg = json!({ "type": "user", "message": { "role": "user", "content": content } });
            let _ = stdin.write_all(msg.to_string().as_bytes()).await;
            let _ = stdin.write_all(b"\n").await;
        } else {
            let _ = stdin.write_all(prompt.as_bytes()).await;
        }
        let _ = stdin.shutdown().await; // EOF so `claude` starts processing
    }

    let stdout = child.stdout.take().expect("piped");
    let mut stderr = child.stderr.take().expect("piped");
    let mut lines = BufReader::new(stdout).lines();

    let mut edit_path_by_id: HashMap<String, String> = HashMap::new();
    let mut saw_result = false;
    let mut disconnected = false;

    'outer: while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(obj) = serde_json::from_str::<Value>(line) else { continue };
        let kind = obj.get("type").and_then(Value::as_str).unwrap_or("");
        match kind {
            "assistant" => {
                if let Some(blocks) = obj.pointer("/message/content").and_then(Value::as_array) {
                    for b in blocks {
                        match b.get("type").and_then(Value::as_str) {
                            Some("text") => {
                                if let Some(t) = b.get("text").and_then(Value::as_str).filter(|s| !s.is_empty()) {
                                    if tx.send(ev(json!({ "type": "text", "text": t }))).await.is_err() {
                                        disconnected = true;
                                        break 'outer;
                                    }
                                }
                            }
                            Some("thinking") => {
                                if let Some(t) = b.get("thinking").and_then(Value::as_str).filter(|s| !s.is_empty()) {
                                    if tx.send(ev(json!({ "type": "thinking", "text": t }))).await.is_err() {
                                        disconnected = true;
                                        break 'outer;
                                    }
                                }
                            }
                            Some("tool_use") => {
                                let id = b.get("id").and_then(Value::as_str).unwrap_or("").to_string();
                                let name = b.get("name").and_then(Value::as_str).unwrap_or("").to_string();
                                let input = b.get("input").cloned().unwrap_or(Value::Null);
                                let _ = tx.send(ev(json!({ "type": "tool_use", "id": id, "name": name, "input": input }))).await;
                                if is_file_edit_tool(&name) {
                                    let p = b.pointer("/input/file_path").and_then(Value::as_str)
                                        .or_else(|| b.pointer("/input/notebook_path").and_then(Value::as_str))
                                        .or_else(|| b.pointer("/input/path").and_then(Value::as_str));
                                    if let Some(rel) = rel_of(&root, p) {
                                        edit_path_by_id.insert(id, rel);
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
            "user" => {
                if let Some(blocks) = obj.pointer("/message/content").and_then(Value::as_array) {
                    for b in blocks {
                        if b.get("type").and_then(Value::as_str) == Some("tool_result") {
                            let id = b.get("tool_use_id").and_then(Value::as_str).unwrap_or("").to_string();
                            let ok = !b.get("is_error").and_then(Value::as_bool).unwrap_or(false);
                            let _ = tx.send(ev(json!({ "type": "tool_result", "id": id, "ok": ok }))).await;
                            if ok {
                                if let Some(rel) = edit_path_by_id.get(&id) {
                                    let after = tokio::fs::read_to_string(root.join(rel)).await.unwrap_or_default();
                                    let before = snap.content.get(rel).cloned().unwrap_or_default();
                                    let created = !snap.existed.contains(rel);
                                    let _ = tx.send(ev(json!({
                                        "type": "file_change", "path": rel, "before": before, "after": after, "created": created
                                    }))).await;
                                }
                            }
                        }
                    }
                }
            }
            "result" => {
                saw_result = true;
                let is_error = obj.get("is_error").and_then(Value::as_bool).unwrap_or(false);
                let subtype = obj.get("subtype").and_then(Value::as_str);
                if is_error || subtype.map(|s| s != "success").unwrap_or(false) {
                    let msg = obj.get("result").and_then(Value::as_str).filter(|s| !s.is_empty()).map(|s| s.to_string())
                        .unwrap_or_else(|| format!("Claude Code: {}", subtype.unwrap_or("error")));
                    let _ = tx.send(ev(json!({ "type": "error", "error": msg }))).await;
                }
                break;
            }
            _ => {}
        }
    }

    if disconnected {
        let _ = child.kill().await;
        return; // client gone — no done needed
    }

    let mut errbuf = String::new();
    let _ = stderr.read_to_string(&mut errbuf).await;
    let status = child.wait().await;
    let code = status.ok().and_then(|s| s.code());
    if code != Some(0) {
        let _ = tx.send(ev(json!({ "type": "error", "error": format!("Claude Code exited ({}). {}", code.map(|c| c.to_string()).unwrap_or_else(|| "signal".into()), errbuf.chars().take(400).collect::<String>()).trim().to_string() }))).await;
    } else if !saw_result {
        let _ = tx.send(ev(json!({ "type": "error", "error": "Claude Code finished without producing a result." }))).await;
    }
    let _ = tx.send(ev(json!({ "type": "done" }))).await;
}
