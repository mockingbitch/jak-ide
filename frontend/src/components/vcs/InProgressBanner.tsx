import { useState } from 'react';
import type { GitOperationState } from '../../api';
import {
  gitMergeAbort,
  gitMergeContinue,
  gitRebaseAbort,
  gitRebaseContinue,
  gitCherryPickAbort,
  gitCherryPickContinue,
  gitRevertAbort,
  gitRevertContinue,
} from '../../api';
import { toast } from '../../lib/toastStore';

type Op = 'rebase' | 'merge' | 'cherry-pick' | 'revert';

const TITLE: Record<Op, string> = {
  rebase: 'Rebase in progress',
  merge: 'Merge in progress',
  'cherry-pick': 'Cherry-pick in progress',
  revert: 'Revert in progress',
};

const NOUN: Record<Op, string> = {
  rebase: 'Rebase',
  merge: 'Merge',
  'cherry-pick': 'Cherry-pick',
  revert: 'Revert',
};

/** Each op maps to its OWN git abort/continue (never another op's — that would
 *  corrupt the operation). Merge has no `--continue` abort/continue pair in older
 *  git but modern git supports `git merge --continue`. */
const CONTROLS: Record<Op, { abort: () => Promise<unknown>; cont: () => Promise<unknown> }> = {
  rebase: { abort: gitRebaseAbort, cont: gitRebaseContinue },
  merge: { abort: gitMergeAbort, cont: gitMergeContinue },
  'cherry-pick': { abort: gitCherryPickAbort, cont: gitCherryPickContinue },
  revert: { abort: gitRevertAbort, cont: gitRevertContinue },
};

function pickOp(state: GitOperationState): Op | null {
  if (state.rebasing) return 'rebase';
  if (state.merging) return 'merge';
  if (state.cherryPicking) return 'cherry-pick';
  if (state.reverting) return 'revert';
  return null;
}

/** Thin banner pinned to the top of the git panel while a merge/rebase/cherry-pick/
 *  revert is mid-flight. Renders nothing when the working tree is clean of ops. */
export function InProgressBanner({ state, onDone }: { state: GitOperationState; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const op = pickOp(state);
  if (!op) return null;

  const controls = CONTROLS[op];

  const run = async (action: () => Promise<unknown>, done: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      toast('success', done);
      onDone();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`vcs-inprogress vcs-inprogress-${op}`}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: '#5a3a12', color: '#f0d9a0' }}
      role="status"
    >
      <span className="vcs-inprogress-label" style={{ flex: 1, fontWeight: 600 }}>
        {TITLE[op]} <span className="vcs-inprogress-note" style={{ opacity: 0.75, fontWeight: 400 }}>— resolve conflicts, then Continue</span>
      </span>
      <span className="vcs-inprogress-actions" style={{ display: 'flex', gap: 6 }}>
        <button className="danger" onClick={() => run(controls.abort, `${NOUN[op]} aborted`)} disabled={busy}>
          Abort
        </button>
        <button className="primary" onClick={() => run(controls.cont, `${NOUN[op]} continued`)} disabled={busy}>
          Continue
        </button>
      </span>
    </div>
  );
}
