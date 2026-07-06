import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useStore } from '../../store';
import { saveFile, gitStage } from '../../api';
import { toast } from '../../lib/toastStore';
import { defineJakIDETheme } from '../../lib/monacoTheme';
import { LINE_NUMBERS_MIN_CHARS, OVERFLOW_WIDGETS_OPTIONS } from '../../lib/monacoSetup';
import { langFor, basename } from '../../lib/lang';
import type { MergeSession } from '../../types';
import { buildMergeModel } from '../../lib/merge/mergeAlignment';
import { applyResolution, hasUnresolvedConflicts, nextConflictIndex, resolutionLines } from '../../lib/merge/mergeActions';
import type { HunkAction, MergeHunk, MergeModel, MergeSide } from '../../lib/merge/mergeTypes';
import { resultDecorations, sideDecorations } from './mergeDecorations';
import { useMergeShortcuts } from './useMergeShortcuts';
import { MergeToolbar } from './MergeToolbar';
import { ConflictLineResolver } from '../ConflictLineResolver';
import { IconCheck } from '../icons';

type EdMap = Partial<Record<MergeSide, editor.IStandaloneCodeEditor>>;
const isMarker = (l: string) =>
  l.startsWith('<<<<<<<') || l.startsWith('|||||||') || l.startsWith('=======') || l.startsWith('>>>>>>>');

/** PhpStorm-style 3-way merge: Ours │ (Base) │ Result (editable) │ Theirs, with
 *  aligned panes (Monaco view zones), synced scroll, F7 navigation, and
 *  per-conflict accept from the toolbar, gutter arrows, context menu, or keys. */
