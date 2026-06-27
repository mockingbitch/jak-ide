import { useEffect, useState } from 'react';
import { useStore } from '../store';
import {
  gitBranches,
  gitCheckout,
  gitCheckoutRemote,
  gitCreateBranch,
  gitDeleteBranch,
  gitRenameBranch,
  gitMerge,
  gitFetch,
  gitPull,
} from '../api';
import type { GitBranches } from '../types';
import { IconCheck, IconPlus, IconBranch, IconTrash, IconRefresh, IconArrowDown, IconPencil } from './icons';

/** PhpStorm-style branch management popup (content only — parent positions it). */
export function BranchMenu({ onClose }: { onClose: () => void }) {
  const bump = useStore((s) => s.bumpGitRefresh);
  const [data, setData] = useState<GitBranches | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try {
      setData(await gitBranches());
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  useEffect(() => {
    load();
  }, []);

  // Run an action; `closeAfter` for ops that switch the working branch.
  // Refresh on BOTH success and failure — a failing merge/pull/checkout may have
  // partially applied (conflicts, blocked switch), so the app must re-sync.
  const run = async (fn: () => Promise<unknown>, closeAfter = false) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    let ok = false;
    try {
      await fn();
      ok = true;
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      bump();
      if (ok && closeAfter) onClose();
      else await load();
      setBusy(false);
    }
  };

  const newBranch = (from?: string) => {
    const name = prompt(from ? `New branch from "${from}":` : 'New branch name:');
    if (name && name.trim()) run(() => gitCreateBranch(name.trim(), true, from), true);
  };
  const rename = (old: string) => {
    const name = prompt(`Rename branch "${old}" to:`, old);
    if (name && name.trim() && name.trim() !== old) run(() => gitRenameBranch(old, name.trim()));
  };
  const del = (name: string) => {
    if (!confirm(`Delete branch "${name}"?`)) return;
    run(async () => {
      try {
        await gitDeleteBranch(name, false); // safe delete (refuses if unmerged)
      } catch (e) {
        if (
          /not fully merged/i.test((e as Error).message) &&
          confirm(`Branch "${name}" is not fully merged. Force delete and lose its unmerged commits?`)
        ) {
          await gitDeleteBranch(name, true);
        } else {
          throw e; // surface any other error instead of force-deleting
        }
      }
    });
  };
  const checkoutRemote = (remote: string) => {
    const local = remote.replace(/^[^/]+\//, '');
    // Reuse an existing local branch only if it actually tracks THIS remote ref.
    const match = data?.local.find((b) => b.name === local && b.upstream === remote);
    run(() => (match ? gitCheckout(local) : gitCheckoutRemote(remote)), true);
  };

  return (
    <div className="branch-menu" role="menu">
      <div className="branch-menu-actions">
        <button className="link" disabled={busy} onClick={() => run(gitFetch)}>
          <IconRefresh size={13} /> Fetch
        </button>
        <button className="link" disabled={busy} onClick={() => run(gitPull)}>
          <IconArrowDown size={13} /> Update (Pull)
        </button>
      </div>
      <button className="branch-menu-item new" disabled={busy} onClick={() => newBranch()}>
        <IconPlus size={15} />
        <span>New Branch…</span>
      </button>
      {err && <div className="git-error">{err}</div>}

      <div className="branch-menu-label">Local</div>
      {data?.local.map((b) => (
        <div key={b.name} className={'branch-row' + (b.current ? ' current' : '')}>
          <button
            className="branch-pick"
            disabled={busy}
            title={b.name}
            onClick={() => (b.current ? onClose() : run(() => gitCheckout(b.name), true))}
          >
            <span className="branch-check">{b.current ? <IconCheck size={13} /> : null}</span>
            <span className="branch-name">{b.name}</span>
          </button>
          <span className="branch-row-actions">
            <button className="icon-btn xs" title="New branch from here" disabled={busy} onClick={() => newBranch(b.name)}>
              <IconPlus size={13} />
            </button>
            {!b.current && (
              <button className="icon-btn xs" title={`Merge "${b.name}" into current`} disabled={busy} onClick={() => run(() => gitMerge(b.name))}>
                <IconBranch size={13} />
              </button>
            )}
            <button className="icon-btn xs" title="Rename" disabled={busy} onClick={() => rename(b.name)}>
              <IconPencil size={13} />
            </button>
            {!b.current && (
              <button className="icon-btn xs danger" title="Delete" disabled={busy} onClick={() => del(b.name)}>
                <IconTrash size={13} />
              </button>
            )}
          </span>
        </div>
      ))}

      {data && data.remote.length > 0 && (
        <>
          <div className="branch-menu-label">Remote</div>
          {data.remote.map((r) => (
            <div key={r} className="branch-row">
              <button className="branch-pick" disabled={busy} title={`Checkout ${r}`} onClick={() => checkoutRemote(r)}>
                <span className="branch-check" />
                <span className="branch-name">{r}</span>
              </button>
              <span className="branch-row-actions">
                <button className="icon-btn xs" title={`Merge "${r}" into current`} disabled={busy} onClick={() => run(() => gitMerge(r))}>
                  <IconBranch size={13} />
                </button>
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
