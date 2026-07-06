//! Tree-sitter-backed PHP parsing: symbol declarations, namespace/use context,
//! and editor↔byte position conversion.
//!
//! This file is the only place that knows tree-sitter-php node kinds for
//! *declarations*; reference (usage) extraction lives in refs.rs. Adding a new
//! language later means a sibling module with the same three entry points
//! (`parse`, `extract_declarations`, `context_at`) behind a language switch.

use tree_sitter::{Node, Parser, Tree};

use super::types::{Declaration, FileContext, SymbolKind, UseImport, UseKind};

/// Parse PHP source. Returns `None` only if the grammar fails to load or the
/// source is pathological (tree-sitter itself is error-tolerant).
pub fn parse(content: &str) -> Option<Tree> {
    let mut parser = Parser::new();
    parser.set_language(&tree_sitter_php::LANGUAGE_PHP.into()).ok()?;
    parser.parse(content, None)
}

/// All class-like + top-level function declarations in the file, with FQNs.
/// Handles unbraced (`namespace A;`) and braced (`namespace A { }`) forms,
/// including multiple namespaces per file.
pub fn extract_declarations(content: &str) -> Vec<Declaration> {
    let Some(tree) = parse(content) else { return Vec::new() };
    let mut out = Vec::new();
    collect_decls(tree.root_node(), content, &mut String::new(), &mut out);
    out
}

fn collect_decls(scope: Node, src: &str, ns: &mut String, out: &mut Vec<Declaration>) {
    let mut cursor = scope.walk();
    for node in scope.named_children(&mut cursor) {
        match node.kind() {
            "namespace_definition" => {
                let name = node
                    .named_children(&mut node.walk())
                    .find(|c| c.kind() == "namespace_name")
                    .and_then(|c| text(c, src))
                    .unwrap_or_default();
                match node.named_children(&mut node.walk()).find(|c| c.kind() == "compound_statement") {
                    // Braced form: declarations live inside the block.
                    Some(body) => collect_decls(body, src, &mut name.clone(), out),
                    // Unbraced form: applies to the remaining siblings.
                    None => *ns = name,
                }
            }
            "class_declaration" => push_decl(node, src, ns, SymbolKind::Class, out),
            "interface_declaration" => push_decl(node, src, ns, SymbolKind::Interface, out),
            "trait_declaration" => push_decl(node, src, ns, SymbolKind::Trait, out),
            "enum_declaration" => push_decl(node, src, ns, SymbolKind::Enum, out),
            "function_definition" => push_decl(node, src, ns, SymbolKind::Function, out),
            _ => {}
        }
    }
}

fn push_decl(node: Node, src: &str, ns: &str, kind: SymbolKind, out: &mut Vec<Declaration>) {
    let Some(name_node) = node.child_by_field_name("name") else { return };
    let Some(name) = text(name_node, src) else { return };
    let (line, col) = editor_pos(name_node, src);
    let fqn = if ns.is_empty() { name.clone() } else { format!("{ns}\\{name}") };
    out.push(Declaration { name, fqn, kind, line, col });
}

/// Namespace + use imports in effect at `byte`. Use statements are collected
/// file-wide (PHP scopes them per namespace block, but per-file is what real
/// code does); the namespace is the innermost/latest one covering `byte`.
pub fn context_at(content: &str, byte: usize) -> FileContext {
    let Some(tree) = parse(content) else { return FileContext::default() };
    let mut ctx = FileContext::default();
    collect_context(tree.root_node(), content, byte, &mut ctx);
    ctx
}

fn collect_context(scope: Node, src: &str, byte: usize, ctx: &mut FileContext) {
    let mut cursor = scope.walk();
    for node in scope.named_children(&mut cursor) {
        match node.kind() {
            "namespace_definition" => {
                let name = node
                    .named_children(&mut node.walk())
                    .find(|c| c.kind() == "namespace_name")
                    .and_then(|c| text(c, src))
                    .unwrap_or_default();
                match node.named_children(&mut node.walk()).find(|c| c.kind() == "compound_statement") {
                    Some(body) => {
                        if node.start_byte() <= byte && byte < node.end_byte() {
                            ctx.namespace = name;
                        }
                        collect_context(body, src, byte, ctx);
                    }
                    None => {
                        if node.start_byte() <= byte {
                            ctx.namespace = name;
                        }
                    }
                }
            }
            "namespace_use_declaration" => ctx.uses.extend(parse_use(node, src)),
            _ => {}
        }
    }
}