export function MergeConflictView({ session }: { session: MergeSession }) {
  const theme = useStore((s) => s.theme);
  const setResult = useStore((s) => s.setMergeModalResult);
  const close = useStore((s) => s.closeMergeModal);
  const bumpGitRefresh = useStore((s) => s.bumpGitRefresh);
  const refreshTab = useStore((s) => s.refreshTab);

  const monacoRef = useRef<Monaco | null>(null);
  const eds = useRef<EdMap>({});
  const decos = useRef<Partial<Record<MergeSide, editor.IEditorDecorationsCollection>>>({});
  const zoneIds = useRef<Partial<Record<MergeSide, string[]>>>({});
  const syncing = useRef(false);
  const reparseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [model, setModel] = useState<MergeModel>(() => buildMergeModel(session.result));
  const [currentIdx, setCurrentIdx] = useState(0);
  const [showBase, setShowBase] = useState(false);
  const [showWhitespace, setShowWhitespace] = useState(false);
  const [syncScroll, setSyncScroll] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [lineOpen, setLineOpen] = useState(false); // line-by-line resolver drawer
  // Bumped on every (re)mount of any pane — @monaco-editor/react creates editors
  // asynchronously, so panes (esp. Base on first toggle) mount AFTER the align/
  // decoration effects run; this dep re-runs them once the new editor exists.
  const [mountSeq, setMountSeq] = useState(0);

  const originalCount = useRef(buildMergeModel(session.result).conflictHunks.length);
  const idx = Math.min(currentIdx, Math.max(0, model.conflictHunks.length - 1));
  const currentId = model.conflictHunks[idx]?.id ?? null;
  const baseAvailable = model.hasBase;
  const activePanes: MergeSide[] = showBase && baseAvailable ? ['ours', 'base', 'result', 'theirs'] : ['ours', 'result', 'theirs'];

  // Callbacks registered once at mount (glyph clicks, context-menu actions) must
  // see the LATEST model/index, not the ones captured at mount — read via refs.
  const modelRef = useRef(model);
  modelRef.current = model;
  const idxRef = useRef(idx);
  idxRef.current = idx;
  const syncRef = useRef(syncScroll);
  syncRef.current = syncScroll;
  const panesRef = useRef<MergeSide[]>(activePanes);
  panesRef.current = activePanes;

  const reparse = useCallback(() => {
    const ed = eds.current.result;
    if (!ed) return;
    setModel(buildMergeModel(ed.getValue()));
  }, []);

  // Recompute + persist after any programmatic edit to the Result editor.
  const commitResultEdit = useCallback(() => {
    const ed = eds.current.result;
    if (!ed) return;
    const text = ed.getValue();
    setResult(text);
    setDirty(true);
    setModel(buildMergeModel(text));
  }, [setResult]);

  // --- apply a resolution to a specific conflict via an (undoable) editor edit -
  // Uses applyResolution (a whole-line splice — the unit-tested path) to compute
  // the new buffer, then replaces the full model range in ONE undoable edit. This
  // deletes whole lines cleanly even when a side is empty (add/delete conflicts),
  // avoiding the stray blank line a character-range edit would leave behind.
  const applyToHunk = useCallback(
    (hunk: MergeHunk | undefined, lines: string[]) => {
      const ed = eds.current.result;
      const monaco = monacoRef.current;
      if (!ed || !monaco || !hunk) return;
      const m = ed.getModel();
      if (!m) return;
      const next = applyResolution(ed.getValue(), hunk, lines);
      ed.pushUndoStop();
      ed.executeEdits('merge', [{ range: m.getFullModelRange(), text: next, forceMoveMarkers: true }]);
      ed.pushUndoStop();
      commitResultEdit();
    },
    [commitResultEdit]
  );

  // Stable identities (read live model/idx from refs) so mount-time closures and
  // effects never go stale after an edit re-parses the model.
  const accept = useCallback(
    (action: HunkAction, hunk?: MergeHunk) => {
      const h = hunk ?? modelRef.current.conflictHunks[idxRef.current];
      if (h) applyToHunk(h, resolutionLines(h, action));
    },
    [applyToHunk]
  );
  const markResolved = useCallback(
    (hunk?: MergeHunk) => {
      const h = hunk ?? modelRef.current.conflictHunks[idxRef.current];
      if (h) applyToHunk(h, h.resultLines.filter((l) => !isMarker(l)));
    },
    [applyToHunk]
  );

  // Stable; reads live sync toggle + active panes from refs (the scroll listener
  // is registered once at mount and must not capture stale state).
  const syncScrollFrom = useCallback((from: MergeSide) => {
    if (!syncRef.current) return;
    const src = eds.current[from];
    if (!src || syncing.current) return;
    syncing.current = true;
    const top = src.getScrollTop();
    for (const s of panesRef.current) {
      if (s !== from) eds.current[s]?.setScrollTop(top);
    }
    requestAnimationFrame(() => (syncing.current = false));
  }, []);

  const revealConflict = useCallback(
    (i: number) => {
      const c = modelRef.current.conflictHunks[i];
      const ed = eds.current.result;
      if (!c || !ed) return;
      ed.revealLineInCenter(c.resultRange.startLine);
      ed.setPosition({ lineNumber: c.resultRange.startLine, column: 1 });
      syncScrollFrom('result');
    },
    [syncScrollFrom]
  );

  const go = useCallback(
    (delta: number) => {
      const n = modelRef.current.conflictHunks.length;
      if (n === 0) return;
      const next = nextConflictIndex(idxRef.current, delta, n);
      setCurrentIdx(next);
      revealConflict(next);
    },
    [revealConflict]
  );

  const save = useCallback(async () => {
    const ed = eds.current.result;
    if (!ed || busy) return;
    const text = ed.getValue();
    if (hasUnresolvedConflicts(text) && !confirm('File vẫn còn conflict chưa xử lý. Bạn có muốn lưu không?')) return;
    setBusy(true);
    try {
      await saveFile(session.path, text);
      await gitStage([session.path]);
      refreshTab(session.path, text);
      bumpGitRefresh();
      toast('success', `Merged ${basename(session.path)} saved & staged`);
      close();
    } catch (e) {
      toast('error', (e as Error).message);
      setBusy(false);
    }
  }, [busy, session.path, refreshTab, bumpGitRefresh, close]);

  useMergeShortcuts(true, {
    next: () => go(1),
    prev: () => go(-1),
    acceptOurs: () => accept('ours'),
    acceptTheirs: () => accept('theirs'),
    acceptBoth: () => accept('both'),
    markResolved: () => markResolved(),
    focusResult: () => eds.current.result?.focus(),
    save,
  });

  // --- view zones (spacers) + decorations, recomputed when the model changes ---
  useEffect(() => {
    if (!ready) return;
    for (const side of ['ours', 'theirs', 'base', 'result'] as const) {
      const ed = eds.current[side];
      if (!ed) continue;
      ed.changeViewZones((acc) => {
        (zoneIds.current[side] ?? []).forEach((id) => acc.removeZone(id));
        const ids: string[] = [];
        for (const z of model.spacers[side]) {
          const dom = document.createElement('div');
          dom.className = 'merge-spacer';
          ids.push(acc.addZone({ afterLineNumber: z.afterLine, heightInLines: z.heightInLines, domNode: dom }));
        }
        zoneIds.current[side] = ids;
      });
    }
  }, [model, ready, showBase, mountSeq]);

  useEffect(() => {
    if (!ready) return;
    const set = (side: MergeSide, list: editor.IModelDeltaDecoration[]) => {
      const ed = eds.current[side];
      if (!ed) return;
      (decos.current[side] ??= ed.createDecorationsCollection()).set(list);
    };
    set('result', resultDecorations(model, currentId));
    set('ours', sideDecorations(model, 'ours', currentId));
    set('theirs', sideDecorations(model, 'theirs', currentId));
    if (activePanes.includes('base')) set('base', sideDecorations(model, 'base', currentId));
  }, [model, currentId, ready, showBase, mountSeq]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      if (reparseTimer.current) clearTimeout(reparseTimer.current);
    },
    []
  );

  const mountPane = (side: MergeSide) => (ed: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    monacoRef.current = monaco;
    eds.current[side] = ed;
    // Drop any decorations collection / zone ids from a PRIOR mount of this side
    // (e.g. toggling Base off then on) — they were bound to the now-disposed
    // editor and would silently no-op. The mountSeq bump re-runs the effects,
    // which rebuild the collection + zones against this fresh editor.
    decos.current[side] = undefined;
    zoneIds.current[side] = [];
    monaco.editor.setTheme('jakide');
    ed.onDidScrollChange(() => syncScrollFrom(side));
    if (side === 'ours' || side === 'theirs') {
      ed.onMouseDown((e) => {
        if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
        const line = e.target.position?.lineNumber;
        if (line == null) return;
        const hunk = modelRef.current.conflictHunks.find(
          (h) => (side === 'ours' ? h.oursRange : h.theirsRange).startLine === line
        );
        if (hunk) accept(side === 'ours' ? 'ours' : 'theirs', hunk);
      });
    }
    if (side === 'result') {
      eds.current.result = ed;
      setReady(true);
      registerResultActions(ed, monaco);
      const first = modelRef.current.conflictHunks[0];
      if (first) setTimeout(() => ed.revealLineInCenter(first.resultRange.startLine), 0);
    }
    // Re-run the align/decoration effects now that this pane's editor exists.
    setMountSeq((s) => s + 1);
  };

  const registerResultActions = (ed: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    const hunkAtCursor = () => {
      const line = ed.getPosition()?.lineNumber ?? 0;
      return modelRef.current.conflictHunks.find((h) => line >= h.resultRange.startLine && line <= h.resultRange.endLine);
    };
    const add = (id: string, label: string, order: number, run: () => void) =>
      ed.addAction({ id, label, contextMenuGroupId: 'merge', contextMenuOrder: order, run });
    add('merge.ours', 'Accept Ours', 1, () => accept('ours', hunkAtCursor()));
    add('merge.theirs', 'Accept Theirs', 2, () => accept('theirs', hunkAtCursor()));
    add('merge.both', 'Accept Both', 3, () => accept('both', hunkAtCursor()));
    add('merge.resolved', 'Mark Resolved (strip markers)', 4, () => markResolved(hunkAtCursor()));
    add('merge.next', 'Go to Next Conflict', 5, () => go(1));
    ed.addCommand(monaco.KeyCode.F7, () => go(1));
  };

  const resolved = originalCount.current - model.unresolvedCount;
  const langId = useMemo(() => langFor(session.path), [session.path]);

  const paneMeta: Record<MergeSide, { label: string; cls: string }> = {
    ours: { label: 'Ours (Local)', cls: 'ours' },
    base: { label: 'Base (Original)', cls: 'base' },
    result: { label: 'Result — merged output', cls: 'result' },
    theirs: { label: 'Theirs (Incoming)', cls: 'theirs' },
  };
  const valueFor: Record<MergeSide, string> = {
    ours: model.oursText,
    base: model.baseText,
    result: session.result,
    theirs: model.theirsText,
  };

  return (
    <div className="merge-modal-overlay">
      <div className="merge-modal merge-3way">
        <MergeToolbar
          fileName={basename(session.path)}
          total={originalCount.current}
          resolved={resolved}
          idx={idx}
          count={model.conflictHunks.length}
          dirty={dirty}
          busy={busy}
          showBase={showBase}
          baseAvailable={baseAvailable}
          showWhitespace={showWhitespace}
          syncScroll={syncScroll}
          onPrev={() => go(-1)}
          onNext={() => go(1)}
          onOurs={() => accept('ours')}
          onTheirs={() => accept('theirs')}
          onBoth={() => accept('both')}
          onResolved={() => markResolved()}
          onByLine={() => setLineOpen((v) => !v)}
          byLineActive={lineOpen}
          onSave={save}
          onClose={close}
          onToggleBase={() => setShowBase((v) => !v)}
          onToggleWhitespace={() => setShowWhitespace((v) => !v)}
          onToggleSync={() => setSyncScroll((v) => !v)}
        />

        <div className="merge-modal-body">
          {activePanes.map((side) => (
            <div className={'merge-col ' + paneMeta[side].cls} key={side}>
              <div className="merge-col-head">{paneMeta[side].label}</div>
              <div className="merge-col-body">
                <Editor
                  /* Result is UNCONTROLLED (we own its buffer via executeEdits so
                     undo/redo and typing aren't clobbered); side panes are
                     controlled + readonly and re-render from the model. */
                  value={side === 'result' ? undefined : valueFor[side]}
                  defaultValue={side === 'result' ? session.result : undefined}
                  language={langId}
                  theme="jakide"
                  beforeMount={(m) => defineJakIDETheme(m, theme)}
                  onMount={mountPane(side)}
                  onChange={
                    side === 'result'
                      ? () => {
                          if (reparseTimer.current) clearTimeout(reparseTimer.current);
                          const ed = eds.current.result;
                          if (ed) setResult(ed.getValue());
                          setDirty(true);
                          reparseTimer.current = setTimeout(reparse, 150);
                        }
                      : undefined
                  }
                  options={{
                    ...OVERFLOW_WIDGETS_OPTIONS,
                    readOnly: side !== 'result',
                    glyphMargin: side === 'ours' || side === 'theirs',
                    minimap: { enabled: side === 'result' },
                    renderWhitespace: showWhitespace ? 'all' : 'selection',
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    fontSize: theme.fontSize,
                    fontFamily: theme.fontFamily,
                    lineNumbersMinChars: LINE_NUMBERS_MIN_CHARS,
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {lineOpen && model.conflictHunks[idx] && (
          <div className="merge-line-drawer">
            <ConflictLineResolver
              key={currentId ?? idx}
              ours={model.conflictHunks[idx].oursLines}
              theirs={model.conflictHunks[idx].theirsLines}
              onApply={(lines) => {
                applyToHunk(model.conflictHunks[idx], lines);
                setLineOpen(false);
              }}
              onClose={() => setLineOpen(false)}
            />
          </div>
        )}

        <div className="merge-modal-foot">
          {model.conflictHunks.length === 0 ? (
            <span className="merge-foot-done">
              <IconCheck size={13} /> No conflicts remaining — review the result and Save.
            </span>
          ) : (
            <span>
              <b>F7</b>/<b>Shift+F7</b> navigate · <b>Alt+O/T/B</b> accept ours/theirs/both · <b>Alt+R</b> strip markers · <b>Ctrl/Cmd+S</b> save. Gutter <b>→</b>/<b>←</b> or right-click a conflict.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
