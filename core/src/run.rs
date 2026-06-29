//! `POST /api/run-command` — the one-shot command runner (ported from the Node
//! `commandRunner`). Rejects shell operators, allowlists the first token, then
//! runs the command via `sh -c` at the project root with a timeout + output cap.

use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use axum::{extract::State, routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::process::Command;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

const TIMEOUT: Duration = Duration::from_secs(20);
const MAX_OUTPUT: usize = 4 * 1024 * 1024;

const DEFAULT_ALLOWED: &str = "ls,pwd,echo,cat,head,tail,wc,grep,find,tree,which,whoami,date,node,npm,npx,pnpm,yarn,python,python3,pip,pip3,go,gofmt,php,composer,git,make,tsc,eslint,prettier,vitest,jest,mkdir,touch,cp,mv,sed,awk,sort,uniq,diff";

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/api/run-command", post(run_command))
}

/// Anything that chains/redirects/substitutes — keeps the runner to one command.
fn has_shell_meta(s: &str) -> bool {
    s.chars().any(|c| matches!(c, ';' | '&' | '|' | '`' | '$' | '<' | '>' | '(' | ')' | '{' | '}' | '\n' | '\r'))
}

fn allowed_commands() -> Vec<String> {
    std::env::var("ALLOWED_COMMANDS")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_ALLOWED.to_string())
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

#[derive(Deserialize)]
struct RunBody {
    command: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RunResult {
    ok: bool,
    command: String,
    stdout: String,
    stderr: String,
    exit_code: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn fail(command: &str, error: impl Into<String>) -> RunResult {
    RunResult { ok: false, command: command.to_string(), stdout: String::new(), stderr: String::new(), exit_code: None, error: Some(error.into()) }
}

async fn run_command(State(st): State<Arc<AppState>>, Json(b): Json<RunBody>) -> ApiResult<Json<Value>> {
    let command = match b.command {
        Some(c) => c,
        None => return Err(ApiError::bad("command is required")),
    };
    let trimmed = command.trim().to_string();
    Ok(Json(json!(execute(&trimmed, &st).await)))
}

/// Shared guard (reused by the AI engine's run_command tool): reject shell
/// operators, then allowlist the first token.
pub fn validate(command: &str) -> Result<(), String> {
    if command.is_empty() {
        return Err("Empty command".into());
    }
    if has_shell_meta(command) {
        return Err("Command contains disallowed shell operators (; & | ` $ < > ...). Run a single command at a time.".into());
    }
    let allowed = allowed_commands();
    let bin = command.split_whitespace().next().unwrap_or("");
    if !allowed.iter().any(|a| a == bin) {
        return Err(format!("Command \"{bin}\" is not in the allowlist. Allowed: {}", allowed.join(", ")));
    }
    Ok(())
}

async fn execute(trimmed: &str, st: &AppState) -> RunResult {
    if let Err(e) = validate(trimmed) {
        return fail(trimmed, e);
    }

    let child = Command::new("sh")
        .arg("-c")
        .arg(trimmed)
        .current_dir(st.root())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true) // on timeout the dropped future kills the child
        .spawn();
    let child = match child {
        Ok(c) => c,
        Err(e) => return fail(trimmed, format!("Failed to run command: {e}")),
    };

    match tokio::time::timeout(TIMEOUT, child.wait_with_output()).await {
        Ok(Ok(out)) => {
            let mut stdout = String::from_utf8_lossy(&out.stdout).into_owned();
            let mut stderr = String::from_utf8_lossy(&out.stderr).into_owned();
            stdout.truncate(MAX_OUTPUT);
            stderr.truncate(MAX_OUTPUT);
            RunResult {
                ok: out.status.success(),
                command: trimmed.to_string(),
                stdout,
                stderr,
                exit_code: out.status.code().map(|c| c as i64),
                error: None,
            }
        }
        Ok(Err(e)) => fail(trimmed, format!("Failed to run command: {e}")),
        Err(_) => fail(trimmed, "Command timed out"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_shell_operators() {
        assert!(has_shell_meta("ls && whoami"));
        assert!(has_shell_meta("cat x | grep y"));
        assert!(has_shell_meta("echo $(whoami)"));
        assert!(has_shell_meta("echo a > b"));
        assert!(!has_shell_meta("echo \"hi there\" 42")); // quotes/spaces are fine
        assert!(!has_shell_meta("git status"));
    }

    #[test]
    fn default_allowlist_has_common_tools() {
        let a = allowed_commands();
        for tool in ["ls", "git", "echo", "node", "npm"] {
            assert!(a.iter().any(|x| x == tool), "missing {tool}");
        }
    }
}
