//! Reference (usage) extraction: what class/function does the token under the
//! cursor refer to? Walks up from the smallest node at the click position and
//! classifies by the syntactic context — the same contexts PhpStorm handles:
//! `new X`, `extends` / `implements`, type hints, `X::...`, `instanceof`,
//! attributes `#[X]`, trait `use X;`, `catch (X)`, and import statements.

use tree_sitter::Node;

use super::parser::{byte_offset, parse, text};
use super::types::{RefKind, Reference};

/// The reference under the editor position, or `None` when the token is not a
/// resolvable class/function usage (Phase 1: variables/methods come later).
pub fn reference_at(content: &str, line: u32, col_utf16: u32) -> Option<Reference> {
    let byte = byte_offset(content, line, col_utf16)?;
    let tree = parse(content)?;
    let root = tree.root_node();
    let mut node = root.named_descendant_for_byte_range(byte, byte)?;

    // A click at the exclusive end of an identifier (cursor just past the last
    // char) lands on the following token; retry one byte back so end-of-word
    // clicks still resolve.
    if !matches!(node.kind(), "name" | "qualified_name") && byte > 0 {
        if let Some(prev) = root.named_descendant_for_byte_range(byte - 1, byte - 1) {
            node = prev;
        }
    }

    // Only identifier-ish leaves are candidates.
    if !matches!(node.kind(), "name" | "qualified_name") {
        return None;
    }

    // Prefer the whole qualified name: clicking any segment of `App\Models\User`
    // resolves the full path. `name` may sit under `namespace_name` under
    // `qualified_name`, or directly under `qualified_name` (last segment).
    let mut target = node;
    while let Some(p) = target.parent() {
        if matches!(p.kind(), "namespace_name" | "qualified_name") {
            target = p;
        } else {
            break;
        }
    }

    let parent = target.parent()?;
    let raw = text(target, content)?;
    let fully_qualified = raw.starts_with('\\');
    let clean = raw.trim_start_matches('\\').to_string();
    let class_ref = |fq: bool, text: String| Some(Reference { text, fully_qualified: fq, kind: RefKind::ClassLike });

    match parent.kind() {
        // `new User(...)`, `extends Base`, `implements Contract`, type hints,
        // `#[Route]`, trait `use HasFactory;`, `catch (HttpException $e)`.
        "object_creation_expression" | "base_clause" | "class_interface_clause" | "named_type"
        | "attribute" | "use_declaration" | "type_list" => class_ref(fully_qualified, clean),

        // `User::find()`, `User::CONST`, `User::$prop`, `User::class` — only the
        // scope (left) side is a class reference; the member is Phase 2.
        "scoped_call_expression" | "class_constant_access_expression" | "scoped_property_access_expression" => {
            let is_scope = parent
                .child_by_field_name("scope")
                .map(|s| s.id() == target.id())
                // Grammar versions without a `scope` field: first named child.
                .unwrap_or_else(|| parent.named_child(0).map(|c| c.id()) == Some(target.id()));
            if is_scope {
                class_ref(fully_qualified, clean)
            } else {
                None
            }
        }

        // `$x instanceof User` — the right operand of the instanceof operator.
        "binary_expression" => {
            let is_instanceof = parent.children(&mut parent.walk()).any(|c| c.kind() == "instanceof");
            if is_instanceof {
                class_ref(fully_qualified, clean)
            } else {
                None
            }
        }

        // Clicking inside a `use` import: resolve the import path itself (it is
        // absolute by definition). Group form prepends the declaration prefix
        // (the clause's parent is then namespace_use_group, one level deeper).
        "namespace_use_clause" => {
            let mut decl = parent.parent()?;
            if decl.kind() == "namespace_use_group" {
                decl = decl.parent()?;
            }
            let (prefix, kind) = use_decl_info(decl, parent, content);
            let full = match prefix {
                Some(p) => format!("{p}\\{clean}"),
                None => clean,
            };
            Some(Reference { text: full, fully_qualified: true, kind })
        }

        // Clicking a declaration's own name: resolves to itself via the index —
        // cheap way to make Ctrl+Click on a declaration a no-op jump-in-place.
        "class_declaration" | "interface_declaration" | "trait_declaration" | "enum_declaration" => {
            class_ref(false, clean)
        }

        // `helper()` — plain function call (method calls are member_call_expression
        // and resolve in Phase 2). Guard: only when the name IS the callee.
        "function_call_expression" => {
            let is_callee = parent
                .child_by_field_name("function")
                .map(|f| f.id() == target.id())
                .unwrap_or(false);
            if is_callee {
                Some(Reference { text: clean, fully_qualified, kind: RefKind::Function })
            } else {
                None
            }
        }

        _ => None,
    }
}

