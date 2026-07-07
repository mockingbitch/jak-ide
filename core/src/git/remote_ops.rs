//! Remote management: add / remove / set-url. Listing lives in `ops::remotes`.
//! Names and URLs are validated to reject flag-like values (args are never
//! shell-interpreted, so this only guards against a leading-`-` being read as an
//! option); credentials are handled by the user's git credential helper — never
//! stored by JakIDE.

use std::path::Path;

use super::exec::{git, GitError};

fn arg(value: &str, what: &str) -> Result<String, GitError> {
    let v = value.trim();
    if v.is_empty() || v.starts_with('-') {
        return Err(GitError::new(format!("invalid remote {what}"), 1));
    }
    Ok(v.to_string())
}

pub async fn add(cwd: &Path, name: &str, url: &str) -> Result<String, GitError> {
    let name = arg(name, "name")?;
    let url = arg(url, "url")?;
    git(cwd, &["remote", "add", &name, &url]).await
}

pub async fn remove(cwd: &Path, name: &str) -> Result<String, GitError> {
    let name = arg(name, "name")?;
    git(cwd, &["remote", "remove", &name]).await
}

pub async fn set_url(cwd: &Path, name: &str, url: &str) -> Result<String, GitError> {
    let name = arg(name, "name")?;
    let url = arg(url, "url")?;
    git(cwd, &["remote", "set-url", &name, &url]).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arg_validation() {
        assert_eq!(arg("origin", "name").unwrap(), "origin");
        assert_eq!(arg("  git@host:repo.git ", "url").unwrap(), "git@host:repo.git");
        assert!(arg("", "name").is_err());
        assert!(arg("--upload-pack=evil", "name").is_err());
    }
}
