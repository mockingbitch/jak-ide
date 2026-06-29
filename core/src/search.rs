use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::{
    extract::{Query, State},
    routing::{get, post},
    Json, Router,
};
use grep_matcher::Matcher;
use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use grep_searcher::sinks::UTF8;
use grep_searcher::{BinaryDetection, SearcherBuilder};
use ignore::overrides::{Override, OverrideBuilder};
use ignore::{Walk, WalkBuilder};
use regex::{NoExpand, Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{ApiError, ApiResult};
use crate::paths::resolve_safe;
use crate::state::{ignored_dirs, AppState};

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/search/files", get(search_files))
        .route("/api/search/text", get(search_text))
        .route("/api/search/replace", post(replace))
        .route("/api/index/refresh", post(refresh_index))
}

// ---- file-name fuzzy search (unchanged) ----

#[derive(Deserialize)]
struct FilesQuery {
    q: Option<String>,
    limit: Option<usize>,
}

async fn search_files(State(st): State<Arc<AppState>>, Query(q): Query<FilesQuery>) -> Json<Value> {
    let limit = q.limit.unwrap_or(50).min(500);
    let results = st.index.search(q.q.as_deref().unwrap_or(""), limit);
    Json(json!({ "results": results }))
}

// ---- content search/replace options (shared) ----

/// Find options. Deserialised from the query string (GET /search/text) and JSON
/// body (POST /search/replace) — `serde(default)` so every flag is optional.
#[derive(Deserialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
struct Opts {
    q: String,
    regex: bool,
    case_sensitive: bool,
    whole_word: bool,
    /// Comma/newline-separated globs; when present, ONLY matching files are searched.
    include: String,
    /// Comma/newline-separated globs to skip (on top of .gitignore + ignored dirs).
    exclude: String,
    limit: Option<usize>,
}

/// The regex source for both the searcher and the replacer, so a match found by
/// search is the exact match rewritten by replace. Literal queries are escaped;
/// whole-word wraps the pattern in `\b…\b`.
fn pattern_for(o: &Opts) -> String {
    let base = if o.regex { o.q.clone() } else { regex::escape(&o.q) };
    if o.whole_word {
        format!(r"\b(?:{base})\b")
    } else {
        base
    }
}

fn build_matcher(o: &Opts) -> Result<RegexMatcher, String> {
    RegexMatcherBuilder::new()
        .case_insensitive(!o.case_sensitive)
        .build(&pattern_for(o))
        .map_err(|e| e.to_string())
}

fn build_override(root: &Path, include: &str, exclude: &str) -> Result<Override, String> {
    let mut ob = OverrideBuilder::new(root);
    for g in include.split([',', '\n']).map(str::trim).filter(|s| !s.is_empty()) {
        ob.add(g).map_err(|e| e.to_string())?;
    }
    for g in exclude.split([',', '\n']).map(str::trim).filter(|s| !s.is_empty()) {
        ob.add(&format!("!{g}")).map_err(|e| e.to_string())?;
    }
    ob.build().map_err(|e| e.to_string())
}

fn build_walker(root: &Path, ov: Override) -> Walk {
    let ignore = ignored_dirs();
    WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_global(false)
        .parents(false)
        .overrides(ov)
        .filter_entry(move |e| {
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            !(is_dir && ignore.contains(e.file_name().to_string_lossy().as_ref()))
        })
        .build()
}

fn utf16_len(s: &str) -> u32 {
    s.encode_utf16().count() as u32
}

// ---- content search ----

#[derive(Serialize, Debug)]
struct Hit {
    path: String,
    line: u64,
    /// 1-based column of the first match (UTF-16 units, for editor navigation).
    col: u32,
    /// First-match span as UTF-16 offsets into `text`, for highlighting.
    #[serde(rename = "matchStart")]
    match_start: u32,
    #[serde(rename = "matchEnd")]
    match_end: u32,
    text: String,
}

async fn search_text(State(st): State<Arc<AppState>>, Query(o): Query<Opts>) -> Json<Value> {
    if o.q.trim().is_empty() {
        return Json(json!({ "results": [] }));
    }
    let limit = o.limit.unwrap_or(500).min(5000);
    let root = st.root();
    let res = tokio::task::spawn_blocking(move || search_impl(&root, &o, limit))
        .await
        .unwrap_or_else(|_| Err("search task failed".into()));
    match res {
        Ok(hits) => Json(json!({ "results": hits })),
        // Invalid regex / glob → 200 with an inline error so the panel can show it.
        Err(e) => Json(json!({ "results": [], "error": e })),
    }
}

