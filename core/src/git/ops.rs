//! Git operations, ported 1:1 from the Node `gitService`. Every function takes
//! the repo `cwd` (the live project root) so it follows project switches. Output
//! shapes match the old JSON contracts the frontend already parses.

use std::path::Path;

use serde::Serialize;

use super::exec::{git, run, GitError};
use crate::paths::resolve_safe;

// ---------------------------------------------------------------------------
// Repository state
// ---------------------------------------------------------------------------

pub async fn is_repo(cwd: &Path) -> bool {
    match run(cwd, &["rev-parse", "--is-inside-work-tree"], None).await {
        Ok(r) => r.code == 0 && r.stdout.trim() == "true",
        Err(_) => false,
    }
}

pub async fn init(cwd: &Path) -> Result<(), GitError> {
    git(cwd, &["init"]).await.map(|_| ())
}

#[derive(Serialize)]
pub struct FileEntry {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orig: Option<String>,
    pub index: String,
    pub work: String,
    pub conflicted: bool,
}

#[derive(Serialize)]
pub struct Status {
    pub repo: bool,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: i64,
    pub behind: i64,
    pub detached: bool,
    pub files: Vec<FileEntry>,
}

pub async fn status(cwd: &Path) -> Result<Status, GitError> {
    if !is_repo(cwd).await {
        return Ok(Status {
            repo: false,
            branch: None,
            upstream: None,
            ahead: 0,
            behind: 0,
            detached: false,
            files: Vec::new(),
        });
    }
    let out = git(cwd, &["status", "--porcelain=v2", "--branch", "-z"]).await?;
    Ok(parse_status_v2(&out))
}

fn nth_char(s: &str, n: usize) -> String {
    s.chars().nth(n).map(|c| c.to_string()).unwrap_or_else(|| ".".to_string())
}

