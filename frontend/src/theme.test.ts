import { describe, it, expect } from 'vitest';
import { PRESETS } from './theme';

describe('theme presets', () => {
  it('never gives the editor/chat/terminal cards the exact same color as the frame behind them, in any theme', () => {
    for (const preset of PRESETS) {
      const bg = preset.vars['--bg'];
      const bg2 = preset.vars['--bg-2']; // chat + terminal cards (.tw)
      const editorBg = preset.vars['--editor-bg']; // text editor card (.ide-editor)
      expect(bg2.toLowerCase(), `${preset.id}: --bg-2 must differ from --bg`).not.toBe(bg.toLowerCase());
      expect(editorBg.toLowerCase(), `${preset.id}: --editor-bg must differ from --bg`).not.toBe(bg.toLowerCase());
      // preset.editorBg (used directly by Monaco/xterm) must stay in sync with
      // --editor-bg, or the editor shell and Monaco's own paint would mismatch.
      expect(preset.editorBg.toLowerCase()).toBe(editorBg.toLowerCase());
    }
  });

  it('leaves a preset color untouched when it already differs from the frame', () => {
    const dracula = PRESETS.find((p) => p.id === 'dracula')!;
    // Dracula's hand-picked editorBg (#282a36) already differs from its window
    // (#21222c) — the derivation must not perturb an already-good choice.
    expect(dracula.vars['--editor-bg'].toLowerCase()).toBe('#282a36');
  });
});
