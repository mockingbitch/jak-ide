import { useStore, activeFileTab } from '../store';
import { getEditor } from '../lib/editorRegistry';
import { gotoLine } from '../lib/monacoActions';
import { IconAI, IconBranch } from './icons';

function langLabel(path?: string | null): string {
  if (!path) return '';
  const base = path.split('/').pop() ?? '';
  if (base === 'Dockerfile') return 'Dockerfile';
  const ext = base.split('.').pop()?.toUpperCase();
  return ext ?? 'TEXT';
}

export function StatusBar() {
  const tab = useStore(activeFileTab);
  const cursor = useStore((s) => s.cursor);
  const model = useStore((s) => s.model);
  const auth = useStore((s) => s.auth);
  const terminalShell = useStore((s) => s.terminalShell);
  const git = useStore((s) => s.git);
  const selectLeftView = useStore((s) => s.selectLeftView);

  const activePath = tab?.path ?? null;
  const dirty = tab?.dirty ?? false;
  const eol = tab && tab.content.includes('\r\n') ? 'CRLF' : 'LF';
  const segs = activePath ? activePath.split('/').filter(Boolean) : [];

  const authLabel = auth.method === 'claude-code' ? 'Claude Code' : model || 'AI';
  const authTitle = auth.hasAuth
    ? `Connected via ${auth.method === 'claude-code' ? 'Claude Code' : auth.method === 'oauth' ? 'Anthropic sign-in' : 'API key'}`
    : 'Not connected — sign in or set an API key';

  return (
    <div className="statusbar">
      <div className="left">
        {activePath ? (
          <span className="seg crumbs" title={activePath}>
            {segs.map((s, i) => (
              <span key={i}>
                {i > 0 && <span className="sep"> › </span>}
                {s}
              </span>
            ))}
          </span>
        ) : (
          <span className="seg">No file open</span>
        )}
        {dirty && <span className="seg dot" title="Unsaved changes">●</span>}
      </div>
      <div className="right">
        {git.repo && (git.branch || git.detached) && (
          <span className="seg btn" title="Version control — click to open" onClick={() => selectLeftView('git')}>
            <IconBranch size={13} />
            {git.branch ?? 'detached'}
            {!!git.ahead && <span className="git-ab">↑{git.ahead}</span>}
            {!!git.behind && <span className="git-ab">↓{git.behind}</span>}
          </span>
        )}
        {cursor && (
          <span
            className="seg btn"
            title="Go to Line/Column (Ctrl/Cmd+G)"
            onClick={() => gotoLine(getEditor(useStore.getState().activeGroupId))}
          >
            {cursor.line}:{cursor.col}
          </span>
        )}
        {activePath && <span className="seg" title="Indentation">Spaces: 2</span>}
        {activePath && <span className="seg">UTF-8</span>}
        {activePath && <span className="seg" title="Line endings">{eol}</span>}
        {activePath && <span className="seg">{langLabel(activePath)}</span>}
        {terminalShell && <span className="seg" title="Terminal shell">{terminalShell.split('/').pop()}</span>}
        <span className={'seg' + (auth.hasAuth ? ' ok' : '')} title={authTitle}>
          <IconAI size={13} />
          {authLabel}
        </span>
      </div>
    </div>
  );
}
