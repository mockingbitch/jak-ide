//! Navigation orchestration: live buffer + position → ranked definition
//! locations, in the wire shape the frontend consumes. Pure functions —
//! the HTTP handlers in mod.rs are thin async wrappers around these.

use std::path::Path;

use serde::Serialize;

use super::parser::{byte_offset, context_at, extract_declarations};
use super::refs::reference_at;
use super::resolver::resolve;
use super::symbol_index::{IndexedDecl, SymbolIndex};
use super::types::{Reference, SymbolKind};

/// One definition target. `path` is project-relative (posix) when
/// `external == false`, absolute when `external == true`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiLocation {
    pub path: String,
    pub external: bool,
    pub line: u32,
    pub column: u32,
    pub name: String,
    pub kind: SymbolKind,
    pub preview: String,
    pub confidence: f32,
}

/// Resolve the definition(s) for the reference at an editor position.
/// `content` is the LIVE buffer of `rel_path` (unsaved edits resolve correctly).
pub fn definition(
    root: &Path,
    index: &SymbolIndex,
    rel_path: &str,
    content: &str,
    line: u32,
    column: u32,
) -> Vec<ApiLocation> {
    let Some(reference) = reference_at(content, line, column) else { return Vec::new() };
    let byte = byte_offset(content, line, column).unwrap_or(0);
    let ctx = context_at(content, byte);
    let source_abs = root.join(rel_path);

    // Live declarations of the file being edited take precedence over the disk
    // index for this file (unsaved classes resolve; same-file jumps use live lines).
    let local: Vec<IndexedDecl> = extract_declarations(content)
        .into_iter()
        .map(|d| IndexedDecl {
            path: source_abs.clone(),
            name: d.name,
            fqn: d.fqn,
            kind: d.kind,
            line: d.line,
            col: d.col,
        })
        .collect();

    resolve(&reference, &ctx, index, &local)
        .into_iter()
        .map(|c| {
            // A target under `root` is "internal" only if it produces a clean
            // relative path. Composer PSR-4 dirs mapped outside root (e.g.
            // "App\\": "../shared/") join to a `..`-prefixed path that the path
            // jail would reject — surface those as external (absolute) instead.
            let rel = crate::paths::to_rel(root, &c.path);
            let external = !c.path.starts_with(root) || rel.is_empty() || rel.starts_with("..");
            let path = if external { c.path.to_string_lossy().to_string() } else { rel };
            let preview = if c.path == source_abs {
                line_preview_from(content, c.line)
            } else {
                std::fs::read_to_string(&c.path).map(|s| line_preview_from(&s, c.line)).unwrap_or_default()
            };
            ApiLocation {
                path,
                external,
                line: c.line,
                column: c.col,
                name: c.name,
                kind: c.kind,
                preview,
                confidence: c.confidence,
            }
        })
        .collect()
}

/// The reference under the cursor (for UI affordances / tests).
pub fn symbol_at(content: &str, line: u32, column: u32) -> Option<Reference> {
    reference_at(content, line, column)
}