/// Content search across the project (ripgrep libs): gitignore-aware, pruning
/// ignored dirs, honouring include/exclude globs, bounded to `limit` total matches.
fn search_impl(root: &Path, o: &Opts, limit: usize) -> Result<Vec<Hit>, String> {
    let matcher = build_matcher(o)?;
    let ov = build_override(root, &o.include, &o.exclude)?;
    let walker = build_walker(root, ov);
    // One reusable searcher with binary detection (skip binary files instead of
    // dumping garbage / aborting mid-file).
    let mut searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(b'\x00'))
        .build();
    let mut out: Vec<Hit> = Vec::new();
    for dent in walker.flatten() {
        if out.len() >= limit {
            break;
        }
        if !dent.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        // posix rel path; skip non-UTF8 paths the editor can't round-trip
        let rel = match dent.path().strip_prefix(root).ok().and_then(|p| p.to_str()) {
            Some(s) => s.replace('\\', "/"),
            None => continue,
        };
        let m = &matcher;
        let _ = searcher.search_path(
            m,
            dent.path(),
            UTF8(|lnum, line| {
                let t = line.trim_end_matches(['\n', '\r']);
                // First match span on the line (byte offsets within `t`).
                let span = m.find(t.as_bytes()).ok().flatten();
                let (cs, ce) = span.map(|x| (x.start(), x.end())).unwrap_or((0, 0));
                // Cap a single match line so a minified/no-newline file can't emit megabytes.
                let text: String = if t.chars().count() > 500 { t.chars().take(500).collect() } else { t.to_string() };
                let kept = text.len();
                let (mstart, mend) = if ce > cs && ce <= kept {
                    (utf16_len(&t[..cs]), utf16_len(&t[..ce]))
                } else {
                    (0, 0)
                };
                out.push(Hit { path: rel.clone(), line: lnum, col: mstart + 1, match_start: mstart, match_end: mend, text });
                Ok(out.len() < limit)
            }),
        );
    }
    Ok(out)
}

// ---- project-wide replace ----

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct ReplaceBody {
    q: String,
    replacement: String,
    regex: bool,
    case_sensitive: bool,
    whole_word: bool,
    include: String,
    exclude: String,
    /// Restrict the replace to these rel paths (the panel can exclude files); when
    /// absent, every file matching the include/exclude globs is rewritten.
    files: Option<Vec<String>>,
}

fn build_replacer(o: &Opts) -> Result<Regex, String> {
    RegexBuilder::new(&pattern_for(o))
        .case_insensitive(!o.case_sensitive)
        .build()
        .map_err(|e| e.to_string())
}

async fn replace(State(st): State<Arc<AppState>>, Json(b): Json<ReplaceBody>) -> ApiResult<Json<Value>> {
    if b.q.is_empty() {
        return Err(ApiError::bad("Empty search query"));
    }
    let o = Opts {
        q: b.q,
        regex: b.regex,
        case_sensitive: b.case_sensitive,
        whole_word: b.whole_word,
        include: b.include,
        exclude: b.exclude,
        limit: None,
    };
    let re = build_replacer(&o).map_err(|e| ApiError::bad(format!("Invalid pattern: {e}")))?;
    let root = st.root();
    let replacement = b.replacement;
    let files = b.files;
    let (changed, total) = tokio::task::spawn_blocking(move || replace_impl(&root, &o, &re, &replacement, files))
        .await
        .map_err(|_| ApiError::internal("replace task failed"))??;
    Ok(Json(json!({ "ok": true, "filesChanged": changed, "replacements": total })))
}