/// Expand one `use` declaration into imports (handles aliases, group form,
/// and the `function` / `const` variants).
pub fn parse_use(node: Node, src: &str) -> Vec<UseImport> {
    // `use function f;` / `use const C;` — the keyword sits INSIDE the clause
    // in tree-sitter-php, but check the declaration too for grammar drift.
    let decl_kind = use_kind_of(node).unwrap_or(UseKind::Type);

    // Group form: `use Prefix\{A, B as C};` → namespace_name + namespace_use_group.
    let prefix = node
        .named_children(&mut node.walk())
        .find(|c| c.kind() == "namespace_name")
        .and_then(|c| text(c, src));

    let mut out = Vec::new();
    let mut walk_clauses = |parent: Node| {
        let mut c = parent.walk();
        for clause in parent.named_children(&mut c) {
            if clause.kind() != "namespace_use_clause" {
                continue;
            }
            let kind = use_kind_of(clause).unwrap_or(decl_kind);
            if let Some(imp) = parse_use_clause(clause, src, prefix.as_deref(), kind) {
                out.push(imp);
            }
        }
    };
    match node.named_children(&mut node.walk()).find(|c| c.kind() == "namespace_use_group") {
        Some(group) => walk_clauses(group),
        None => walk_clauses(node),
    }
    out
}

/// The `function` / `const` keyword directly under `node`, if any.
pub fn use_kind_of(node: Node) -> Option<UseKind> {
    node.children(&mut node.walk()).find_map(|c| match c.kind() {
        "function" => Some(UseKind::Function),
        "const" => Some(UseKind::Const),
        _ => None,
    })
}

fn parse_use_clause(clause: Node, src: &str, prefix: Option<&str>, kind: UseKind) -> Option<UseImport> {
    let mut cursor = clause.walk();
    let mut named = clause.named_children(&mut cursor);
    let path_node = named.next()?;
    let path = text(path_node, src)?;
    let path = path.trim_start_matches('\\').to_string();
    // Alias: a following bare `name`, possibly wrapped in an aliasing clause.
    let alias = named.find_map(|n| match n.kind() {
        "name" => text(n, src),
        "namespace_aliasing_clause" => {
            n.named_children(&mut n.walk()).find(|c| c.kind() == "name").and_then(|c| text(c, src))
        }
        _ => None,
    });
    let fqn = match prefix {
        Some(p) => format!("{p}\\{path}"),
        None => path,
    };
    let alias = alias.unwrap_or_else(|| fqn.rsplit('\\').next().unwrap_or_default().to_string());
    if fqn.is_empty() || alias.is_empty() {
        return None;
    }
    Some(UseImport { alias, fqn, kind })
}

// ---------------------------------------------------------------------------
// Position helpers (1-based line, 1-based UTF-16 column ↔ byte offsets)
// ---------------------------------------------------------------------------

pub fn text(node: Node, src: &str) -> Option<String> {
    node.utf8_text(src.as_bytes()).ok().map(str::to_string)
}

/// Editor position (1-based line, 1-based UTF-16 col) of a node's start.
pub fn editor_pos(node: Node, src: &str) -> (u32, u32) {
    let row = node.start_position().row;
    // Point.column counts BYTES within the line; re-measure in UTF-16 units.
    let line_start = node.start_byte() - node.start_position().column;
    let col = src[line_start..node.start_byte()].encode_utf16().count() as u32 + 1;
    (row as u32 + 1, col)
}

