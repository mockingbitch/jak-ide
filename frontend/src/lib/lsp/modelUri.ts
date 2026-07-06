import type { editor } from 'monaco-editor';

// How @monaco-editor/react models are identified by URI scheme.
//
// The Editor builds a model URI with `monaco.Uri.parse(path)`. For a project-
// relative path (`app/Models/User.php`) monaco coerces the empty scheme to
// `file` (its `_schemeFix` when non-strict), so in-project editable models have
// scheme `file` — NOT the empty string. External read-only tabs use `ext:`
// (ExternalFileTab), and diff/aux models are `inmemory`. We accept `''` too so
// the check can't silently break if a future monaco stops coercing.
const IN_PROJECT_SCHEMES = new Set(['file', '']);
export const EXTERNAL_SCHEME = 'ext';

/** An editable, indexed project file (skip external `ext:` and `inmemory` aux models). */
export const isInProjectModel = (model: editor.ITextModel): boolean =>
  IN_PROJECT_SCHEMES.has(model.uri.scheme);

/** The project-relative posix path of a model URI (leading slashes stripped). */
export const relPathOf = (model: editor.ITextModel): string => model.uri.path.replace(/^\/+/, '');
