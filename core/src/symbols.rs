//! Heuristic "Go to Symbol in File" engine. A real parser/LSP is out of scope for
//! Phase 3, so we scan a file line by line and apply a small ordered set of
//! line-anchored regexes per language. Regexes are deliberately permissive; a
//! shared keyword denylist removes the obvious false positives (control-flow
//! statements that look like calls/methods). First non-keyword rule per line wins.
//!
//! Rule sets were designed with a per-language agent pass (regexes + fixtures);
//! the fixtures drive the unit tests below.

use std::sync::{Arc, OnceLock};

use axum::{extract::State, routing::post, Json, Router};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/api/symbols", post(symbols))
}

#[derive(Deserialize)]
struct Body {
    path: String,
    /// The live editor buffer (so symbols reflect unsaved edits).
    content: String,
}

#[derive(Serialize, Debug, PartialEq)]
struct Symbol {
    name: String,
    kind: &'static str,
    line: u64,
    /// 1-based UTF-16 column of the name (for editor cursor placement).
    col: u32,
    /// Leading-whitespace columns (tabs as 4), for nested indentation in the UI.
    indent: u32,
}

async fn symbols(State(_st): State<Arc<AppState>>, Json(b): Json<Body>) -> Json<Value> {
    // Scanning every line with ~12 regexes is CPU-bound → keep it off the async
    // worker (matches search.rs). Returns [] if the blocking task panics.
    let syms = tokio::task::spawn_blocking(move || extract(lang_of(&b.path), &b.content))
        .await
        .unwrap_or_default();
    Json(json!({ "symbols": syms }))
}

#[derive(Clone, Copy, PartialEq)]
enum Lang {
    TsJs,
    Python,
    Go,
    Rust,
    Php,
    None,
}

fn lang_of(path: &str) -> Lang {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "mts" | "cts" => Lang::TsJs,
        "py" | "pyi" => Lang::Python,
        "go" => Lang::Go,
        "rs" => Lang::Rust,
        "php" | "phtml" => Lang::Php,
        _ => Lang::None,
    }
}

struct Rule {
    kind: &'static str,
    re: Regex,
    name_group: usize,
}

fn rule(kind: &'static str, pat: &str, name_group: usize) -> Rule {
    Rule { kind, re: Regex::new(pat).expect("symbol rule regex"), name_group }
}

// Reserved control-flow keywords the permissive method rules (e.g. `if (...) {`)
// can capture as a fake symbol name. Kept DELIBERATELY NARROW: only words that are
// reserved everywhere the bare-paren method rule applies, so it never drops a real
// identifier like `range`, `match`, `select`, `type`, or `from`. Compared
// case-sensitively (keywords are lowercase; a symbol named `If` is still kept).
const KEYWORDS: &[&str] = &[
    "if", "else", "elif", "for", "foreach", "while", "switch", "case", "default", "do", "try",
    "catch", "finally", "with", "return", "throw", "break", "continue", "goto",
];

fn is_keyword(name: &str) -> bool {
    KEYWORDS.contains(&name)
}

fn is_comment_line(lang: Lang, trimmed: &str) -> bool {
    if trimmed.starts_with("//") || trimmed.starts_with("/*") || trimmed.starts_with('*') {
        return true;
    }
    matches!(lang, Lang::Python | Lang::Php) && trimmed.starts_with('#')
}

fn indent_of(line: &str) -> u32 {
    let mut n = 0u32;
    for c in line.chars() {
        match c {
            '\t' => n += 4,
            ' ' => n += 1,
            _ => break,
        }
    }
    n
}

fn utf16_col(line: &str, byte_start: usize) -> u32 {
    line[..byte_start].encode_utf16().count() as u32 + 1
}

fn extract(lang: Lang, content: &str) -> Vec<Symbol> {
    let rules = rules_for(lang);
    if rules.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    for (i, line) in content.lines().enumerate() {
        let trimmed = line.trim_start();
        if trimmed.is_empty() || is_comment_line(lang, trimmed) {
            continue;
        }
        for r in rules {
            let Some(caps) = r.re.captures(line) else { continue };
            let Some(m) = caps.get(r.name_group) else { continue };
            let name = m.as_str();
            if is_keyword(name) {
                continue; // a permissive rule caught a keyword — try the next rule
            }
            let indent = indent_of(line);
            // An indented function-like declaration is a method (Rust impl fns,
            // Python/PHP class methods, etc.).
            let kind = if r.kind == "function" && indent > 0 { "method" } else { r.kind };
            out.push(Symbol { name: name.to_string(), kind, line: (i + 1) as u64, col: utf16_col(line, m.start()), indent });
            break; // first non-keyword rule wins for this line
        }
    }
    out
}