fn parse_status_v2(out: &str) -> Status {
    let tokens: Vec<&str> = out.split('\0').collect();
    let mut files: Vec<FileEntry> = Vec::new();
    let mut branch = None;
    let mut upstream = None;
    let mut ahead = 0i64;
    let mut behind = 0i64;
    let mut detached = false;

    let mut i = 0;
    while i < tokens.len() {
        let rec = tokens[i];
        if rec.is_empty() {
            i += 1;
            continue;
        }
        if let Some(rest) = rec.strip_prefix("# ") {
            let mut it = rest.splitn(2, ' ');
            let key = it.next().unwrap_or("");
            let val = it.next().unwrap_or("");
            match key {
                "branch.head" => {
                    detached = val == "(detached)";
                    branch = if detached { None } else { Some(val.to_string()) };
                }
                "branch.upstream" => upstream = Some(val.to_string()),
                "branch.ab" => {
                    for part in val.split_whitespace() {
                        if let Some(n) = part.strip_prefix('+') {
                            ahead = n.parse().unwrap_or(0);
                        } else if let Some(n) = part.strip_prefix('-') {
                            behind = n.parse().unwrap_or(0);
                        }
                    }
                }
                _ => {}
            }
            i += 1;
            continue;
        }
        match rec.as_bytes()[0] {
            b'1' => {
                let f: Vec<&str> = rec.split(' ').collect();
                let xy = f.get(1).copied().unwrap_or("..");
                files.push(FileEntry {
                    path: f.get(8..).map(|s| s.join(" ")).unwrap_or_default(),
                    orig: None,
                    index: nth_char(xy, 0),
                    work: nth_char(xy, 1),
                    conflicted: false,
                });
            }
            b'2' => {
                let f: Vec<&str> = rec.split(' ').collect();
                let xy = f.get(1).copied().unwrap_or("..");
                i += 1; // rename source is the next NUL field
                let orig = tokens.get(i).copied().unwrap_or("").to_string();
                files.push(FileEntry {
                    path: f.get(9..).map(|s| s.join(" ")).unwrap_or_default(),
                    orig: Some(orig),
                    index: nth_char(xy, 0),
                    work: nth_char(xy, 1),
                    conflicted: false,
                });
            }
            b'u' => {
                let f: Vec<&str> = rec.split(' ').collect();
                let xy = f.get(1).copied().unwrap_or("..");
                files.push(FileEntry {
                    path: f.get(10..).map(|s| s.join(" ")).unwrap_or_default(),
                    orig: None,
                    index: nth_char(xy, 0),
                    work: nth_char(xy, 1),
                    conflicted: true,
                });
            }
            b'?' => {
                files.push(FileEntry {
                    path: rec.get(2..).unwrap_or("").to_string(),
                    orig: None,
                    index: "?".into(),
                    work: "?".into(),
                    conflicted: false,
                });
            }
            _ => {}
        }
        i += 1;
    }
    Status { repo: true, branch, upstream, ahead, behind, detached, files }
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct BranchInfo {
    pub name: String,
    pub current: bool,
    pub sha: String,
    pub upstream: Option<String>,
}

#[derive(Serialize)]
pub struct Branches {
    pub current: Option<String>,
    pub local: Vec<BranchInfo>,
    pub remote: Vec<String>,
}

pub async fn branches(cwd: &Path) -> Result<Branches, GitError> {
    let fmt = "--format=%(HEAD)%00%(refname:short)%00%(objectname:short)%00%(upstream:short)";
    let out = git(cwd, &["for-each-ref", fmt, "refs/heads"]).await?;
    let local: Vec<BranchInfo> = out
        .lines()
        .filter(|l| !l.is_empty())
        .map(|line| {
            let p: Vec<&str> = line.split('\0').collect();
            BranchInfo {
                name: p.get(1).copied().unwrap_or("").to_string(),
                current: p.first().copied().unwrap_or("") == "*",
                sha: p.get(2).copied().unwrap_or("").to_string(),
                upstream: p.get(3).copied().filter(|s| !s.is_empty()).map(|s| s.to_string()),
            }
        })
        .collect();
    let remote_out = git(cwd, &["for-each-ref", "--format=%(refname:short)", "refs/remotes"]).await?;
    let remote: Vec<String> = remote_out
        .lines()
        .filter(|b| !b.is_empty() && b.contains('/') && !b.ends_with("/HEAD"))
        .map(|s| s.to_string())
        .collect();
    let current = local.iter().find(|b| b.current).map(|b| b.name.clone());
    Ok(Branches { current, local, remote })
}

pub async fn create_branch(cwd: &Path, name: &str, checkout: bool, start_point: Option<&str>) -> Result<(), GitError> {
    let mut args: Vec<&str> = if checkout { vec!["checkout", "-b", name] } else { vec!["branch", name] };
    if let Some(sp) = start_point {
        args.push(sp);
    }
    git(cwd, &args).await.map(|_| ())
}

pub async fn checkout(cwd: &Path, name: &str) -> Result<(), GitError> {
    git(cwd, &["checkout", name]).await.map(|_| ())
}

/// Check out a remote branch (e.g. 'origin/foo') as a local tracking branch.
pub async fn checkout_remote(cwd: &Path, remote: &str) -> Result<(), GitError> {
    git(cwd, &["checkout", "--track", remote]).await.map(|_| ())
}

pub async fn rename_branch(cwd: &Path, old_name: &str, new_name: &str) -> Result<(), GitError> {
    git(cwd, &["branch", "-m", old_name, new_name]).await.map(|_| ())
}

pub async fn delete_branch(cwd: &Path, name: &str, force: bool) -> Result<(), GitError> {
    git(cwd, &["branch", if force { "-D" } else { "-d" }, name]).await.map(|_| ())
}

/// A merge ending in conflicts is a normal, recoverable outcome (not an error):
/// return its output so the UI can refresh and show conflicts to resolve.
pub async fn merge(cwd: &Path, name: &str) -> Result<String, GitError> {
    let r = run(cwd, &["merge", "--no-edit", name], None).await?;
    if r.code != 0 {
        let combined = format!("{}{}", r.stdout, r.stderr);
        let lc = combined.to_lowercase();
        if lc.contains("conflict") || lc.contains("automatic merge failed") || lc.contains("fix conflicts") {
            return Ok(combined);
        }
        let msg = if !r.stderr.trim().is_empty() {
            r.stderr.trim().to_string()
        } else if !r.stdout.trim().is_empty() {
            r.stdout.trim().to_string()
        } else {
            "merge failed".to_string()
        };
        return Err(GitError::new(msg, r.code));
    }
    Ok(r.stdout)
}

// ---------------------------------------------------------------------------
// Staging, commit, discard
// ---------------------------------------------------------------------------

pub async fn stage(cwd: &Path, paths: &[String]) -> Result<(), GitError> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut args: Vec<&str> = vec!["add", "--"];
    args.extend(paths.iter().map(|s| s.as_str()));
    git(cwd, &args).await.map(|_| ())
}

pub async fn stage_all(cwd: &Path) -> Result<(), GitError> {
    git(cwd, &["add", "-A"]).await.map(|_| ())
}

