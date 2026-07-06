//! PHP name resolution: turn a reference + its file context into definition
//! candidates, ranked by confidence.
//!
//! Resolution order mirrors PHP's own rules, then degrades gracefully for
//! navigation (an IDE should still offer a best guess where the runtime would
//! fatal): exact import/alias > same namespace > global > PSR-4 file fallback
//! (covers un-indexed vendor/) > name-only index search.

use super::symbol_index::{IndexedDecl, SymbolIndex};
use super::types::{Candidate, FileContext, RefKind, Reference, SymbolKind, UseKind};

/// Confidence tiers (multiplied into candidate ranking).
const EXACT: f32 = 1.0;
const SAME_NS: f32 = 0.95;
const QUALIFIED_IN_NS: f32 = 0.9;
const GLOBAL_FALLBACK_FN: f32 = 0.9; // real PHP semantics for functions
const GLOBAL_LENIENT: f32 = 0.55; // classes do NOT fall back in PHP; lenient for nav
const PSR4_VERIFIED: f32 = 0.9;
const PSR4_FILE_ONLY: f32 = 0.6;
const NAME_ONLY: f32 = 0.4;

/// Resolve `reference` to ranked definition candidates.
///
/// `local` is the LIVE declarations of the file being edited (from the unsaved
/// buffer). They take precedence over the on-disk index for their own file, so
/// (a) a class the user just typed but hasn't saved still resolves, and (b)
/// same-file jumps land on the live line number, not a stale indexed one.
pub fn resolve(
    reference: &Reference,
    ctx: &FileContext,
    index: &SymbolIndex,
    local: &[IndexedDecl],
) -> Vec<Candidate> {
    // Files whose live buffer supersedes the disk index (just the source file).
    let live_paths: std::collections::HashSet<&std::path::Path> =
        local.iter().map(|d| d.path.as_path()).collect();
    let mut out: Vec<Candidate> = Vec::new();
    for (fqn, base) in candidate_fqns(reference, ctx) {
        let key = fqn.to_lowercase();
        // 0) Live buffer of the current file wins over its stale disk entry.
        let mut found = false;
        for d in local.iter().filter(|d| d.fqn.to_lowercase() == key && kind_matches(reference.kind, d.kind)) {
            found = true;
            push(&mut out, d, base);
        }
        // 1) Project index (and anything cached from earlier vendor lookups),
        //    skipping files whose live buffer already answered above.
        for d in index.lookup_fqn(&fqn) {
            if live_paths.contains(d.path.as_path()) {
                continue;
            }
            if kind_matches(reference.kind, d.kind) {
                found = true;
                push(&mut out, &d, base);
            }
        }
        if found {
            continue;
        }
        // 2) Composer PSR-4: compute the file the autoloader would load, parse
        //    it on demand (works for vendor/ without indexing it).
        for file in index.composer_candidates(&fqn) {
            let decls = index.parse_and_cache(&file);
            let verified: Vec<&IndexedDecl> = decls
                .iter()
                .filter(|d| d.fqn.eq_ignore_ascii_case(&fqn) && kind_matches(reference.kind, d.kind))
                .collect();
            if verified.is_empty() {
                // The file exists where PSR-4 says, but we couldn't confirm the
                // declaration — still useful as a low-confidence jump target.
                out.push(Candidate {
                    path: file,
                    line: 1,
                    col: 1,
                    name: short_name(&fqn).to_string(),
                    kind: guess_kind(reference.kind),
                    confidence: base * PSR4_FILE_ONLY,
                });
            } else {
                for d in verified {
                    push(&mut out, d, base * PSR4_VERIFIED / EXACT);
                }
            }
        }
    }

    // 3) Last resort for class-likes: same short name anywhere in the project.
    if out.is_empty() && reference.kind == RefKind::ClassLike {
        for d in index.lookup_name(short_name(&reference.text), 10) {
            if kind_matches(reference.kind, d.kind) {
                push(&mut out, &d, NAME_ONLY);
            }
        }
    }

    dedupe_rank(out)
}

