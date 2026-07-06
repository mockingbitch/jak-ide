import { IconCheck, IconChevronDown, IconClose } from '../icons';

export interface MergeToolbarProps {
  fileName: string;
  total: number;
  resolved: number;
  idx: number;
  count: number; // remaining conflicts
  dirty: boolean;
  busy: boolean;
  showBase: boolean;
  baseAvailable: boolean;
  showWhitespace: boolean;
  syncScroll: boolean;
  onPrev: () => void;
  onNext: () => void;
  onOurs: () => void;
  onTheirs: () => void;
  onBoth: () => void;
  onResolved: () => void;
  onByLine: () => void;
  byLineActive: boolean;
  onSave: () => void;
  onClose: () => void;
  onToggleBase: () => void;
  onToggleWhitespace: () => void;
  onToggleSync: () => void;
}

/** Top toolbar for the merge view: file + counts, prev/next, accept actions,
 *  toggles, save/close. Purely presentational — all logic lives in the view. */
export function MergeToolbar(p: MergeToolbarProps) {
  const done = p.count === 0;
  return (
    <div className="merge-modal-head merge-toolbar">
      <span className="merge-modal-title">
        Merge — <b>{p.fileName}</b>
        {p.dirty && <span className="merge-dirty" title="Unsaved changes">●</span>}
        <span className={'merge-count' + (done ? ' done' : '')}>
          {done ? (
            <>
              <IconCheck size={13} /> {p.total} resolved
            </>
          ) : (
            `Conflict ${p.idx + 1} of ${p.count} · ${p.resolved}/${p.total} resolved`
          )}
        </span>
      </span>

      <span className="merge-nav">
        <button className="icon-btn merge-nav-prev" title="Previous conflict (Shift+F7)" disabled={done} onClick={p.onPrev}>
          <IconChevronDown size={15} />
        </button>
        <button className="icon-btn" title="Next conflict (F7)" disabled={done} onClick={p.onNext}>
          <IconChevronDown size={15} />
        </button>
      </span>

      <span className="merge-modal-actions">
        <button disabled={done} title="Accept ours (Alt+O)" onClick={p.onOurs}>
          Accept Ours
        </button>
        <button disabled={done} title="Accept theirs (Alt+T)" onClick={p.onTheirs}>
          Accept Theirs
        </button>
        <button disabled={done} title="Accept both, ours first (Alt+B)" onClick={p.onBoth}>
          Both
        </button>
        <button disabled={done} title="Strip conflict markers, keep content (Alt+R)" onClick={p.onResolved}>
          Mark Resolved
        </button>
        <button className={p.byLineActive ? 'active' : ''} disabled={done} title="Resolve the current conflict line by line" onClick={p.onByLine}>
          By line…
        </button>
        <span className="merge-sep" />
        <span className="merge-toggles">
          <button
            className={p.showBase ? 'active' : ''}
            disabled={!p.baseAvailable}
            title={p.baseAvailable ? 'Show the Base (original) pane' : 'Base pane needs diff3 conflict style'}
            onClick={p.onToggleBase}
          >
            Base
          </button>
          <button className={p.showWhitespace ? 'active' : ''} title="Show whitespace" onClick={p.onToggleWhitespace}>
            WS
          </button>
          <button className={p.syncScroll ? 'active' : ''} title="Synchronise scrolling" onClick={p.onToggleSync}>
            Sync
          </button>
        </span>
        <span className="merge-sep" />
        <button className="primary" disabled={p.busy} title="Save merged result (Ctrl/Cmd+S)" onClick={p.onSave}>
          <IconCheck size={13} /> Save
        </button>
        <button className="icon-btn" title="Close" onClick={p.onClose}>
          <IconClose size={16} />
        </button>
      </span>
    </div>
  );
}
