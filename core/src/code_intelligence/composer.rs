//! Composer PSR-4 support: map fully-qualified class names to candidate files.
//!
//! Two sources, merged:
//!  - the project's `composer.json` (`autoload.psr-4` + `autoload-dev.psr-4`) —
//!    source of truth for the app's own namespaces (Laravel: `App\` → `app/`);
//!  - `vendor/composer/autoload_psr4.php` — Composer's generated map covering
//!    every installed dependency, so definitions inside `vendor/` resolve by
//!    pure path computation WITHOUT ever indexing vendor (the PhpStorm trick).

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use regex::Regex;

/// PSR-4 prefix → base directories, longest prefix first.
#[derive(Debug, Default, Clone)]
pub struct ComposerMaps {
    entries: Vec<(String, Vec<PathBuf>)>,
}

impl ComposerMaps {
    /// Load and merge both sources for `root`. Missing files are fine (not a
    /// composer project → empty map; the resolver then relies on the index only).
    pub fn load(root: &Path) -> Self {
        let mut entries: Vec<(String, Vec<PathBuf>)> = Vec::new();
        let mut add = |prefix: String, dir: PathBuf| {
            let prefix = prefix.trim_start_matches('\\').trim_end_matches('\\').to_string();
            if prefix.is_empty() {
                return;
            }
            match entries.iter_mut().find(|(p, _)| *p == prefix) {
                Some((_, dirs)) => {
                    if !dirs.contains(&dir) {
                        dirs.push(dir);
                    }
                }
                None => entries.push((prefix, vec![dir])),
            }
        };

        if let Ok(raw) = std::fs::read_to_string(root.join("composer.json")) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) {
                for section in ["autoload", "autoload-dev"] {
                    let Some(map) = json.get(section).and_then(|s| s.get("psr-4")).and_then(|m| m.as_object())
                    else {
                        continue;
                    };
                    for (prefix, dirs) in map {
                        let dirs: Vec<&str> = match dirs {
                            serde_json::Value::String(s) => vec![s.as_str()],
                            serde_json::Value::Array(a) => a.iter().filter_map(|v| v.as_str()).collect(),
                            _ => Vec::new(),
                        };
                        for d in dirs {
                            add(prefix.clone(), root.join(d));
                        }
                    }
                }
            }
        }

        for (prefix, dir) in parse_autoload_psr4(root) {
            add(prefix, dir);
        }

        // Longest prefix first so `App\Models\` beats `App\`.
        entries.sort_by(|a, b| b.0.len().cmp(&a.0.len()).then_with(|| a.0.cmp(&b.0)));
        Self { entries }
    }

    #[allow(dead_code)] // used by tests; handy for a UI "composer detected" badge later
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Existing candidate files for `fqn` (`App\Models\User` →
    /// `<base>/Models/User.php` for every matching prefix/dir).
    pub fn candidate_files(&self, fqn: &str) -> Vec<PathBuf> {
        let mut out = Vec::new();
        for (prefix, dirs) in &self.entries {
            let rest = match fqn.strip_prefix(prefix.as_str()).and_then(|r| r.strip_prefix('\\')) {
                Some(r) if !r.is_empty() => r,
                _ => continue,
            };
            let rel = format!("{}.php", rest.replace('\\', "/"));
            for dir in dirs {
                let p = dir.join(&rel);
                if p.is_file() && !out.contains(&p) {
                    out.push(p);
                }
            }
        }
        out
    }
}

