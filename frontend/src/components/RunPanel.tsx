import { useEffect, useRef } from 'react';
import { useRunStore } from '../lib/runStore';
import { startRun, stopRun } from '../lib/runnerService';
import { IconRun, IconStop, IconPlus, IconTrash } from './icons';

/** Run tool window (U14/U15): a command input + saved configs that runs the command
 *  and streams its output via /ws/run (runnerService). */
export function RunPanel() {
  const configs = useRunStore((s) => s.configs);
  const draft = useRunStore((s) => s.draft);
  const output = useRunStore((s) => s.output);
  const running = useRunStore((s) => s.running);
  const exitCode = useRunStore((s) => s.exitCode);
  const interrupted = useRunStore((s) => s.interrupted);
  const lastCommand = useRunStore((s) => s.lastCommand);
  const setDraft = useRunStore((s) => s.setDraft);
  const saveConfig = useRunStore((s) => s.saveConfig);
  const removeConfig = useRunStore((s) => s.removeConfig);
  const loadConfig = useRunStore((s) => s.loadConfig);
  const clearOutput = useRunStore((s) => s.clearOutput);

  const outRef = useRef<HTMLPreElement>(null);
  // Auto-scroll to the newest output.
  useEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  const canRun = draft.trim().length > 0;
  const run = () => canRun && startRun(draft);
  const save = () => {
    if (!canRun) return;
    const name = prompt('Save run configuration as:', '');
    if (name) saveConfig(name);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !running) {
      e.preventDefault();
      run();
    }
  };

  const status = running ? (
    <span className="run-running">● Running: {lastCommand}</span>
  ) : interrupted ? (
    <span className="run-fail">⚠ Connection lost{lastCommand ? ` · ${lastCommand}` : ''}</span>
  ) : exitCode != null ? (
    <span className={exitCode === 0 ? 'run-ok' : 'run-fail'}>
      {exitCode === 0 ? '✓ Done' : exitCode < 0 ? '■ Stopped' : `✗ Exited with code ${exitCode}`}
      {lastCommand ? ` · ${lastCommand}` : ''}
    </span>
  ) : null;

  return (
    <div className="run-panel">
      <div className="tw-header">
        <span className="tw-title">Run</span>
        <div className="tw-actions">
          <button className="icon-btn" title="Clear output" onClick={clearOutput}>
            <IconTrash size={15} />
          </button>
        </div>
      </div>

      <div className="run-input-row">
        <input
          className="run-input"
          placeholder="Command to run (e.g. npm test, cargo build)"
          value={draft}
          spellCheck={false}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {running ? (
          <button className="run-btn stop" onClick={stopRun} title="Stop">
            <IconStop size={13} /> Stop
          </button>
        ) : (
          <button className="run-btn" onClick={run} disabled={!canRun} title="Run (Enter)">
            <IconRun size={13} /> Run
          </button>
        )}
        <button className="icon-btn" title="Save as configuration" onClick={save} disabled={!canRun}>
          <IconPlus size={16} />
        </button>
      </div>

      {configs.length > 0 && (
        <div className="run-configs">
          {configs.map((c) => (
            <span key={c.id} className="run-chip" title={c.command} onClick={() => loadConfig(c.id)}>
              {c.name}
              <button
                className="run-chip-x"
                title="Delete configuration"
                onClick={(e) => {
                  e.stopPropagation();
                  removeConfig(c.id);
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <pre className="run-output" ref={outRef}>
        {output || (running ? '' : 'Run a command to see its output here.')}
      </pre>

      <div className="run-status">{status}</div>
    </div>
  );
}
