import { useMemo, useState } from 'react';
import { diffSegments, assembleResolution, type SidePick } from '../lib/lineMerge';
import { IconClose, IconCheck } from './icons';

const show = (lines: string[]) => (lines.length ? lines.join('\n') : '∅ (nothing)');

/** PhpStorm-style line-by-line resolver for ONE conflict: diffs ours↔theirs and
 *  lets you toggle each side of every changed region independently, then Apply the
 *  assembled result. Common (context) lines are always kept. */
export function ConflictLineResolver({
  ours,
  theirs,
  onApply,
  onClose,
}: {
  ours: string[];
  theirs: string[];
  onApply: (lines: string[]) => void;
  onClose: () => void;
}) {
  const segs = useMemo(() => diffSegments(ours, theirs), [ours, theirs]);
  const changeCount = useMemo(() => segs.filter((s) => s.kind === 'change').length, [segs]);
  // Default: keep ours for each changed region (a valid starting result).
  const [picks, setPicks] = useState<SidePick[]>(() =>
    Array.from({ length: changeCount }, () => ({ ours: true, theirs: false }))
  );

  const setPick = (k: number, side: 'ours' | 'theirs', on: boolean) =>
    setPicks((p) => p.map((x, i) => (i === k ? { ...x, [side]: on } : x)));
  const setAll = (pick: SidePick) => setPicks(() => Array.from({ length: changeCount }, () => ({ ...pick })));

  let k = -1;
  return (
    <div className="clr">
      <div className="clr-head">
        <span className="clr-title">Line-by-line — toggle each side to include it in the result</span>
        <span className="clr-actions">
          <button onClick={() => setAll({ ours: true, theirs: false })}>All ours</button>
          <button onClick={() => setAll({ ours: false, theirs: true })}>All theirs</button>
          <button onClick={() => setAll({ ours: true, theirs: true })}>All both</button>
          <span className="merge-sep" />
          <button className="primary" onClick={() => onApply(assembleResolution(segs, picks))}>
            <IconCheck size={12} /> Apply to result
          </button>
          <button className="icon-btn" title="Close" onClick={onClose}>
            <IconClose size={15} />
          </button>
        </span>
      </div>
      <div className="clr-body">
        {segs.map((s, i) => {
          if (s.kind === 'common') {
            return (
              <pre className="clr-common" key={i}>
                {show(s.lines)}
              </pre>
            );
          }
          k += 1;
          const ck = k;
          const p = picks[ck] ?? { ours: true, theirs: false };
          return (
            <div className="clr-change" key={i}>
              <button
                type="button"
                className={'clr-side ours' + (p.ours ? ' on' : '')}
                onClick={() => setPick(ck, 'ours', !p.ours)}
                title="Toggle ours (local)"
              >
                <span className="clr-side-tag">{p.ours ? '✓ ours' : 'ours'}</span>
                <pre>{show(s.ours)}</pre>
              </button>
              <button
                type="button"
                className={'clr-side theirs' + (p.theirs ? ' on' : '')}
                onClick={() => setPick(ck, 'theirs', !p.theirs)}
                title="Toggle theirs (incoming)"
              >
                <span className="clr-side-tag">{p.theirs ? '✓ theirs' : 'theirs'}</span>
                <pre>{show(s.theirs)}</pre>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
