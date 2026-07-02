import { FileIcon } from './FileIcon';
import { IconChevronRight, IconChevronDown, IconClose } from './icons';
import { hitKey, type FileGroup } from '../lib/findGroup';
import type { TextHit } from '../api';

const baseOf = (p: string) => p.split('/').pop() ?? p;
const dirOf = (p: string) => {
  const i = p.lastIndexOf('/');
  return i > 0 ? p.slice(0, i) : '';
};

/** A single result line with the matched span highlighted. */
function HitLine({ hit, active, onOpen }: { hit: TextHit; active?: boolean; onOpen: () => void }) {
  const { text, matchStart, matchEnd } = hit;
  const hasSpan = matchEnd > matchStart && matchEnd <= text.length;
  return (
    <div className={'find-hit' + (active ? ' active' : '')} onClick={onOpen} title={`Line ${hit.line}`}>
      <span className="find-hit-line">{hit.line}</span>
      <span className="find-hit-text">
        {hasSpan ? (
          <>
            {text.slice(0, matchStart)}
            <mark>{text.slice(matchStart, matchEnd)}</mark>
            {text.slice(matchEnd)}
          </>
        ) : (
          text
        )}
      </span>
    </div>
  );
}

export function FindResults({
  groups,
  collapsed,
  onToggle,
  onDismiss,
  onOpen,
  activeKey,
}: {
  groups: readonly FileGroup[];
  collapsed: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onDismiss: (path: string) => void;
  onOpen: (path: string, line: number, col: number) => void;
  /** hitKey() of the keyboard-focused hit (modal only); undefined in the docked panel. */
  activeKey?: string;
}) {
  return (
    <div className="find-results">
      {groups.map((g) => {
        const isCollapsed = collapsed.has(g.path);
        return (
          <div className="find-group" key={g.path}>
            <div className="find-group-head" onClick={() => onToggle(g.path)}>
              <span className="find-chevron">{isCollapsed ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}</span>
              <FileIcon name={baseOf(g.path)} />
              <span className="find-group-name">{baseOf(g.path)}</span>
              <span className="find-group-dir">{dirOf(g.path)}</span>
              <span className="find-group-count">{g.hits.length}</span>
              <button
                className="find-dismiss"
                title="Dismiss this file"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss(g.path);
                }}
              >
                <IconClose size={13} />
              </button>
            </div>
            {!isCollapsed &&
              g.hits.map((h, i) => (
                <HitLine
                  key={`${h.line}:${h.col}:${i}`}
                  hit={h}
                  active={activeKey === hitKey(g.path, i)}
                  onOpen={() => onOpen(g.path, h.line, h.col)}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}
