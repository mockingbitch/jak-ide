//! Low-level `git` invocation. Spawns the native `git` binary (never shells out)
//! with prompts/editor/pager disabled, mirroring the Node `gitService.run()` so
//! the porcelain output — and therefore every parsed contract — is identical.

use std::path::Path;
use std::process::Stdio;

use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::error::ApiError;

/// A git command failed (non-zero exit). User-facing (bad ref, no upstream,
/// conflicts) → mapped to HTTP 400, matching the Node `GitError`.
#[derive(Debug)]
pub struct GitError {
    pub message: String,
    #[allow(dead_code)] // surfaced in logs / future error payloads
    pub code: i32,
}

impl GitError {
    pub fn new(message: impl Into<String>, code: i32) -> Self {
        Self { message: message.into(), code }
    }
}

impl From<GitError> for ApiError {
    fn from(e: GitError) -> Self {
        ApiError::bad(e.message)
    }
}

pub struct RunResult {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
}

const MAX_BUFFER: usize = 64 * 1024 * 1024; // guard against pathological output

/// Configure a `git` command in `cwd` with credential prompts, the editor, and
/// the pager all disabled so a call can never hang or open an interactive UI.
pub fn command(cwd: &Path, args: &[&str]) -> Command {
    let mut cmd = Command::new("git");
    cmd.args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_EDITOR", "true")
        .env("GIT_PAGER", "cat");
    cmd
}

/// Run `git <args>` in `cwd`, capturing stdout/stderr/exit code. `input` is fed
/// to stdin when present. Never errors on a non-zero exit (returns the result);
/// only a spawn failure (e.g. git missing) is an `Err`.
pub async fn run(cwd: &Path, args: &[&str], input: Option<&str>) -> Result<RunResult, GitError> {
    let mut cmd = command(cwd, args);
    cmd.stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            GitError::new("git is not installed or not on PATH", -1)
        } else {
            GitError::new(format!("Failed to run git: {e}"), -1)
        }
    })?;
    if let Some(inp) = input {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(inp.as_bytes()).await;
            let _ = stdin.shutdown().await;
        }
    }
    let out = child
        .wait_with_output()
        .await
        .map_err(|e| GitError::new(format!("git wait failed: {e}"), -1))?;
    let mut stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    if stdout.len() > MAX_BUFFER {
        stdout.truncate(MAX_BUFFER);
    }
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    Ok(RunResult { stdout, stderr, code: out.status.code().unwrap_or(0) })
}

/// Run git and return stdout, turning a non-zero exit into a `GitError` whose
/// message is the trimmed stderr (then stdout, then a generic fallback).
pub async fn git(cwd: &Path, args: &[&str]) -> Result<String, GitError> {
    let r = run(cwd, args, None).await?;
    if r.code != 0 {
        let s = r.stderr.trim();
        let o = r.stdout.trim();
        let msg = if !s.is_empty() {
            s.to_string()
        } else if !o.is_empty() {
            o.to_string()
        } else {
            format!("git {} exited {}", args.first().copied().unwrap_or(""), r.code)
        };
        return Err(GitError::new(msg, r.code));
    }
    Ok(r.stdout)
}
