//! Auth: `/api/auth/status|login|logout` plus the credential resolution the AI
//! engine reuses (Stage 7). Ported from the Node `auth` service. We never read a
//! Claude Code subscription token — that path drives the `claude` CLI instead.

use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{routing::get, routing::post, Json, Router};
use serde::Serialize;
use serde_json::{json, Value};
use tokio::process::Command;

use crate::state::AppState;

/// OAuth tokens from `ant auth login` need this beta header on /v1/messages.
#[allow(dead_code)] // consumed by the AI engine (Stage 7)
pub const OAUTH_BETA: &str = "oauth-2025-04-20";

/// Serialize interactive logins — two `ant auth login` flows would clobber each
/// other's browser handshake.
static LOGIN: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/auth/status", get(status))
        .route("/api/auth/login", post(login))
        .route("/api/auth/logout", post(logout))
}

/// Run a command to completion with a timeout; returns (exit_code, stdout, stderr).
/// A missing binary / spawn failure / timeout yields code -1.
async fn run_cmd(cmd: &str, args: &[&str], timeout: Duration) -> (i32, String, String) {
    let spawned = Command::new(cmd)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn();
    let child = match spawned {
        Ok(c) => c,
        Err(_) => return (-1, String::new(), "command not found".to_string()),
    };
    match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(Ok(out)) => (
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stdout).into_owned(),
            String::from_utf8_lossy(&out.stderr).into_owned(),
        ),
        Ok(Err(e)) => (-1, String::new(), e.to_string()),
        Err(_) => (-1, String::new(), "timed out".to_string()),
    }
}

pub async fn is_ant_installed() -> bool {
    run_cmd("ant", &["--version"], Duration::from_secs(5)).await.0 == 0
}

pub async fn is_claude_installed() -> bool {
    run_cmd("claude", &["--version"], Duration::from_secs(5)).await.0 == 0
}

/// Logged into Claude Code? Presence-only — we never read the token itself.
pub fn claude_logged_in() -> bool {
    if std::env::var("CLAUDE_CODE_OAUTH_TOKEN").map(|v| !v.is_empty()).unwrap_or(false) {
        return true;
    }
    match std::env::var("HOME") {
        Ok(home) => std::path::Path::new(&home).join(".claude").join(".credentials.json").exists(),
        Err(_) => false,
    }
}

/// A blank/whitespace ANTHROPIC_API_KEY (the documented "use OAuth" default) is
/// treated as absent so it doesn't shadow the OAuth path.
pub fn env_api_key() -> Option<String> {
    std::env::var("ANTHROPIC_API_KEY").ok().map(|k| k.trim().to_string()).filter(|k| !k.is_empty())
}

#[derive(Clone)]
#[allow(dead_code)] // base_url consumed by the AI engine (Stage 7)
pub struct OAuthCred {
    pub token: String,
    pub base_url: Option<String>,
}

/// Fetch (and transparently refresh) an OAuth credential from the Anthropic CLI.
/// `--env` prints `KEY=value` lines; bare form would dump the whole JSON.
pub async fn get_oauth_cred() -> Option<OAuthCred> {
    let (code, stdout, _) = run_cmd("ant", &["auth", "print-credentials", "--env"], Duration::from_secs(15)).await;
    if code != 0 {
        return None;
    }
    let mut token = String::new();
    let mut base_url = None;
    for line in stdout.lines() {
        let Some((key, raw)) = line.split_once('=') else { continue };
        if !key.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_') || key.is_empty() {
            continue;
        }
        let mut val = raw.trim();
        if (val.starts_with('"') && val.ends_with('"')) || (val.starts_with('\'') && val.ends_with('\'')) {
            val = &val[1..val.len().saturating_sub(1)];
        }
        match key {
            "ANTHROPIC_AUTH_TOKEN" => token = val.to_string(),
            "ANTHROPIC_BASE_URL" => base_url = Some(val.to_string()),
            _ => {}
        }
    }
    if token.is_empty() {
        None
    } else {
        Some(OAuthCred { token, base_url })
    }
}

/// Which engine to use: explicit API key → Claude Code login → ant OAuth → none.
#[allow(dead_code)] // used by the AI engine (Stage 7)
pub async fn resolve_method() -> &'static str {
    if env_api_key().is_some() {
        return "apikey";
    }
    if is_claude_installed().await && claude_logged_in() {
        return "claude-code";
    }
    if is_ant_installed().await && get_oauth_cred().await.is_some() {
        return "oauth";
    }
    "none"
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthStatus {
    method: &'static str,
    has_auth: bool,
    ant_installed: bool,
    claude_installed: bool,
    claude_logged_in: bool,
}

async fn status() -> Json<AuthStatus> {
    let api_key = env_api_key().is_some();
    let ant_installed = is_ant_installed().await;
    let claude_installed = is_claude_installed().await;
    let cc_logged_in = claude_logged_in();
    let method = if api_key {
        "apikey"
    } else if claude_installed && cc_logged_in {
        "claude-code"
    } else if ant_installed && get_oauth_cred().await.is_some() {
        "oauth"
    } else {
        "none"
    };
    Json(AuthStatus {
        method,
        has_auth: method != "none",
        ant_installed,
        claude_installed,
        claude_logged_in: cc_logged_in,
    })
}

async fn login() -> Response {
    let _guard = LOGIN.lock().await;
    if !is_ant_installed().await {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "ok": false,
                "error": "The Anthropic CLI (`ant`) is not installed. Install it (https://github.com/anthropics/anthropic-cli), then click Sign in again. You can also use an API key instead."
            })),
        )
            .into_response();
    }
    let (code, stdout, stderr) = run_cmd("ant", &["auth", "login"], Duration::from_secs(180)).await;
    if code == 0 {
        (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
    } else {
        let raw = if !stderr.trim().is_empty() {
            stderr.trim()
        } else if !stdout.trim().is_empty() {
            stdout.trim()
        } else {
            "Login failed or was cancelled."
        };
        let msg: String = raw.chars().take(600).collect();
        (StatusCode::BAD_REQUEST, Json(json!({ "ok": false, "error": msg }))).into_response()
    }
}

async fn logout() -> Json<Value> {
    let _ = run_cmd("ant", &["auth", "logout"], Duration::from_secs(15)).await;
    Json(json!({ "ok": true }))
}
