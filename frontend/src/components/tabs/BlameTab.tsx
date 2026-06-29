import { useStore } from '../../store';
import { basename } from '../../lib/lang';
import { IconClose } from '../icons';
import type { BlameTab as BlameTabType } from '../../types';

/** git blame / annotate view for one file. */
export function BlameTab({ tab, groupId }: { tab: BlameTabType; groupId: string }) {
  const closeTab = useStore((s) => s.closeTab);
  return (
    <>
      <div className="git-diff-bar">
        <span>
          Annotate — <b>{basename(tab.path)}</b>
        </span>
        <button className="icon-btn" title="Close" onClick={() => closeTab(tab.id, groupId)}>
          <IconClose size={15} />
        </button>
      </div>
      <div className="blame-view">
        {tab.lines.map((ln, i) => (
          <div className="blame-line" key={i} title={`${ln.short} · ${ln.author} · ${ln.summary}`}>
            <span className="blame-ann">
              <span className="blame-hash">{ln.short}</span>
              <span className="blame-author">{ln.author}</span>
              <span className="blame-date">{ln.date ? new Date(ln.date).toLocaleDateString() : ''}</span>
            </span>
            <span className="blame-num">{ln.line}</span>
            <span className="blame-code">{ln.code || ' '}</span>
          </div>
        ))}
        {tab.lines.length === 0 && <div className="editor-empty">No blame data.</div>}
      </div>
    </>
  );
}