pub async fn unstage(cwd: &Path, paths: &[String]) -> Result<(), GitError> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut args: Vec<&str> = vec!["reset", "-q", "HEAD", "--"];
    args.extend(paths.iter().map(|s| s.as_str()));
    git(cwd, &args).await.map(|_| ())
}

pub async fn unstage_all(cwd: &Path) -> Result<(), GitError> {
    git(cwd, &["reset", "-q", "HEAD"]).await.map(|_| ())
}

/// Discard working-tree changes for tracked files (revert to HEAD).
pub async fn discard(cwd: &Path, paths: &[String]) -> Result<(), GitError> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut args: Vec<&str> = vec!["checkout", "HEAD", "--"];
    args.extend(paths.iter().map(|s| s.as_str()));
    git(cwd, &args).await.map(|_| ())
}

/// Resolve a merge conflict by taking one side, then stage the file.
pub async fn resolve(cwd: &Path, file: &str, side: &str) -> Result<(), GitError> {
    let side_arg = format!("--{side}");
    git(cwd, &["checkout", side_arg.as_str(), "--", file]).await?;
    git(cwd, &["add", "--", file]).await.map(|_| ())
}

pub async fn commit(cwd: &Path, message: &str, amend: bool) -> Result<String, GitError> {
    let mut args: Vec<&str> = vec!["commit", "-m", message];
    if amend {
        args.push("--amend");
    }
    git(cwd, &args).await
}

/// Commit exactly the given files (PhpStorm-style checkbox commit). Stages the
/// listed paths that still exist (a staged rename's source no longer exists but
/// must stay in the commit pathspec), then partial-commits just those paths.
pub async fn commit_files(cwd: &Path, message: &str, paths: &[String]) -> Result<String, GitError> {
    if paths.is_empty() {
        return Err(GitError::new("No files selected to commit", 1));
    }
    let to_add: Vec<&str> = paths
        .iter()
        .filter(|p| resolve_safe(cwd, p).map(|abs| abs.exists()).unwrap_or(false))
        .map(|s| s.as_str())
        .collect();
    if !to_add.is_empty() {
        let mut add_args: Vec<&str> = vec!["add", "--"];
        add_args.extend(to_add.iter().copied());
        git(cwd, &add_args).await?;
    }
    let mut args: Vec<&str> = vec!["commit", "-m", message, "--"];
    args.extend(paths.iter().map(|s| s.as_str()));
    git(cwd, &args).await
}

// ---------------------------------------------------------------------------
// Diff / conflict — before/after text for the Monaco DiffEditor
// ---------------------------------------------------------------------------

/// Contents of `file` at a git ref (e.g. 'HEAD', ':0' for index). '' if absent.
async fn show_at(cwd: &Path, reference: &str, file: &str) -> String {
    let spec = format!("{reference}:{file}");
    match run(cwd, &["show", spec.as_str()], None).await {
        Ok(r) if r.code == 0 => r.stdout,
        _ => String::new(),
    }
}

/// Read a working-tree file (path-safe); '' if missing or unreadable.
fn read_working(cwd: &Path, file: &str) -> String {
    match resolve_safe(cwd, file) {
        Ok(abs) => std::fs::read_to_string(abs).unwrap_or_default(),
        Err(_) => String::new(),
    }
}