fn rules_for(lang: Lang) -> &'static [Rule] {
    macro_rules! cached {
        ($f:ident) => {{
            static R: OnceLock<Vec<Rule>> = OnceLock::new();
            R.get_or_init($f)
        }};
    }
    match lang {
        Lang::TsJs => cached!(ts_rules),
        Lang::Python => cached!(py_rules),
        Lang::Go => cached!(go_rules),
        Lang::Rust => cached!(rust_rules),
        Lang::Php => cached!(php_rules),
        Lang::None => &[],
    }
}

fn ts_rules() -> Vec<Rule> {
    vec![
        rule("class", r"^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)", 1),
        rule("interface", r"^\s*(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)", 1),
        rule("enum", r"^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)", 1),
        rule("type", r"^\s*(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)", 1),
        rule("namespace", r"^\s*(?:export\s+)?(?:declare\s+)?(?:namespace|module)\s+([A-Za-z_$][\w$.]*)", 1),
        rule("function", r"^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)", 1),
        // top-level arrow / function-expression consts (column 0 only — skip locals)
        rule(
            "function",
            r"^(?:export\s+)?(?:default\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+?)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+?)?=>|[A-Za-z_$][\w$]*\s*=>|<)",
            1,
        ),
        // other top-level bindings (column 0 only): const → constant, let/var → variable
        rule("constant", r"^(?:export\s+)?(?:default\s+)?const\s+([A-Za-z_$][\w$]*)", 1),
        rule("variable", r"^(?:export\s+)?(?:default\s+)?(?:let|var)\s+([A-Za-z_$][\w$]*)", 1),
        // class-field arrow methods (indented): `handleClick = (e) => {}`
        rule(
            "method",
            r"^\s+(?:(?:public|private|protected|static|readonly|abstract|override|async)\s+)*([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+?)?=\s*(?:async\s+)?(?:\([^)]*\)\s*(?::[^=]+?)?=>|[A-Za-z_$][\w$]*\s*=>)",
            1,
        ),
        // methods with a `{` body (indented): `async run(): Promise<void> {`
        rule(
            "method",
            r"^\s+(?:(?:public|private|protected|static|async|readonly|abstract|override|get|set)\s+)*\*?\s*([A-Za-z_$][\w$]*)\s*\??\s*\([^;{]*\)\s*(?::[^={;]+)?\{",
            1,
        ),
        // abstract / overload / ambient method signatures ending in `;` (need a modifier)
        rule(
            "method",
            r"^\s+(?:(?:public|private|protected|static|abstract|override|async|get|set|readonly)\s+)+\*?\s*([A-Za-z_$][\w$]*)\s*\??\s*\([^;{]*\)\s*(?::[^={;]+)?;",
            1,
        ),
        // class fields carrying an access/readonly/static modifier (avoids object keys)
        rule("property", r"^\s+(?:(?:public|private|protected|static|readonly|abstract|declare)\s+)+([A-Za-z_$][\w$]*)\s*[?!]?\s*[:=]", 1),
    ]
}

fn py_rules() -> Vec<Rule> {
    vec![
        rule("class", r"^\s*class\s+([A-Za-z_]\w*)", 1),
        rule("function", r"^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)", 1),
        rule("type", r"^\s*type\s+([A-Za-z_]\w*)\s*=", 1),
        rule("constant", r"^([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=[^=]", 1),
        rule("variable", r"^([a-z_]\w*)\s*:\s*[^=\n]", 1),
    ]
}

fn go_rules() -> Vec<Rule> {
    vec![
        rule("method", r"^\s*func\s+\([^)]*\)\s*([A-Za-z_]\w*)", 1),
        rule("function", r"^\s*func\s+([A-Za-z_]\w*)", 1),
        rule("struct", r"^\s*type\s+([A-Za-z_]\w*)(?:\[[^\]]*\])?\s+struct\b", 1),
        rule("interface", r"^\s*type\s+([A-Za-z_]\w*)(?:\[[^\]]*\])?\s+interface\b", 1),
        rule("type", r"^\s*type\s+([A-Za-z_]\w*)(?:\[[^\]]*\])?\s", 1),
        rule("constant", r"^\s*const\s+([A-Za-z_]\w*)\b", 1),
        rule("variable", r"^\s*var\s+([A-Za-z_]\w*)\b", 1),
        // exported member inside a const/var ( ... ) block (incl. iota enums)
        rule("constant", r"^\s+([A-Z]\w*)(?:\s+[\w.*\[\]]+)?\s*=\s*\S", 1),
    ]
}

