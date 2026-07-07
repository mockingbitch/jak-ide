//! History-affecting git actions: reset, clean, revert, cherry-pick, rebase, and
//! merge/rebase abort/continue, plus detection of an in-progress operation so the
//! UI can show an Abort/Continue banner. Thin wrappers over the `git` runner;
//! the clean-output and state-detection parsers are unit-tested.

use std::path::{Path, PathBuf};

use serde::Serialize;

use super::exec::{git, run, GitError};

/// Reject a user-supplied ref/target that could be read as a git flag. (Args are
/// never shell-interpreted, but a leading `-` would be parsed as an option.)
fn safe_ref(reference: &str) -> Result<&str, GitError> {
    let r = reference.trim();
    if r.is_empty() || r.starts_with('-') {
        return Err(GitError::new("invalid revision", 1));
    }
    Ok(r)
}

/// `git reset --{soft|mixed|hard} <target>`. `target` defaults to HEAD.
pub async fn reset(cwd: &Path, mode: &str, target: &str) -> Result<String, GitError> {
    let flag = match mode {
        "soft" => "--soft",
        "mixed" => "--mixed",
        "hard" => "--hard",
        _ => return Err(GitError::new("mode must be soft, mixed, or hard", 1)),
    };
    let target = if target.trim().is_empty() { "HEAD" } else { safe_ref(target)? };
    git(cwd, &["reset", flag, target]).await
}

/// `git clean` — remove untracked files. `dry_run` previews (`Would remove …`);
/// otherwise force-removes. `dirs` also clears untracked directories.
pub async fn clean(cwd: &Path, dry_run: bool, dirs: bool) -> Result<Vec<String>, GitError> {
    let mut args: Vec<&str> = vec!["clean"];
    args.push(if dry_run { "-n" } else { "-f" });
    if dirs {
        args.push("-d");
    }
    let out = git(cwd, &args).await?;
    Ok(parse_clean(&out))
}

/// Extract the affected paths from `git clean` output ("Would remove X" /
/// "Removing X").
fn parse_clean(out: &str) -> Vec<String> {
    out.lines()
        .filter_map(|l| {
            let l = l.trim();
            l.strip_prefix("Would remove ").or_else(|| l.strip_prefix("Removing ")).map(str::to_string)
        })
        .collect()
}

/// `git revert --no-edit [--no-commit] <hash>`.
pub async fn revert(cwd: &Path, hash: &str, no_commit: bool) -> Result<String, GitError> {
    let hash = safe_ref(hash)?;
    let mut args: Vec<&str> = vec!["revert", "--no-edit"];
    if no_commit {
        args.push("--no-commit");
    }
    args.push(hash);
    git(cwd, &args).await
}

/// `git cherry-pick [--no-commit] <hash>`.
pub async fn cherry_pick(cwd: &Path, hash: &str, no_commit: bool) -> Result<String, GitError> {
    let hash = safe_ref(hash)?;
    let mut args: Vec<&str> = vec!["cherry-pick"];
    if no_commit {
        args.push("--no-commit");
    }
    args.push(hash);
    git(cwd, &args).await
}

/// `git rebase <onto>` — replay the current branch onto `onto`.
pub async fn rebase(cwd: &Path, onto: &str) -> Result<String, GitError> {
    git(cwd, &["rebase", safe_ref(onto)?]).await
}

pub async fn rebase_abort(cwd: &Path) -> Result<String, GitError> {
    git(cwd, &["rebase", "--abort"]).await
}
pub async fn rebase_continue(cwd: &Path) -> Result<String, GitError> {
    git(cwd, &["rebase", "--continue"]).await
}
pub async fn merge_abort(cwd: &Path) -> Result<String, GitError> {
    git(cwd, &["merge", "--abort"]).await
}
pub async fn merge_continue(cwd: &Path) -> Result<String, GitError> {
    git(cwd, &["merge", "--continue"]).await
}
pub async fn cherry_pick_abort(cwd: &Path) -> Result<String, GitError> {
    git(cwd, &["cherry-pick", "--abort"]).await
}
pub async fn cherry_pick_continue(cwd: &Path) -> Result<String, GitError> {
    git(cwd, &["cherry-pick", "--continue"]).await
}
pub async fn revert_abort(cwd: &Path) -> Result<String, GitError> {
    git(cwd, &["revert", "--abort"]).await
}
pub async fn revert_continue(cwd: &Path) -> Result<String, GitError> {
    git(cwd, &["revert", "--continue"]).await
}

/// True while a merge or cherry-pick is in progress — during which git forbids a
/// path-scoped (partial) commit, so `commit_files` must commit without a pathspec.
pub async fn partial_commit_blocked(cwd: &Path) -> bool {
    let s = operation_state(cwd).await;
    s.merging || s.cherry_picking
}

/// Which multi-step operation (if any) is mid-flight. Drives the Abort/Continue
/// banner in the UI.
#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OperationState {
    pub merging: bool,
    pub rebasing: bool,
    pub cherry_picking: bool,
    pub reverting: bool,
}

pub async fn operation_state(cwd: &Path) -> OperationState {
    // Resolve the real git dir (handles worktrees / `.git` files).
    let git_dir = match run(cwd, &["rev-parse", "--absolute-git-dir"], None).await {
        Ok(r) if r.code == 0 => PathBuf::from(r.stdout.trim()),
        _ => cwd.join(".git"),
    };
    detect_state(&git_dir)
}

fn detect_state(git_dir: &Path) -> OperationState {
    let has = |p: &str| git_dir.join(p).exists();
    OperationState {
        merging: has("MERGE_HEAD"),
        // interactive vs apply-based rebases use different scratch dirs.
        rebasing: has("rebase-merge") || has("rebase-apply"),
        cherry_picking: has("CHERRY_PICK_HEAD"),
        reverting: has("REVERT_HEAD"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_clean_extracts_paths() {
        let dry = "Would remove build/\nWould remove tmp.log\n";
        assert_eq!(parse_clean(dry), vec!["build/", "tmp.log"]);
        let done = "Removing a.txt\nRemoving dir/b.txt\n";
        assert_eq!(parse_clean(done), vec!["a.txt", "dir/b.txt"]);
        assert!(parse_clean("").is_empty());
    }

    #[test]
    fn detect_state_reads_marker_files() {
        let d = std::env::temp_dir().join(format!("jak-gitstate-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        assert_eq!(detect_state(&d), OperationState::default());

        std::fs::write(d.join("MERGE_HEAD"), "x").unwrap();
        assert!(detect_state(&d).merging);

        std::fs::create_dir_all(d.join("rebase-merge")).unwrap();
        let s = detect_state(&d);
        assert!(s.merging && s.rebasing);

        std::fs::write(d.join("CHERRY_PICK_HEAD"), "x").unwrap();
        assert!(detect_state(&d).cherry_picking);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn safe_ref_blocks_flag_like_values() {
        assert!(safe_ref("HEAD~1").is_ok());
        assert!(safe_ref("abc123").is_ok());
        assert!(safe_ref("--hard").is_err());
        assert!(safe_ref("").is_err());
        assert!(safe_ref("  ").is_err());
    }
}