/// Candidate FQNs (no leading backslash) with base confidence, best first.
fn candidate_fqns(reference: &Reference, ctx: &FileContext) -> Vec<(String, f32)> {
    let text = reference.text.as_str();
    if reference.fully_qualified {
        return vec![(text.to_string(), EXACT)];
    }
    let mut out: Vec<(String, f32)> = Vec::new();
    let (first, rest) = match text.split_once('\\') {
        Some((f, r)) => (f, Some(r)),
        None => (text, None),
    };

    // `use` imports: alias match on the first segment (case-insensitive, like PHP).
    let wanted_kind = match reference.kind {
        RefKind::Function if rest.is_none() => UseKind::Function,
        _ => UseKind::Type,
    };
    for u in &ctx.uses {
        if u.kind == wanted_kind && u.alias.eq_ignore_ascii_case(first) {
            let fqn = match rest {
                Some(r) => format!("{}\\{}", u.fqn, r),
                None => u.fqn.clone(),
            };
            out.push((fqn, EXACT));
        }
    }

    let in_ns = !ctx.namespace.is_empty();
    match rest {
        // Qualified relative name (`Models\User`): resolved against the current
        // namespace; global interpretation as a lenient extra.
        Some(_) => {
            if in_ns {
                out.push((format!("{}\\{}", ctx.namespace, text), QUALIFIED_IN_NS));
                out.push((text.to_string(), GLOBAL_LENIENT));
            } else {
                out.push((text.to_string(), SAME_NS));
            }
        }
        // Unqualified name: current namespace first; functions legitimately
        // fall back to global, classes only leniently.
        None => {
            if in_ns {
                out.push((format!("{}\\{}", ctx.namespace, text), SAME_NS));
                let global_conf = match reference.kind {
                    RefKind::Function => GLOBAL_FALLBACK_FN,
                    RefKind::ClassLike => GLOBAL_LENIENT,
                };
                out.push((text.to_string(), global_conf));
            } else {
                out.push((text.to_string(), EXACT));
            }
        }
    }
    out
}

fn kind_matches(r: RefKind, k: SymbolKind) -> bool {
    match r {
        RefKind::ClassLike => k.is_class_like(),
        RefKind::Function => k == SymbolKind::Function,
    }
}

fn guess_kind(r: RefKind) -> SymbolKind {
    match r {
        RefKind::ClassLike => SymbolKind::Class,
        RefKind::Function => SymbolKind::Function,
    }
}

fn short_name(fqn: &str) -> &str {
    fqn.rsplit('\\').next().unwrap_or(fqn)
}

fn push(out: &mut Vec<Candidate>, d: &IndexedDecl, confidence: f32) {
    out.push(Candidate {
        path: d.path.clone(),
        line: d.line,
        col: d.col,
        name: d.name.clone(),
        kind: d.kind,
        confidence,
    });
}

