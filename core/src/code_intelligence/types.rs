//! Shared types for the code-intelligence engine.
//!
//! Positions are editor-facing everywhere in this module tree: 1-based lines,
//! 1-based UTF-16 columns (matching symbols.rs and the Monaco frontend).

use std::path::PathBuf;

use serde::Serialize;

/// Kind of a declared symbol. Serialises lowercase into API responses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SymbolKind {
    Class,
    Interface,
    Trait,
    Enum,
    Function,
}

impl SymbolKind {
    pub fn is_class_like(self) -> bool {
        !matches!(self, SymbolKind::Function)
    }
}

/// A symbol declaration found in a file.
#[derive(Debug, Clone, PartialEq)]
pub struct Declaration {
    /// Short name as written (`User`).
    pub name: String,
    /// Fully-qualified name, no leading backslash (`App\Models\User`).
    pub fqn: String,
    pub kind: SymbolKind,
    /// 1-based line of the name token.
    pub line: u32,
    /// 1-based UTF-16 column of the name token.
    pub col: u32,
}

/// One `use` import, already expanded from group form
/// (`use App\Models\{User, Post as Article};` yields two entries).
#[derive(Debug, Clone, PartialEq)]
pub struct UseImport {
    /// Local alias: the explicit `as` name, or the last FQN segment.
    pub alias: String,
    /// Fully-qualified target, no leading backslash.
    pub fqn: String,
    pub kind: UseKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UseKind {
    /// Classes, interfaces, traits, enums (plain `use`).
    Type,
    /// `use function`.
    Function,
    /// `use const` (resolution lands in a later phase).
    Const,
}

/// Name-resolution context in effect at a position in a PHP file.
#[derive(Debug, Default, Clone)]
pub struct FileContext {
    /// Namespace containing the position (empty string = global namespace).
    pub namespace: String,
    pub uses: Vec<UseImport>,
}

/// What kind of thing the cursor is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefKind {
    ClassLike,
    Function,
}

/// A reference (usage) under the cursor, as written in the source.
#[derive(Debug, Clone, PartialEq)]
pub struct Reference {
    /// The referenced path as written, leading backslash stripped (`App\Models\User` or `User`).
    pub text: String,
    /// True when written fully qualified (`\App\Models\User`) or when the
    /// reference *is* an import path (clicking inside a `use` statement).
    pub fully_qualified: bool,
    pub kind: RefKind,
}

/// A resolved definition candidate (absolute target path; the HTTP layer
/// converts to project-relative for in-root targets).
#[derive(Debug, Clone)]
pub struct Candidate {
    pub path: PathBuf,
    pub line: u32,
    pub col: u32,
    pub name: String,
    pub kind: SymbolKind,
    /// 0..1 — how certain the resolution is (exact import match > namespace
    /// guess > PSR-4 file fallback > name-only index match).
    pub confidence: f32,
}