/// Parse Composer's generated `vendor/composer/autoload_psr4.php`. The file is
/// machine-generated with a stable shape, e.g.:
/// `'Illuminate\\' => array($vendorDir . '/laravel/framework/src/Illuminate'),`
fn parse_autoload_psr4(root: &Path) -> Vec<(String, PathBuf)> {
    static ENTRY: OnceLock<Regex> = OnceLock::new();
    static DIR: OnceLock<Regex> = OnceLock::new();
    let entry_re = ENTRY.get_or_init(|| {
        Regex::new(r"'((?:[^'\\]|\\.)+)'\s*=>\s*array\((.*)\)").expect("psr4 entry regex")
    });
    let dir_re = DIR.get_or_init(|| {
        Regex::new(r"\$(vendorDir|baseDir)\s*\.\s*'([^']*)'").expect("psr4 dir regex")
    });

    let Ok(raw) = std::fs::read_to_string(root.join("vendor/composer/autoload_psr4.php")) else {
        return Vec::new();
    };
    let vendor_dir = root.join("vendor");
    let mut out = Vec::new();
    for cap in entry_re.captures_iter(&raw) {
        let prefix = cap[1].replace("\\\\", "\\");
        for d in dir_re.captures_iter(&cap[2]) {
            let base = if &d[1] == "vendorDir" { &vendor_dir } else { root };
            let sub = d[2].trim_start_matches('/');
            out.push((prefix.clone(), base.join(sub)));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("jak-intel-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn composer_json_psr4_string_and_array_dirs() {
        let root = scratch("cjson");
        std::fs::write(
            root.join("composer.json"),
            r#"{
              "autoload": { "psr-4": { "App\\": "app/", "Modules\\": ["modules/a", "modules/b"] } },
              "autoload-dev": { "psr-4": { "Tests\\": "tests/" } }
            }"#,
        )
        .unwrap();
        std::fs::create_dir_all(root.join("app/Models")).unwrap();
        std::fs::create_dir_all(root.join("modules/b/Billing")).unwrap();
        std::fs::create_dir_all(root.join("tests")).unwrap();
        std::fs::write(root.join("app/Models/User.php"), "<?php").unwrap();
        std::fs::write(root.join("modules/b/Billing/Invoice.php"), "<?php").unwrap();
        std::fs::write(root.join("tests/TestCase.php"), "<?php").unwrap();

        let maps = ComposerMaps::load(&root);
        assert_eq!(maps.candidate_files("App\\Models\\User"), vec![root.join("app/Models/User.php")]);
        assert_eq!(
            maps.candidate_files("Modules\\Billing\\Invoice"),
            vec![root.join("modules/b/Billing/Invoice.php")]
        );
        assert_eq!(maps.candidate_files("Tests\\TestCase"), vec![root.join("tests/TestCase.php")]);
        assert!(maps.candidate_files("App\\Missing").is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn vendor_autoload_psr4_parsing() {
        let root = scratch("vendor");
        std::fs::create_dir_all(root.join("vendor/composer")).unwrap();
        std::fs::create_dir_all(root.join("vendor/laravel/framework/src/Illuminate/Support")).unwrap();
        std::fs::create_dir_all(root.join("app")).unwrap();
        std::fs::write(
            root.join("vendor/composer/autoload_psr4.php"),
            r#"<?php
// autoload_psr4.php @generated by Composer
$vendorDir = dirname(__DIR__);
$baseDir = dirname($vendorDir);
return array(
    'Illuminate\\' => array($vendorDir . '/laravel/framework/src/Illuminate'),
    'App\\' => array($baseDir . '/app'),
);
"#,
        )
        .unwrap();
        std::fs::write(
            root.join("vendor/laravel/framework/src/Illuminate/Support/Collection.php"),
            "<?php namespace Illuminate\\Support; class Collection {}",
        )
        .unwrap();

        let maps = ComposerMaps::load(&root);
        assert_eq!(
            maps.candidate_files("Illuminate\\Support\\Collection"),
            vec![root.join("vendor/laravel/framework/src/Illuminate/Support/Collection.php")]
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn longest_prefix_wins_ordering() {
        let root = scratch("prefix");
        std::fs::write(
            root.join("composer.json"),
            r#"{ "autoload": { "psr-4": { "App\\": "app/", "App\\Models\\": "src/models/" } } }"#,
        )
        .unwrap();
        std::fs::create_dir_all(root.join("src/models")).unwrap();
        std::fs::create_dir_all(root.join("app/Models")).unwrap();
        std::fs::write(root.join("src/models/User.php"), "<?php").unwrap();
        std::fs::write(root.join("app/Models/User.php"), "<?php").unwrap();

        let maps = ComposerMaps::load(&root);
        let files = maps.candidate_files("App\\Models\\User");
        // Both exist, but the longer prefix's file comes first.
        assert_eq!(files[0], root.join("src/models/User.php"));
        assert_eq!(files.len(), 2);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_composer_files_yield_empty_map() {
        let root = scratch("none");
        let maps = ComposerMaps::load(&root);
        assert!(maps.is_empty());
        assert!(maps.candidate_files("App\\X").is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }
}