/// Highest confidence first; one entry per (path, line).
fn dedupe_rank(mut list: Vec<Candidate>) -> Vec<Candidate> {
    list.sort_by(|a, b| {
        b.confidence
            .partial_cmp(&a.confidence)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.path.cmp(&b.path))
    });
    let mut seen = std::collections::HashSet::new();
    list.retain(|c| seen.insert((c.path.clone(), c.line)));
    list.truncate(20);
    list
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::code_intelligence::types::UseImport;
    use std::path::{Path, PathBuf};

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("jak-res-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn write(root: &Path, rel: &str, content: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, content).unwrap();
    }

    /// Each test gets its own scratch dir (tests run concurrently in-process).
    fn fixture_index(tag: &str) -> (PathBuf, SymbolIndex) {
        let root = scratch(tag);
        write(&root, "app/Models/User.php", "<?php namespace App\\Models; class User {}");
        write(&root, "app/Models/Post.php", "<?php namespace App\\Models; class Post {}");
        write(&root, "app/Http/Controllers/Controller.php", "<?php namespace App\\Http\\Controllers; class Controller {}");
        write(&root, "app/helpers.php", "<?php namespace App\\Support; function helper_fn() {}");
        write(&root, "global.php", "<?php class GlobalThing {} function global_fn() {}");
        let idx = SymbolIndex::new();
        idx.rebuild(&root);
        (root, idx)
    }

    fn class_ref(text: &str, fq: bool) -> Reference {
        Reference { text: text.into(), fully_qualified: fq, kind: RefKind::ClassLike }
    }

    fn ctx(ns: &str, uses: Vec<UseImport>) -> FileContext {
        FileContext { namespace: ns.into(), uses }
    }

    fn use_type(alias: &str, fqn: &str) -> UseImport {
        UseImport { alias: alias.into(), fqn: fqn.into(), kind: UseKind::Type }
    }

    #[test]
    fn resolves_via_use_import_and_alias() {
        let (root, idx) = fixture_index("alias");
        let c = ctx("App\\Http\\Controllers", vec![use_type("User", "App\\Models\\User")]);
        let hits = resolve(&class_ref("User", false), &c, &idx, &[]);
        assert_eq!(hits[0].path, root.join("app/Models/User.php"));
        assert_eq!(hits[0].confidence, 1.0);

        // Alias: `use App\Models\Post as Article;` then `new Article()`.
        let c = ctx("App\\Http\\Controllers", vec![use_type("Article", "App\\Models\\Post")]);
        let hits = resolve(&class_ref("Article", false), &c, &idx, &[]);
        assert_eq!(hits[0].name, "Post");
        // Alias matching is case-insensitive like PHP.
        let hits = resolve(&class_ref("ARTICLE", false), &c, &idx, &[]);
        assert_eq!(hits[0].name, "Post");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn resolves_same_namespace_without_import() {
        let (root, idx) = fixture_index("samens");
        let c = ctx("App\\Http\\Controllers", vec![]);
        let hits = resolve(&class_ref("Controller", false), &c, &idx, &[]);
        assert_eq!(hits[0].path, root.join("app/Http/Controllers/Controller.php"));
        assert!(hits[0].confidence >= 0.9);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn resolves_fully_qualified_and_global() {
        let (root, idx) = fixture_index("fqglobal");
        let c = ctx("App\\Http\\Controllers", vec![]);
        let hits = resolve(&class_ref("App\\Models\\User", true), &c, &idx, &[]);
        assert_eq!(hits[0].path, root.join("app/Models/User.php"));
        assert_eq!(hits[0].confidence, 1.0);

        // Global class referenced unqualified from inside a namespace: lenient hit.
        let hits = resolve(&class_ref("GlobalThing", false), &c, &idx, &[]);
        assert_eq!(hits[0].path, root.join("global.php"));
        assert!(hits[0].confidence < 0.9);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn qualified_relative_name_resolves_in_namespace() {
        let (root, idx) = fixture_index("qualrel");
        // Inside `App`: `Models\User` → `App\Models\User`.
        let c = ctx("App", vec![]);
        let hits = resolve(&class_ref("Models\\User", false), &c, &idx, &[]);
        assert_eq!(hits[0].path, root.join("app/Models/User.php"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn functions_fall_back_to_global() {
        let (root, idx) = fixture_index("fnfall");
        let c = ctx("App\\Http\\Controllers", vec![]);
        let r = Reference { text: "global_fn".into(), fully_qualified: false, kind: RefKind::Function };
        let hits = resolve(&r, &c, &idx, &[]);
        assert_eq!(hits[0].name, "global_fn");
        assert_eq!(hits[0].confidence, GLOBAL_FALLBACK_FN);

        // `use function` import.
        let c = ctx(
            "App\\Http\\Controllers",
            vec![UseImport { alias: "helper_fn".into(), fqn: "App\\Support\\helper_fn".into(), kind: UseKind::Function }],
        );
        let r = Reference { text: "helper_fn".into(), fully_qualified: false, kind: RefKind::Function };
        let hits = resolve(&r, &c, &idx, &[]);
        assert_eq!(hits[0].confidence, 1.0);
        assert_eq!(hits[0].path, root.join("app/helpers.php"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn psr4_fallback_reaches_unindexed_vendor() {
        let (root, idx) = fixture_index("psr4");
        write(
            &root,
            "vendor/composer/autoload_psr4.php",
            "<?php\n$vendorDir = dirname(__DIR__);\n$baseDir = dirname($vendorDir);\nreturn array(\n    'Illuminate\\\\' => array($vendorDir . '/laravel/src/Illuminate'),\n);\n",
        );
        write(&root, "vendor/laravel/src/Illuminate/Support/Collection.php", "<?php namespace Illuminate\\Support; class Collection {}");
        idx.rebuild(&root); // reload composer maps

        let c = ctx("App\\Http\\Controllers", vec![use_type("Collection", "Illuminate\\Support\\Collection")]);
        let hits = resolve(&class_ref("Collection", false), &c, &idx, &[]);
        assert_eq!(hits[0].path, root.join("vendor/laravel/src/Illuminate/Support/Collection.php"));
        assert_eq!(hits[0].name, "Collection");
        assert!(hits[0].confidence >= 0.85); // verified declaration
        assert_eq!(hits[0].line, 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn name_only_last_resort_and_unresolved() {
        let (root, idx) = fixture_index("nameonly");
        // No import, wrong namespace → falls back to short-name search.
        let c = ctx("Elsewhere", vec![]);
        let hits = resolve(&class_ref("User", false), &c, &idx, &[]);
        assert_eq!(hits[0].name, "User");
        assert_eq!(hits[0].confidence, NAME_ONLY);
        // Truly unknown name → empty.
        let hits = resolve(&class_ref("DoesNotExist", false), &c, &idx, &[]);
        assert!(hits.is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn kind_filter_separates_classes_and_functions() {
        let (root, idx) = fixture_index("kindsep");
        // `helper_fn` exists only as a function; a CLASS reference must not hit it.
        let c = ctx("App\\Support", vec![]);
        let hits = resolve(&class_ref("helper_fn", false), &c, &idx, &[]);
        assert!(hits.is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }
}
