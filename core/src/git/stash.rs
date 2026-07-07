//! Git stash operations. Thin wrappers over the `git` runner (never shells out);
//! the stash-list parser is unit-tested against real `git stash list` output.

use std::path::Path;

use serde::Serialize;

use super::exec::{git, GitError};

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    /// Stack index (0 = most recent). Use `stash@{index}` as the ref.
    pub index: usize,
    /// The branch the stash was made on ("WIP on main" → "main"), best-effort.
    pub branch: String,
    /// The stash subject line.
    pub message: String,
}

/// `git stash list` parsed into entries. Uses a NUL-safe custom format so
/// messages containing `:` or `|` never corrupt the split.
pub async fn list(cwd: &Path) -> Result<Vec<StashEntry>, GitError> {
    // %gd = selector (stash@{N}); %gs = reflog subject ("WIP on main: <msg>").
    let out = git(cwd, &["stash", "list", "--format=%gd%x00%gs%x00%x00"]).await?;
    Ok(parse_stash_list(&out))
}

fn parse_stash_list(out: &str) -> Vec<StashEntry> {
    let mut entries = Vec::new();
    for rec in out.split("\u{0}\u{0}") {
        let rec = rec.trim_matches(['\n', '\r']);
        if rec.is_empty() {
            continue;
        }
        let mut parts = rec.split('\u{0}');
        let selector = parts.next().unwrap_or("");
        let subject = parts.next().unwrap_or("");
        // selector: stash@{N}
        let index = selector
            .strip_prefix("stash@{")
            .and_then(|s| s.strip_suffix('}'))
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(entries.len());
        // subject: "WIP on <branch>: <msg>" or "On <branch>: <msg>".
        let (branch, message) = split_subject(subject);
        entries.push(StashEntry { index, branch, message });
    }
    entries
}

/// Split "WIP on main: tweak" / "On main: tweak" into ("main", "tweak").
fn split_subject(subject: &str) -> (String, String) {
    let rest = subject.strip_prefix("WIP on ").or_else(|| subject.strip_prefix("On ")).unwrap_or(subject);
    match rest.split_once(": ") {
        Some((branch, msg)) => (branch.to_string(), msg.to_string()),
        None => (String::new(), rest.to_string()),
    }
}

/// `git stash push` (optionally including untracked / keeping the index).
pub async fn push(cwd: &Path, message: Option<&str>, include_untracked: bool, keep_index: bool) -> Result<String, GitError> {
    let mut args: Vec<&str> = vec!["stash", "push"];
    if include_untracked {
        args.push("--include-untracked");
    }
    if keep_index {
        args.push("--keep-index");
    }
    if let Some(m) = message.filter(|m| !m.trim().is_empty()) {
        args.push("--message");
        args.push(m);
    }
    git(cwd, &args).await
}

fn valid_ref(reference: &str) -> Result<&str, GitError> {
    // Only allow the exact `stash@{N}` shape we generate — never free text.
    let ok = reference
        .strip_prefix("stash@{")
        .and_then(|s| s.strip_suffix('}'))
        .map(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
        .unwrap_or(false);
    if ok {
        Ok(reference)
    } else {
        Err(GitError::new("invalid stash reference", 1))
    }
}

pub async fn apply(cwd: &Path, reference: &str) -> Result<String, GitError> {
    git(cwd, &["stash", "apply", valid_ref(reference)?]).await
}

pub async fn pop(cwd: &Path, reference: &str) -> Result<String, GitError> {
    git(cwd, &["stash", "pop", valid_ref(reference)?]).await
}

pub async fn drop(cwd: &Path, reference: &str) -> Result<String, GitError> {
    git(cwd, &["stash", "drop", valid_ref(reference)?]).await
}

/// Full patch of a stash (`git stash show -p`) for the diff viewer.
pub async fn show(cwd: &Path, reference: &str) -> Result<String, GitError> {
    git(cwd, &["stash", "show", "-p", "--include-untracked", valid_ref(reference)?]).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_stash_list_with_branch_and_message() {
        // Records are `%gd\0%gs\0\0`.
        let out = "stash@{0}\u{0}WIP on main: quick fix\u{0}\u{0}stash@{1}\u{0}On feature/x: half-done: work\u{0}\u{0}";
        let entries = parse_stash_list(out);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0], StashEntry { index: 0, branch: "main".into(), message: "quick fix".into() });
        assert_eq!(entries[1].index, 1);
        assert_eq!(entries[1].branch, "feature/x");
        // Only the FIRST ": " splits branch from message; the rest is kept.
        assert_eq!(entries[1].message, "half-done: work");
    }

    #[test]
    fn empty_list_is_empty() {
        assert!(parse_stash_list("").is_empty());
        assert!(parse_stash_list("\n").is_empty());
    }

    #[test]
    fn ref_validation_blocks_injection() {
        assert!(valid_ref("stash@{0}").is_ok());
        assert!(valid_ref("stash@{12}").is_ok());
        assert!(valid_ref("stash@{0}; rm -rf /").is_err());
        assert!(valid_ref("--all").is_err());
        assert!(valid_ref("").is_err());
        assert!(valid_ref("stash@{}").is_err());
    }
}
