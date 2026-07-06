import { useEffect } from 'react';

/** Keyboard handlers for the merge view. Ctrl/Cmd+Z/redo stay native to the
 *  Result editor and are intentionally NOT bound here. */
export interface MergeShortcutHandlers {
  next: () => void;
  prev: () => void;
  acceptOurs: () => void;
  acceptTheirs: () => void;
  acceptBoth: () => void;
  markResolved: () => void;
  focusResult: () => void;
  save: () => void;
}

/** The minimal key state a shortcut decision depends on (a subset of KeyboardEvent). */
export interface KeyState {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

/** Map a key event to a handler name. `owned` shortcuts are consumed
 *  (preventDefault + stopPropagation); `focusResult` (Escape) is left to bubble
 *  so Monaco's own Escape handling still runs. Pure → unit-testable. */
export function resolveMergeShortcut(e: KeyState): { action: keyof MergeShortcutHandlers; owned: boolean } | null {
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (e.key === 'F7') return { action: e.shiftKey ? 'prev' : 'next', owned: true };
  if (e.altKey && k === 'o') return { action: 'acceptOurs', owned: true };
  if (e.altKey && k === 't') return { action: 'acceptTheirs', owned: true };
  if (e.altKey && k === 'b') return { action: 'acceptBoth', owned: true };
  if (e.altKey && k === 'r') return { action: 'markResolved', owned: true };
  if (mod && k === 's') return { action: 'save', owned: true };
  if (e.key === 'Escape') return { action: 'focusResult', owned: false };
  return null;
}

/** Bind merge shortcuts on `window` while `enabled`. Owned keys stop propagating
 *  so they never reach JakIDE's global shortcut layer (App.tsx). */
export function useMergeShortcuts(enabled: boolean, h: MergeShortcutHandlers): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const m = resolveMergeShortcut(e);
      if (!m) return;
      if (m.owned) {
        e.preventDefault();
        e.stopPropagation();
      }
      h[m.action]();
    };
    // Capture phase so owned keys are intercepted before App's window listener.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [enabled, h]);
}