#[derive(Serialize)]
pub struct FileDiff {
    pub path: String,
    pub mode: String,
    pub base: String,
    pub modified: String,
    pub binary: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

pub async fn diff_file(cwd: &Path, file: &str, mode: &str) -> FileDiff {
    let base = show_at(cwd, "HEAD", file).await;
    let modified = if mode == "staged" {
        show_at(cwd, ":0", file).await // index version
    } else {
        read_working(cwd, file)
    };
    let binary = base.contains('\0') || modified.contains('\0');
    FileDiff { path: file.to_string(), mode: mode.to_string(), base, modified, binary, title: None }
}

/// Diff a file as introduced by a specific commit (parent ↔ commit).
pub async fn commit_diff(cwd: &Path, hash: &str, file: &str) -> FileDiff {
    let parent = format!("{hash}^");
    let base = show_at(cwd, &parent, file).await; // '' for the root commit
    let modified = show_at(cwd, hash, file).await;
    let binary = base.contains('\0') || modified.contains('\0');
    let short: String = hash.chars().take(7).collect();
    FileDiff {
        path: file.to_string(),
        mode: "commit".to_string(),
        base,
        modified,
        binary,
        title: Some(format!("{short} ↔ parent")),
    }
}

#[derive(Serialize)]
pub struct Conflict {
    pub path: String,
    pub base: String,
    pub ours: String,
    pub theirs: String,
    pub working: String,
}

/// The three conflict stages of a file plus the working copy, for a 3-way merge UI.
pub async fn conflict(cwd: &Path, file: &str) -> Conflict {
    let base = show_at(cwd, ":1", file).await;
    let ours = show_at(cwd, ":2", file).await;
    let theirs = show_at(cwd, ":3", file).await;
    let working = read_working(cwd, file);
    Conflict { path: file.to_string(), base, ours, theirs, working }
}

// ---------------------------------------------------------------------------
// Blame
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct BlameLine {
    pub line: u64,
    pub hash: String,
    pub short: String,
    pub author: String,
    pub date: String,
    pub summary: String,
    pub code: String,
}

/// `git blame --porcelain` parsed into per-line attribution.
pub async fn blame(cwd: &Path, file: &str) -> Result<Vec<BlameLine>, GitError> {
    let out = git(cwd, &["blame", "--porcelain", "--", file]).await?;
    let mut meta: std::collections::HashMap<String, (String, String, String)> = std::collections::HashMap::new();
    let mut result: Vec<BlameLine> = Vec::new();
    let mut cur: Option<(String, u64)> = None;
    for l in out.split('\n') {
        if let Some((hash, final_line)) = parse_blame_header(l) {
            meta.entry(hash.clone()).or_insert_with(|| (String::new(), String::new(), String::new()));
            cur = Some((hash, final_line));
            continue;
        }
        let Some((hash, final_line)) = cur.clone() else { continue };
        // The tab line terminates a hunk and emits the row; do it first so we
        // never hold a mutable `meta` borrow across the read.
        if let Some(code) = l.strip_prefix('\t') {
            let (author, date, summary) = meta.get(&hash).cloned().unwrap_or_default();
            result.push(BlameLine {
                line: final_line,
                short: hash.chars().take(7).collect(),
                hash,
                author,
                date,
                summary,
                code: code.to_string(),
            });
            cur = None;
        } else if let Some(a) = l.strip_prefix("author ") {
            meta.entry(hash).or_default().0 = a.to_string();
        } else if let Some(t) = l.strip_prefix("author-time ") {
            meta.entry(hash).or_default().1 = epoch_to_iso(t);
        } else if let Some(s) = l.strip_prefix("summary ") {
            meta.entry(hash).or_default().2 = s.to_string();
        }
    }
    Ok(result)
}

fn parse_blame_header(l: &str) -> Option<(String, u64)> {
    // "<40-hex> <orig-line> <final-line> [<num-lines>]"
    let mut it = l.split(' ');
    let hash = it.next()?;
    if hash.len() != 40 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let _orig = it.next()?.parse::<u64>().ok()?;
    let final_line = it.next()?.parse::<u64>().ok()?;
    Some((hash.to_string(), final_line))
}

fn epoch_to_iso(secs: &str) -> String {
    // Match the Node ISO string; if parsing fails, fall back to the raw value.
    match secs.trim().parse::<i64>() {
        Ok(s) => format_iso_utc(s),
        Err(_) => secs.to_string(),
    }
}

/// Format a unix timestamp (seconds) as an ISO-8601 UTC string, no extra crates.
fn format_iso_utc(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400);
    let (h, m, s) = (tod / 3600, (tod % 3600) / 60, tod % 60);
    let (y, mo, d) = civil_from_days(days);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}.000Z")
}

/// Days since 1970-01-01 → (year, month, day). Howard Hinnant's civil algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

// ---------------------------------------------------------------------------
// History (paginated)
// ---------------------------------------------------------------------------

const US: char = '\x1f'; // unit separator between fields

#[derive(Serialize)]
pub struct Commit {
    pub hash: String,
    pub short: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub date: String,
    pub refs: String,
    pub subject: String,
}

pub async fn log(cwd: &Path, limit: usize, skip: usize, file: Option<&str>) -> Result<Vec<Commit>, GitError> {
    let pretty = format!("--pretty=format:%H{US}%h{US}%P{US}%an{US}%aI{US}%D{US}%s");
    let n = limit.to_string();
    let skip_arg = format!("--skip={skip}");
    let mut args: Vec<&str> = vec!["log", pretty.as_str(), "-z", "-n", n.as_str(), skip_arg.as_str()];
    if let Some(f) = file {
        args.push("--follow");
        args.push("--");
        args.push(f);
    }
    let out = git(cwd, &args).await?;
    let commits = out
        .split('\0')
        .filter(|r| !r.is_empty())
        .map(|rec| {
            let f: Vec<&str> = rec.split(US).collect();
            let g = |i: usize| f.get(i).copied().unwrap_or("").to_string();
            Commit {
                hash: g(0),
                short: g(1),
                parents: f
                    .get(2)
                    .copied()
                    .filter(|s| !s.is_empty())
                    .map(|s| s.split(' ').map(String::from).collect::<Vec<String>>())
                    .unwrap_or_default(),
                author: g(3),
                email: String::new(),
                date: g(4),
                refs: g(5),
                subject: g(6),
            }
        })
        .collect();
    Ok(commits)
}

