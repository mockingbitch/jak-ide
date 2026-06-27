use crate::error::ApiError;
use std::path::{Component, Path, PathBuf};

/// Resolve a user-supplied relative path under `root`, guaranteeing the result
/// stays inside it (blocks `..` traversal and absolute escapes). Lexical only —
/// no symlink resolution — matching the old Node `resolveSafe`.
///
/// KNOWN LIMITATION (parity with Node): a symlink that already lives *inside*
/// `root` but points outside is NOT blocked, so writes/deletes can follow it out
/// of the sandbox. Acceptable for a local, single-user IDE on trusted projects;
/// harden later by canonicalizing the longest existing prefix if untrusted repos
/// become a concern.
pub fn resolve_safe(root: &Path, rel: &str) -> Result<PathBuf, ApiError> {
    let rel = rel.trim_start_matches(['/', '\\']);
    let mut out = root.to_path_buf();
    for comp in Path::new(rel).components() {
        match comp {
            Component::Normal(c) => out.push(c),
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() || !out.starts_with(root) {
                    return Err(ApiError::bad("Path escapes the project root"));
                }
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(ApiError::bad("Invalid path"));
            }
        }
    }
    if out != root && !out.starts_with(root) {
        return Err(ApiError::bad("Path escapes the project root"));
    }
    Ok(out)
}

/// Absolute path inside `root` back to a posix-style relative path.
pub fn to_rel(root: &Path, abs: &Path) -> String {
    abs.strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}

/// Last path segment, or "project" for the root.
pub fn basename(p: &Path) -> String {
    p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "project".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_paths_inside_root() {
        let root = Path::new("/proj");
        assert_eq!(resolve_safe(root, "src/a.ts").unwrap(), PathBuf::from("/proj/src/a.ts"));
        assert_eq!(resolve_safe(root, "/src/a.ts").unwrap(), PathBuf::from("/proj/src/a.ts"));
        assert_eq!(resolve_safe(root, "src/../b.ts").unwrap(), PathBuf::from("/proj/b.ts"));
    }

    #[test]
    fn blocks_escape() {
        let root = Path::new("/proj");
        assert!(resolve_safe(root, "../etc/passwd").is_err());
        assert!(resolve_safe(root, "src/../../escape").is_err());
    }

    #[test]
    fn to_rel_is_posix() {
        assert_eq!(to_rel(Path::new("/proj"), Path::new("/proj/a/b.ts")), "a/b.ts");
    }
}