fn rust_rules() -> Vec<Rule> {
    vec![
        rule(
            "function",
            r#"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:default\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+(?:"[^"]*"\s+)?)?fn\s+([A-Za-z_]\w*)"#,
            1,
        ),
        rule("struct", r"^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)", 1),
        rule("enum", r"^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)", 1),
        rule("trait", r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?trait\s+([A-Za-z_]\w*)", 1),
        rule("union", r"^\s*(?:pub(?:\([^)]*\))?\s+)?union\s+([A-Za-z_]\w*)", 1),
        rule("impl", r"^\s*(?:unsafe\s+)?impl(?:\s*<[^>]*>)?\s+(?:[A-Za-z_][\w:]*(?:\s*<[^>]*>)?\s+for\s+)?([A-Za-z_][\w:]*)", 1),
        rule("type", r"^\s*(?:pub(?:\([^)]*\))?\s+)?type\s+([A-Za-z_]\w*)", 1),
        rule("constant", r"^\s*(?:pub(?:\([^)]*\))?\s+)?const\s+([A-Za-z_]\w*)\s*:", 1),
        rule("constant", r"^\s*(?:pub(?:\([^)]*\))?\s+)?static\s+(?:mut\s+)?([A-Za-z_]\w*)\s*:", 1),
        rule("module", r"^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)", 1),
        rule("macro", r"^\s*macro_rules!\s*([A-Za-z_]\w*)", 1),
    ]
}

fn php_rules() -> Vec<Rule> {
    vec![
        rule("interface", r"^\s*interface\s+([A-Za-z_]\w*)", 1),
        rule("trait", r"^\s*trait\s+([A-Za-z_]\w*)", 1),
        rule("enum", r"^\s*enum\s+([A-Za-z_]\w*)", 1),
        rule("class", r"^\s*(?:(?:abstract|final|readonly)\s+)*class\s+([A-Za-z_]\w*)", 1),
        rule(
            "function",
            r"^\s*(?:(?:final|abstract|public|protected|private|static)\s+)*function\s*&?\s*([A-Za-z_]\w*)\s*\(",
            1,
        ),
        rule("enum_case", r"^\s*case\s+([A-Za-z_]\w*)\s*(?:=|;)", 1),
        rule("constant", r"^\s*(?:(?:public|protected|private|final)\s+)*const\s+(?:[A-Za-z_\\][\w\\|]*\s+)?([A-Za-z_]\w*)\s*=", 1),
        rule("property", r"^\s*(?:(?:public|protected|private|static|readonly)\s+)+(?:\??[A-Za-z_\\][\w\\|]*\s+)?\$([A-Za-z_]\w*)", 1),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(syms: &[Symbol]) -> Vec<(&str, &str, u64)> {
        syms.iter().map(|s| (s.name.as_str(), s.kind, s.line)).collect()
    }
    fn has(syms: &[Symbol], name: &str, kind: &str, line: u64) -> bool {
        names(syms).contains(&(name, kind, line))
    }

    #[test]
    fn ts_class_members_arrow_fields_and_signatures() {
        let src = "export class FooService {\n  private readonly count: number = 0;\n  static instances = 0;\n  constructor(private http: Http) {}\n  async fetchData(id: string): Promise<Data> {\n    if (!id) {\n      const local = 1;\n    }\n  }\n  get total(): number { return this.count; }\n  abstract render(): void;\n  handleClick = (e: Event): void => {};\n}\n";
        let got = extract(Lang::TsJs, src);
        assert!(has(&got, "FooService", "class", 1));
        assert!(has(&got, "count", "property", 2));
        assert!(has(&got, "instances", "property", 3));
        assert!(has(&got, "constructor", "method", 4));
        assert!(has(&got, "fetchData", "method", 5));
        assert!(has(&got, "total", "method", 10));
        assert!(has(&got, "render", "method", 11));
        assert!(has(&got, "handleClick", "method", 12));
        // control-flow + local const must NOT be symbols
        assert!(!names(&got).iter().any(|(n, ..)| *n == "if" || *n == "local"));
    }

    #[test]
    fn ts_top_level_functions_consts_and_types() {
        let src = "export const getHealth = (): Promise<Health> => fetch('/x');\nconst clamp = (v, lo, hi) => Math.min(hi, v);\nexport const useStore = create<State>((set) => ({}));\nconst PERSIST_KEY = 'jakide.ui';\nexport const identity = <T>(x: T): T => x;\nlet counter = 0;\nexport interface State { count: number; }\nexport type ID = string;\nexport enum Color { Red, Green }\nexport function langFor(p) { return 'x'; }\nexport default function App() { return null; }\nfunction* range(n) { yield n; }\n";
        let got = extract(Lang::TsJs, src);
        assert!(has(&got, "getHealth", "function", 1));
        assert!(has(&got, "clamp", "function", 2));
        assert!(has(&got, "useStore", "constant", 3));
        assert!(has(&got, "PERSIST_KEY", "constant", 4));
        assert!(has(&got, "identity", "function", 5));
        assert!(has(&got, "counter", "variable", 6));
        assert!(has(&got, "State", "interface", 7));
        assert!(has(&got, "ID", "type", 8));
        assert!(has(&got, "Color", "enum", 9));
        assert!(has(&got, "langFor", "function", 10));
        assert!(has(&got, "App", "function", 11));
        assert!(has(&got, "range", "function", 12));
    }

    #[test]
    fn python_classes_methods_types_and_constants() {
        let src = "MAX_RETRIES = 5\ndebug_mode: bool = False\n\nclass Animal:\n    def __init__(self):\n        pass\n    async def speak(self):\n        pass\n\ndef top():\n    pass\ntype Vector = list[float]\n";
        let got = extract(Lang::Python, src);
        assert!(has(&got, "MAX_RETRIES", "constant", 1));
        assert!(has(&got, "debug_mode", "variable", 2));
        assert!(has(&got, "Animal", "class", 4));
        assert!(has(&got, "__init__", "method", 5));
        assert!(has(&got, "speak", "method", 7));
        assert!(has(&got, "top", "function", 10));
        assert!(has(&got, "Vector", "type", 12));
    }

    #[test]
    fn go_funcs_methods_types_and_iota() {
        let src = "package main\n\ntype Weekday int\n\nconst (\n\tSunday Weekday = iota\n\tMonday\n)\n\ntype Shape interface {\n\tArea() float64\n}\n\ntype Circle struct {\n\tR float64\n}\n\nfunc (c Circle) Area() float64 {\n\treturn 3.14 * c.R\n}\n\nfunc NewCircle(r float64) *Circle {\n\treturn &Circle{r}\n}\n";
        let got = extract(Lang::Go, src);
        assert!(has(&got, "Weekday", "type", 3));
        assert!(has(&got, "Sunday", "constant", 6));
        assert!(has(&got, "Shape", "interface", 10));
        assert!(has(&got, "Circle", "struct", 14));
        assert!(has(&got, "Area", "method", 18));
        assert!(has(&got, "NewCircle", "function", 22));
    }

    #[test]
    fn rust_items_impl_macros_and_methods() {
        let src = "macro_rules! try_it { () => {}; }\n\npub struct Point {\n    x: i32,\n}\n\npub enum Color { Red }\n\npub trait Draw {\n    fn draw(&self);\n}\n\nimpl Draw for Point {\n    fn draw(&self) {}\n}\n\npub union Slot { a: i32 }\n\nmod tests {}\n\nconst MAX: usize = 10;\n";
        let got = extract(Lang::Rust, src);
        assert!(has(&got, "try_it", "macro", 1));
        assert!(has(&got, "Point", "struct", 3));
        assert!(has(&got, "Color", "enum", 7));
        assert!(has(&got, "Draw", "trait", 9));
        assert!(has(&got, "draw", "method", 10)); // signature in trait → method
        assert!(has(&got, "Point", "impl", 13)); // impl ... for Point
        assert!(has(&got, "draw", "method", 14)); // impl fn → method
        assert!(has(&got, "Slot", "union", 17));
        assert!(has(&got, "tests", "module", 19));
        assert!(has(&got, "MAX", "constant", 21));
    }

    #[test]
    fn php_classes_methods_props_consts_and_enum_cases() {
        let src = "<?php\nclass UserService {\n    const VERSION = '1.0';\n    private LoggerInterface $logger;\n    public function __construct() {}\n    private static function make(): self {}\n}\ninterface Repo {}\nenum Suit {\n    case Hearts;\n    case Spades;\n}\nfunction helper() {}\n";
        let got = extract(Lang::Php, src);
        assert!(has(&got, "UserService", "class", 2));
        assert!(has(&got, "VERSION", "constant", 3));
        assert!(has(&got, "logger", "property", 4));
        assert!(has(&got, "__construct", "method", 5));
        assert!(has(&got, "make", "method", 6));
        assert!(has(&got, "Repo", "interface", 8));
        assert!(has(&got, "Suit", "enum", 9));
        assert!(has(&got, "Hearts", "enum_case", 10));
        assert!(has(&got, "helper", "function", 13));
    }

    #[test]
    fn unknown_language_returns_empty() {
        assert!(extract(Lang::None, "anything here\n").is_empty());
    }

    #[test]
    fn utf16_columns_account_for_wide_chars() {
        let src = "const café = () => 1;\n";
        let syms = extract(Lang::TsJs, src);
        assert_eq!(syms[0].name, "café");
        assert_eq!(syms[0].col, 7); // "const " = 6 UTF-16 units, name at col 7
    }
}