// ---------------------------------------------------------------------------
// Remote operations
// ---------------------------------------------------------------------------

pub async fn fetch(cwd: &Path) -> Result<String, GitError> {
    git(cwd, &["fetch", "--all", "--prune"]).await
}

pub async fn pull(cwd: &Path) -> Result<String, GitError> {
    git(cwd, &["pull", "--no-edit"]).await
}

pub async fn push(cwd: &Path, set_upstream: bool) -> Result<String, GitError> {
    if set_upstream {
        let branch = git(cwd, &["branch", "--show-current"]).await?.trim().to_string();
        return git(cwd, &["push", "-u", "origin", branch.as_str()]).await;
    }
    git(cwd, &["push"]).await
}

#[derive(Serialize)]
pub struct Remote {
    pub name: String,
    pub url: String,
}

pub async fn remotes(cwd: &Path) -> Vec<Remote> {
    let r = match run(cwd, &["remote", "-v"], None).await {
        Ok(r) if r.code == 0 => r,
        _ => return Vec::new(),
    };
    // dedupe by remote name, keeping the first URL (fetch line)
    let mut seen: Vec<(String, String)> = Vec::new();
    for line in r.stdout.lines().filter(|l| !l.is_empty()) {
        let mut parts = line.splitn(2, '\t');
        let name = parts.next().unwrap_or("");
        let rest = parts.next().unwrap_or("");
        let url = rest.split(' ').next().unwrap_or("");
        if !name.is_empty() && !url.is_empty() && !seen.iter().any(|(n, _)| n == name) {
            seen.push((name.to_string(), url.to_string()));
        }
    }
    seen.into_iter().map(|(name, url)| Remote { name, url }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_v2_branch_and_files() {
        // NUL-terminated records: headers, a modified file (type 1), a rename
        // (type 2 with orig in the next field), an unmerged file (u), untracked (?).
        let recs = [
            "# branch.head main",
            "# branch.upstream origin/main",
            "# branch.ab +3 -1",
            "1 .M N... 100644 100644 100644 aaa bbb a.txt",
            "2 R. N... 100644 100644 100644 ccc ddd R100 new name.txt",
            "old name.txt", // rename source for the type-2 record above
            "u UU N... 100644 100644 100644 100644 e f g conflict.txt",
            "? untracked.txt",
            "",
        ];
        let s = parse_status_v2(&recs.join("\0"));
        assert!(s.repo);
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));
        assert_eq!((s.ahead, s.behind), (3, 1));
        assert!(!s.detached);
        assert_eq!(s.files.len(), 4);

        let a = &s.files[0];
        assert_eq!(a.path, "a.txt");
        assert_eq!((a.index.as_str(), a.work.as_str()), (".", "M"));
        assert!(!a.conflicted);

        let r = &s.files[1];
        assert_eq!(r.path, "new name.txt"); // space-containing path preserved
        assert_eq!(r.orig.as_deref(), Some("old name.txt"));

        let u = &s.files[2];
        assert_eq!(u.path, "conflict.txt");
        assert!(u.conflicted);
        assert_eq!((u.index.as_str(), u.work.as_str()), ("U", "U"));

        let q = &s.files[3];
        assert_eq!(q.path, "untracked.txt");
        assert_eq!((q.index.as_str(), q.work.as_str()), ("?", "?"));
    }

    #[test]
    fn detached_head_reported() {
        let s = parse_status_v2("# branch.head (detached)\0");
        assert!(s.detached);
        assert_eq!(s.branch, None);
    }

    #[test]
    fn epoch_formats_as_iso_utc() {
        assert_eq!(format_iso_utc(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(format_iso_utc(1_704_067_200), "2024-01-01T00:00:00.000Z");
        assert_eq!(format_iso_utc(1_704_070_861), "2024-01-01T01:01:01.000Z");
    }

    #[test]
    fn blame_header_only_matches_full_hash() {
        assert_eq!(parse_blame_header("deadbeef00000000000000000000000000000000 1 2 3").unwrap().1, 2);
        assert!(parse_blame_header("\tcode line").is_none());
        assert!(parse_blame_header("author Jane").is_none());
    }
}