/// Byte offset of an editor position. Clamps the column to the line end so a
/// click just past the last character still resolves.
pub fn byte_offset(content: &str, line: u32, col_utf16: u32) -> Option<usize> {
    if line == 0 || col_utf16 == 0 {
        return None;
    }
    let mut start = 0usize;
    for _ in 1..line {
        start += content[start..].find('\n')? + 1;
    }
    let line_end = content[start..].find('\n').map(|i| start + i).unwrap_or(content.len());
    let line_text = &content[start..line_end];
    let mut remaining = col_utf16 - 1;
    for (i, ch) in line_text.char_indices() {
        if remaining == 0 {
            return Some(start + i);
        }
        let units = ch.len_utf16() as u32;
        if units > remaining {
            return Some(start + i);
        }
        remaining -= units;
    }
    Some(line_end)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"<?php
namespace App\Http\Controllers;

use App\Models\{User, Post as Article};
use App\Services\UserService as Service;
use function App\Support\helper_fn;
use App\Contracts\Repo;

class UserController extends Controller {}
interface Sendable {}
trait HasStuff {}
enum Status: string {}
function top_level(): void {}
"#;

    #[test]
    fn declarations_with_namespaces() {
        let decls = extract_declarations(FIXTURE);
        let fqns: Vec<(&str, SymbolKind)> =
            decls.iter().map(|d| (d.fqn.as_str(), d.kind)).collect();
        assert_eq!(
            fqns,
            vec![
                ("App\\Http\\Controllers\\UserController", SymbolKind::Class),
                ("App\\Http\\Controllers\\Sendable", SymbolKind::Interface),
                ("App\\Http\\Controllers\\HasStuff", SymbolKind::Trait),
                ("App\\Http\\Controllers\\Status", SymbolKind::Enum),
                ("App\\Http\\Controllers\\top_level", SymbolKind::Function),
            ]
        );
        let user_controller = &decls[0];
        assert_eq!(user_controller.line, 9);
        assert_eq!(user_controller.col, 7); // "class " is 6 chars
    }

    #[test]
    fn braced_and_multiple_namespaces() {
        let src = "<?php\nnamespace A {\n  class X {}\n}\nnamespace B {\n  class Y {}\n}\n";
        let fqns: Vec<String> = extract_declarations(src).into_iter().map(|d| d.fqn).collect();
        assert_eq!(fqns, vec!["A\\X", "B\\Y"]);
    }

    #[test]
    fn global_namespace_declarations() {
        let src = "<?php\nclass Plain {}\nfunction f() {}\n";
        let decls = extract_declarations(src);
        assert_eq!(decls[0].fqn, "Plain");
        assert_eq!(decls[1].fqn, "f");
    }

    #[test]
    fn context_collects_uses_and_aliases() {
        let byte = FIXTURE.find("class UserController").unwrap();
        let ctx = context_at(FIXTURE, byte);
        assert_eq!(ctx.namespace, "App\\Http\\Controllers");
        let find = |alias: &str| ctx.uses.iter().find(|u| u.alias == alias).cloned();
        assert_eq!(find("User").unwrap().fqn, "App\\Models\\User");
        assert_eq!(find("Article").unwrap().fqn, "App\\Models\\Post"); // group alias
        assert_eq!(find("Service").unwrap().fqn, "App\\Services\\UserService"); // plain alias
        assert_eq!(find("Repo").unwrap().fqn, "App\\Contracts\\Repo");
        let helper = find("helper_fn").unwrap();
        assert_eq!(helper.fqn, "App\\Support\\helper_fn");
        assert_eq!(helper.kind, UseKind::Function);
    }

    #[test]
    fn context_namespace_scoping_braced() {
        let src = "<?php\nnamespace A {\n  class X {}\n}\nnamespace B {\n  class Y {}\n}\n";
        let in_b = src.find("class Y").unwrap();
        assert_eq!(context_at(src, in_b).namespace, "B");
        let in_a = src.find("class X").unwrap();
        assert_eq!(context_at(src, in_a).namespace, "A");
    }

    #[test]
    fn byte_offset_handles_utf16_columns() {
        // "é" is 2 bytes / 1 UTF-16 unit; "😀" is 4 bytes / 2 UTF-16 units.
        let src = "<?php\n$é = 1; // 😀 ok\n$x = 2;\n";
        // Column of "$x" on line 3 is 1.
        assert_eq!(byte_offset(src, 3, 1), Some(src.find("$x").unwrap()));
        // Line 2: col 1 → "$é" start; col 4 → after "$é " (é = 1 unit).
        assert_eq!(byte_offset(src, 2, 1), Some(6));
        let eq_byte = src.find("= 1").unwrap();
        assert_eq!(byte_offset(src, 2, 4), Some(eq_byte));
        // Past end of line clamps to line end.
        assert_eq!(byte_offset(src, 3, 99), Some(src.rfind(';').unwrap() + 1));
    }

    #[test]
    fn editor_pos_is_utf16() {
        let src = "<?php\n/* 😀 */ class Wide {}\n";
        let decls = extract_declarations(src);
        assert_eq!(decls[0].name, "Wide");
        assert_eq!(decls[0].line, 2);
        // "/* 😀 */ class " = 13 ASCII chars + 😀 (2 UTF-16 units / 4 bytes)
        // → 15 units before the name → col 16 (byte column would be 18).
        assert_eq!(decls[0].col, 16);
    }
}