/// Returns (files changed, total replacements). Files that aren't valid UTF-8 are
/// skipped (binary). Literal mode uses `NoExpand` so `$`/`\` in the replacement stay
/// literal; regex mode expands `$1`/`${name}` capture references.
fn replace_impl(root: &Path, o: &Opts, re: &Regex, replacement: &str, files: Option<Vec<String>>) -> ApiResult<(usize, usize)> {
    let targets: Vec<PathBuf> = match files {
        Some(list) => list.iter().map(|p| resolve_safe(root, p)).collect::<ApiResult<_>>()?,
        None => {
            let ov = build_override(root, &o.include, &o.exclude).map_err(ApiError::bad)?;
            build_walker(root, ov)
                .flatten()
                .filter(|d| d.file_type().map(|t| t.is_file()).unwrap_or(false))
                .map(|d| d.path().to_path_buf())
                .collect()
        }
    };
    let mut files_changed = 0usize;
    let mut total = 0usize;
    for path in targets {
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue, // binary / unreadable → skip
        };
        let n = re.find_iter(&content).count();
        if n == 0 {
            continue;
        }
        let new = if o.regex {
            re.replace_all(&content, replacement)
        } else {
            re.replace_all(&content, NoExpand(replacement))
        };
        if new != content {
            std::fs::write(&path, new.as_ref())?;
            files_changed += 1;
            total += n;
        }
    }
    Ok((files_changed, total))
}

async fn refresh_index(State(st): State<Arc<AppState>>) -> Json<Value> {
    let root = st.root();
    let idx = st.index.clone();
    let _ = tokio::task::spawn_blocking(move || idx.rebuild(&root)).await;
    Json(json!({ "ok": true, "count": st.index.len() }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(q: &str) -> Opts {
        Opts { q: q.into(), ..Default::default() }
    }

    fn scratch(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("jak-search-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn pattern_escapes_literals_and_wraps_words() {
        assert_eq!(pattern_for(&opts("a.b")), r"a\.b");
        assert_eq!(pattern_for(&Opts { regex: true, ..opts("a.b") }), "a.b");
        assert_eq!(pattern_for(&Opts { whole_word: true, ..opts("foo") }), r"\b(?:foo)\b");
    }

    #[test]
    fn search_finds_matches_with_offsets_and_respects_case() {
        let root = scratch("find");
        std::fs::write(root.join("a.txt"), "hello World\nno match here\nWORLD again\n").unwrap();

        // case-insensitive (default): both "World" and "WORLD" lines hit.
        let hits = search_impl(&root, &opts("world"), 100).unwrap();
        assert_eq!(hits.len(), 2);
        let first = hits.iter().find(|h| h.line == 1).unwrap();
        assert_eq!(first.match_start, 6); // "hello " is 6 UTF-16 units
        assert_eq!(first.match_end, 11);
        assert_eq!(first.col, 7);

        // case-sensitive: only the exact-case "World" line.
        let hits = search_impl(&root, &Opts { case_sensitive: true, ..opts("World") }, 100).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 1);
    }

    #[test]
    fn whole_word_and_glob_filters_apply() {
        let root = scratch("word");
        std::fs::write(root.join("a.rs"), "let foo = 1;\nlet foobar = 2;\n").unwrap();
        std::fs::write(root.join("b.txt"), "foo in text\n").unwrap();

        // whole-word "foo" skips "foobar"; include glob keeps only the .rs file.
        let hits = search_impl(&root, &Opts { whole_word: true, include: "*.rs".into(), ..opts("foo") }, 100).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 1);
        assert!(hits[0].path.ends_with("a.rs"));
    }

    #[test]
    fn invalid_regex_is_reported() {
        let root = scratch("badre");
        let err = search_impl(&root, &Opts { regex: true, ..opts("(unclosed") }, 10).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn replace_literal_is_dollar_safe() {
        let root = scratch("repl-lit");
        let f = root.join("a.txt");
        std::fs::write(&f, "price is X here and X there\n").unwrap();
        let o = opts("X");
        let re = build_replacer(&o).unwrap();
        let (changed, total) = replace_impl(&root, &o, &re, "$5", None).unwrap();
        assert_eq!((changed, total), (1, 2));
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "price is $5 here and $5 there\n");
    }

    #[test]
    fn replace_regex_expands_captures_on_listed_files_only() {
        let root = scratch("repl-re");
        std::fs::write(root.join("a.txt"), "key=value\n").unwrap();
        std::fs::write(root.join("b.txt"), "key=other\n").unwrap();
        let o = Opts { regex: true, ..opts(r"(\w+)=(\w+)") };
        let re = build_replacer(&o).unwrap();
        // only a.txt is listed → b.txt untouched
        let (changed, total) = replace_impl(&root, &o, &re, "$2=$1", Some(vec!["a.txt".into()])).unwrap();
        assert_eq!((changed, total), (1, 1));
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "value=key\n");
        assert_eq!(std::fs::read_to_string(root.join("b.txt")).unwrap(), "key=other\n");
    }
}
