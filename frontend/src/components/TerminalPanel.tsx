import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { TerminalInstance } from './TerminalInstance';
import { IconPlus, IconClose } from './icons';

export function TerminalPanel() {
  const terminals = useStore((s) => s.terminals);
  const activeId = useStore((s) => s.activeTerminalId);
  const shells = useStore((s) => s.shells);
  const defaultShell = useStore((s) => s.terminalShell);
  const addTerminal = useStore((s) => s.addTerminal);
  const addTerminalIfNone = useStore((s) => s.addTerminalIfNone);
  const closeTerminal = useStore((s) => s.closeTerminal);
  const setActiveTerminal = useStore((s) => s.setActiveTerminal);

  const [newShell, setNewShell] = useState('');
  const shellForNew = newShell || defaultShell || shells[0]?.path || '';

  // Open one terminal automatically once shells are known. addTerminalIfNone reads
  // live state inside set(), so StrictMode's double-effect can't create two.
  useEffect(() => {
    if (shellForNew) addTerminalIfNone(shellForNew);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminals.length, shellForNew]);

  return (
    <div className="terminal-panel">
      <div className="tw-header">
        <span className="tw-title">Terminal</span>
        <div className="term-tabs">
          {terminals.map((t) => (
            <div
              key={t.id}
              className={'term-tab' + (t.id === activeId ? ' active' : '')}
              onClick={() => setActiveTerminal(t.id)}
              title={t.shellPath}
            >
              <span className="term-tab-name">{t.title}</span>
              <button
                type="button"
                className="tab-close"
                aria-label={`Close terminal ${t.title}`}
                title="Close terminal"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTerminal(t.id);
                }}
              >
                <IconClose size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="tw-actions">
          <select
            className="shell-select"
            value={shellForNew}
            onChange={(e) => setNewShell(e.target.value)}
            title="Shell for new terminals"
          >
            {shells.length === 0 && <option value="">(loading…)</option>}
            {shells.map((s) => (
              <option key={s.path} value={s.path}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            className="icon-btn"
            title="New terminal"
            onClick={() => shellForNew && addTerminal(shellForNew)}
          >
            <IconPlus size={16} />
          </button>
        </div>
      </div>
      <div className="term-body">
        {terminals.map((t) => (
          <TerminalInstance key={t.id} shellPath={t.shellPath} visible={t.id === activeId} />
        ))}
        {terminals.length === 0 && <div className="hint">Starting terminal…</div>}
      </div>
    </div>
  );
}
