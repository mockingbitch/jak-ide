//! Enumerate the shells available on the local machine (ported from the Node
//! `listShells`): $SHELL first, then /etc/shells, then common candidates —
//! deduped by basename, sorted, with a sensible default.

use std::collections::HashMap;
use std::path::Path;

use serde::Serialize;

const CANDIDATES: &[&str] = &[
    "/bin/bash",
    "/usr/bin/bash",
    "/bin/zsh",
    "/usr/bin/zsh",
    "/usr/bin/fish",
    "/usr/local/bin/fish",
    "/usr/bin/dash",
    "/bin/dash",
    "/bin/sh",
    "/usr/bin/sh",
    "/usr/bin/pwsh",
    "/usr/local/bin/pwsh",
    "/usr/bin/nu",
    "/usr/bin/elvish",
];

#[derive(Serialize, Clone)]
pub struct ShellInfo {
    pub name: String,
    pub path: String,
}

pub struct Shells {
    pub shells: Vec<ShellInfo>,
    pub default: String,
}

fn base_name(p: &str) -> String {
    p.rsplit('/').next().filter(|s| !s.is_empty()).unwrap_or(p).to_string()
}

/// Enumerated shells + the default to use. Deduped by basename so e.g.
/// /bin/bash and /usr/bin/bash collapse to one "bash" (first wins).
pub fn list_shells() -> Shells {
    let mut by_name: HashMap<String, String> = HashMap::new();
    // preserve insertion order for the "first wins" dedupe + stable default
    let mut order: Vec<String> = Vec::new();
    let mut add = |p: &str| {
        if p.is_empty() {
            return;
        }
        let name = base_name(p);
        if by_name.contains_key(&name) {
            return;
        }
        if Path::new(p).exists() {
            by_name.insert(name.clone(), p.to_string());
            order.push(name);
        }
    };

    let env_shell = std::env::var("SHELL").unwrap_or_default();
    add(&env_shell); // the user's login shell takes the name slot first

    if let Ok(txt) = std::fs::read_to_string("/etc/shells") {
        for line in txt.lines() {
            let p = line.trim();
            if !p.is_empty() && !p.starts_with('#') {
                add(p);
            }
        }
    }
    for p in CANDIDATES {
        add(p);
    }

    let mut shells: Vec<ShellInfo> =
        order.iter().filter_map(|n| by_name.get(n).map(|p| ShellInfo { name: n.clone(), path: p.clone() })).collect();
    shells.sort_by(|a, b| a.name.cmp(&b.name));

    let default = if !env_shell.is_empty() && shells.iter().any(|s| s.path == env_shell) {
        env_shell
    } else {
        shells
            .iter()
            .find(|s| s.name == "bash")
            .map(|s| s.path.clone())
            .or_else(|| shells.first().map(|s| s.path.clone()))
            .unwrap_or_else(|| "/bin/sh".to_string())
    };

    Shells { shells, default }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basename_is_last_segment() {
        assert_eq!(base_name("/usr/bin/bash"), "bash");
        assert_eq!(base_name("/bin/sh"), "sh");
        assert_eq!(base_name("zsh"), "zsh");
    }

    #[test]
    fn enumerates_at_least_one_real_shell() {
        // On any Unix dev box /bin/sh exists, so the list is never empty and the
        // default resolves to a real, existing path.
        let s = list_shells();
        assert!(!s.shells.is_empty());
        assert!(Path::new(&s.default).exists());
    }
}