/// For a `namespace_use_declaration` + the clicked clause: group prefix (if
/// any) + import kind. The `function`/`const` keyword lives inside the clause
/// in tree-sitter-php; the declaration is checked too for grammar drift.
fn use_decl_info(decl: Node, clause: Node, src: &str) -> (Option<String>, RefKind) {
    use super::parser::use_kind_of;
    use super::types::UseKind;
    let kind = match use_kind_of(clause).or_else(|| use_kind_of(decl)) {
        Some(UseKind::Function) => RefKind::Function,
        // `use const` targets aren't resolvable yet; class-like means the
        // resolver simply finds nothing rather than misfiring.
        _ => RefKind::ClassLike,
    };
    let group = decl.named_children(&mut decl.walk()).any(|c| c.kind() == "namespace_use_group");
    let prefix = if group {
        decl.named_children(&mut decl.walk())
            .find(|c| c.kind() == "namespace_name")
            .and_then(|c| text(c, src))
    } else {
        None
    };
    (prefix, kind)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SRC: &str = r#"<?php
namespace App\Http\Controllers;

use App\Models\{User, Post as Article};
use App\Services\Mailer;

#[Route('/users')]
class UserController extends Controller implements Sendable {
    use HasFactory;

    public function show(Mailer $m, \App\Models\User $u): ?User {
        $a = new User();
        $b = User::find(1);
        $c = $u instanceof Article;
        try { helper(); } catch (HttpException $e) {}
        return Article::query();
    }
}
"#;

    /// 1-based (line, col) of the first byte of `needle` (+`offset` chars).
    fn pos(needle: &str, offset: u32) -> (u32, u32) {
        let byte = SRC.find(needle).expect("needle in fixture");
        let line = SRC[..byte].matches('\n').count() as u32 + 1;
        let line_start = SRC[..byte].rfind('\n').map(|i| i + 1).unwrap_or(0);
        let col = SRC[line_start..byte].encode_utf16().count() as u32 + 1;
        (line, col + offset)
    }

    fn class_ref_at(needle: &str, offset: u32) -> Reference {
        let (line, col) = pos(needle, offset);
        reference_at(SRC, line, col).expect("reference")
    }

    #[test]
    fn new_extends_implements_and_types() {
        assert_eq!(class_ref_at("User()", 0).text, "User");
        assert_eq!(class_ref_at("Controller implements", 0).text, "Controller");
        assert_eq!(class_ref_at("Sendable {", 0).text, "Sendable");
        assert_eq!(class_ref_at("Mailer $m", 0).text, "Mailer");
        assert_eq!(class_ref_at("?User {", 1).text, "User"); // return type
        for r in [
            class_ref_at("User()", 0),
            class_ref_at("Mailer $m", 0),
        ] {
            assert_eq!(r.kind, RefKind::ClassLike);
            assert!(!r.fully_qualified);
        }
    }

    #[test]
    fn fully_qualified_param_type() {
        // Click on the "Models" segment → whole qualified name, FQ flag set.
        let r = class_ref_at("\\App\\Models\\User $u", 5);
        assert_eq!(r.text, "App\\Models\\User");
        assert!(r.fully_qualified);
    }

    #[test]
    fn static_call_scope_and_instanceof() {
        assert_eq!(class_ref_at("User::find", 0).text, "User");
        assert_eq!(class_ref_at("Article::query", 0).text, "Article");
        assert_eq!(class_ref_at("Article;", 0).text, "Article"); // instanceof
        // The method name side is NOT a class reference in Phase 1.
        let (line, col) = pos("find(1)", 0);
        assert_eq!(reference_at(SRC, line, col), None);
    }

    #[test]
    fn attribute_trait_use_and_catch() {
        assert_eq!(class_ref_at("Route(", 0).text, "Route");
        assert_eq!(class_ref_at("HasFactory;", 0).text, "HasFactory");
        assert_eq!(class_ref_at("HttpException $e", 0).text, "HttpException");
    }

    #[test]
    fn import_clause_click_resolves_full_path() {
        // Simple member of a group import.
        let r = class_ref_at("User, Post", 0);
        assert_eq!(r.text, "App\\Models\\User");
        assert!(r.fully_qualified);
        // Aliased member: clicking the ORIGINAL name resolves the target.
        let r = class_ref_at("Post as", 0);
        assert_eq!(r.text, "App\\Models\\Post");
        // Plain import.
        let r = class_ref_at("Mailer;", 0);
        assert_eq!(r.text, "App\\Services\\Mailer");
    }

    #[test]
    fn function_call_and_declaration_self() {
        let r = class_ref_at("helper()", 0);
        assert_eq!(r.kind, RefKind::Function);
        assert_eq!(r.text, "helper");
        let r = class_ref_at("UserController extends", 0);
        assert_eq!(r.text, "UserController");
    }

    #[test]
    fn click_at_end_of_identifier() {
        // Cursor column just past "User" in `new User()` still resolves.
        let (line, col) = pos("User()", 0);
        let end = col + "User".len() as u32; // exclusive end of the identifier
        let r = reference_at(SRC, line, end).expect("end-of-token reference");
        assert_eq!(r.text, "User");
    }

    #[test]
    fn non_references_return_none() {
        let (line, col) = pos("$a = new", 0); // a variable (Phase 3)
        assert_eq!(reference_at(SRC, line, col), None);
        let (line, col) = pos("public function show", 0); // keyword
        assert_eq!(reference_at(SRC, line, col), None);
    }
}