/// Trimmed text of a 1-based line, capped for the wire.
fn line_preview_from(content: &str, line: u32) -> String {
    content
        .lines()
        .nth(line.saturating_sub(1) as usize)
        .map(|l| l.trim().chars().take(200).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("jak-nav-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn write(root: &Path, rel: &str, content: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, content).unwrap();
    }

    /// 1-based (line, col) of `needle` in `content` (+ char offset).
    fn pos(content: &str, needle: &str, offset: u32) -> (u32, u32) {
        let byte = content.find(needle).expect("needle");
        let line = content[..byte].matches('\n').count() as u32 + 1;
        let ls = content[..byte].rfind('\n').map(|i| i + 1).unwrap_or(0);
        (line, content[ls..byte].encode_utf16().count() as u32 + 1 + offset)
    }

    const CONTROLLER: &str = r#"<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Models\Post as Article;
use Illuminate\Support\Collection;

class UserController extends Controller
{
    public function show(int $id): \App\Models\User
    {
        $user = new User();
        $post = Article::find($id);
        $sib = new SiblingService();
        $coll = new Collection();
        $bad = new TotallyUnknown();
        return $user;
    }
}
"#;

    /// Full fake Laravel-style project; returns (root, index).
    fn laravel_fixture(tag: &str) -> (PathBuf, SymbolIndex) {
        let root = scratch(tag);
        write(
            &root,
            "composer.json",
            r#"{ "autoload": { "psr-4": { "App\\": "app/" } }, "autoload-dev": { "psr-4": { "Tests\\": "tests/" } } }"#,
        );
        write(&root, "app/Models/User.php", "<?php\n\nnamespace App\\Models;\n\nclass User\n{\n}\n");
        write(&root, "app/Models/Post.php", "<?php\n\nnamespace App\\Models;\n\nclass Post\n{\n}\n");
        write(&root, "app/Http/Controllers/Controller.php", "<?php\n\nnamespace App\\Http\\Controllers;\n\nabstract class Controller\n{\n}\n");
        write(&root, "app/Http/Controllers/SiblingService.php", "<?php\n\nnamespace App\\Http\\Controllers;\n\nclass SiblingService\n{\n}\n");
        write(&root, "app/Http/Controllers/UserController.php", CONTROLLER);
        // Vendor package, reachable ONLY via composer PSR-4 (not indexed).
        write(
            &root,
            "vendor/composer/autoload_psr4.php",
            "<?php\n$vendorDir = dirname(__DIR__);\n$baseDir = dirname($vendorDir);\nreturn array(\n    'Illuminate\\\\' => array($vendorDir . '/laravel/framework/src/Illuminate'),\n    'App\\\\' => array($baseDir . '/app'),\n);\n",
        );
        write(
            &root,
            "vendor/laravel/framework/src/Illuminate/Support/Collection.php",
            "<?php\n\nnamespace Illuminate\\Support;\n\nclass Collection\n{\n}\n",
        );
        let idx = SymbolIndex::new();
        idx.rebuild(&root);
        (root, idx)
    }

    fn def_at(root: &Path, idx: &SymbolIndex, needle: &str, offset: u32) -> Vec<ApiLocation> {
        let (line, col) = pos(CONTROLLER, needle, offset);
        definition(root, idx, "app/Http/Controllers/UserController.php", CONTROLLER, line, col)
    }

    #[test]
    fn jump_to_imported_class() {
        let (root, idx) = laravel_fixture("imported");
        let hits = def_at(&root, &idx, "new User()", 4);
        assert_eq!(hits[0].path, "app/Models/User.php");
        assert!(!hits[0].external);
        assert_eq!(hits[0].line, 5);
        assert_eq!(hits[0].column, 7);
        assert_eq!(hits[0].name, "User");
        assert_eq!(hits[0].preview, "class User");
        assert_eq!(hits[0].confidence, 1.0);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn jump_via_alias_and_fq_name() {
        let (root, idx) = laravel_fixture("aliasfq");
        // `Article::find` → App\Models\Post via alias import.
        let hits = def_at(&root, &idx, "Article::find", 0);
        assert_eq!(hits[0].path, "app/Models/Post.php");
        assert_eq!(hits[0].name, "Post");
        // Return type `\App\Models\User` — click mid-segment.
        let hits = def_at(&root, &idx, "\\App\\Models\\User\n", 6);
        assert_eq!(hits[0].path, "app/Models/User.php");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn jump_extends_and_same_namespace() {
        let (root, idx) = laravel_fixture("extends");
        let hits = def_at(&root, &idx, "extends Controller", 8);
        assert_eq!(hits[0].path, "app/Http/Controllers/Controller.php");
        let hits = def_at(&root, &idx, "SiblingService()", 0);
        assert_eq!(hits[0].path, "app/Http/Controllers/SiblingService.php");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn jump_into_vendor_via_psr4_without_indexing() {
        let (root, idx) = laravel_fixture("vendor");
        let hits = def_at(&root, &idx, "new Collection()", 4);
        assert!(!hits.is_empty(), "vendor class should resolve via composer map");
        assert_eq!(hits[0].path, "vendor/laravel/framework/src/Illuminate/Support/Collection.php");
        assert!(!hits[0].external, "vendor is inside the project root");
        assert_eq!(hits[0].line, 5);
        assert_eq!(hits[0].preview, "class Collection");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn jump_from_use_statement_itself() {
        let (root, idx) = laravel_fixture("usestmt");
        let hits = def_at(&root, &idx, "App\\Models\\User;", 0);
        assert_eq!(hits[0].path, "app/Models/User.php");
        assert_eq!(hits[0].confidence, 1.0);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn unresolved_and_non_reference_positions() {
        let (root, idx) = laravel_fixture("unres");
        assert!(def_at(&root, &idx, "TotallyUnknown", 0).is_empty());
        // A variable is not a Phase-1 reference.
        assert!(def_at(&root, &idx, "$user = new", 0).is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn live_buffer_beats_disk() {
        let (root, idx) = laravel_fixture("live");
        // The user just typed a new import + usage that is NOT saved to disk.
        let live = "<?php\nnamespace App\\Http\\Controllers;\nuse App\\Models\\Post;\nnew Post();\n";
        let (line, col) = {
            let byte = live.find("Post()").unwrap();
            let line = live[..byte].matches('\n').count() as u32 + 1;
            let ls = live[..byte].rfind('\n').map(|i| i + 1).unwrap_or(0);
            (line, (byte - ls) as u32 + 1)
        };
        let hits = definition(&root, &idx, "app/Http/Controllers/UserController.php", live, line, col);
        assert_eq!(hits[0].path, "app/Models/Post.php");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn unsaved_same_file_class_resolves_via_live_buffer() {
        let (root, idx) = laravel_fixture("livedecl");
        // A class declared in the live buffer but NOT on disk / in the index.
        let live = "<?php\nnamespace App\\Http\\Controllers;\n\nclass Helper {}\n\nclass Page\n{\n    public function h(): Helper { return new Helper(); }\n}\n";
        let byte = live.find("new Helper()").unwrap() + 4;
        let l = live[..byte].matches('\n').count() as u32 + 1;
        let ls = live[..byte].rfind('\n').map(|i| i + 1).unwrap_or(0);
        let hits = definition(&root, &idx, "app/Http/Controllers/Page.php", live, l, (byte - ls) as u32 + 1);
        assert_eq!(hits[0].path, "app/Http/Controllers/Page.php");
        assert_eq!(hits[0].line, 4); // live line of `class Helper`
        assert_eq!(hits[0].name, "Helper");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn click_at_end_of_identifier_resolves() {
        let (root, idx) = laravel_fixture("endtok");
        // Column just PAST the last char of "User" in `new User()`.
        let (line, col) = pos(CONTROLLER, "new User", 0);
        let end_col = col + 4 + "User".len() as u32; // start of "User" + len
        let hits = definition(&root, &idx, "app/Http/Controllers/UserController.php", CONTROLLER, line, end_col);
        assert_eq!(hits[0].path, "app/Models/User.php");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn symbol_at_reports_reference() {
        let s = symbol_at(CONTROLLER, pos(CONTROLLER, "new User()", 4).0, pos(CONTROLLER, "new User()", 4).1).unwrap();
        assert_eq!(s.text, "User");
    }
}
