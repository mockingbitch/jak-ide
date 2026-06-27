export type ThemeBase = 'dark' | 'light';

export interface ThemePreset {
  id: string;
  name: string;
  base: ThemeBase;
  editorBg: string;
  editorFg: string;
  defaultAccent: string;
  vars: Record<string, string>;
}

export interface ThemeSetting {
  presetId: string;
  accent: string;
  fontSize: number;
  fontFamily: string; // code font (editor / terminal / code blocks)
}

/** Fallback chain appended after a chosen family so text always renders. */
export const FONT_FALLBACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "DejaVu Sans Mono", monospace';
export const DEFAULT_FONT = `"JetBrains Mono", "Fira Code", "Cascadia Code", ${FONT_FALLBACK}`;

interface Spec {
  base: ThemeBase;
  window: string;
  panel: string;
  raised: string;
  border: string;
  fg: string;
  dim: string;
  editorBg: string;
  editorFg: string;
  accent: string;
}

function makePreset(id: string, name: string, s: Spec): ThemePreset {
  return {
    id,
    name,
    base: s.base,
    editorBg: s.editorBg,
    editorFg: s.editorFg,
    defaultAccent: s.accent,
    vars: {
      '--bg': s.window,
      '--bg-2': s.panel,
      '--bg-3': s.raised,
      '--border': s.border,
      '--fg': s.fg,
      '--fg-dim': s.dim,
      '--editor-bg': s.editorBg,
      '--editor-fg': s.editorFg,
      '--hover': s.base === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)',
    },
  };
}

export const PRESETS: ThemePreset[] = [
  makePreset('jetbrains-dark', 'JetBrains New UI', {
    base: 'dark', window: '#1e1f22', panel: '#2b2d30', raised: '#393b40', border: '#393b40',
    fg: '#ced0d6', dim: '#868a91', editorBg: '#1e1f22', editorFg: '#bcbec4', accent: '#3574f0',
  }),
  makePreset('jetbrains-light', 'JetBrains New UI Light', {
    base: 'light', window: '#f0f1f3', panel: '#ffffff', raised: '#f7f8fa', border: '#ebecf0',
    fg: '#1e1f22', dim: '#5b5f6b', editorBg: '#ffffff', editorFg: '#080808', accent: '#3574f0',
  }),
  makePreset('darcula', 'Darcula', {
    base: 'dark', window: '#2b2b2b', panel: '#3c3f41', raised: '#4c5052', border: '#2b2b2b',
    fg: '#bbbbbb', dim: '#808080', editorBg: '#2b2b2b', editorFg: '#a9b7c6', accent: '#3592c4',
  }),
  makePreset('intellij-light', 'IntelliJ Light', {
    base: 'light', window: '#ececec', panel: '#f7f7f7', raised: '#ffffff', border: '#c9c9c9',
    fg: '#1e1e1e', dim: '#6a6a6a', editorBg: '#ffffff', editorFg: '#080808', accent: '#3573f0',
  }),
  makePreset('dracula', 'Dracula', {
    base: 'dark', window: '#21222c', panel: '#282a36', raised: '#343746', border: '#191a21',
    fg: '#f8f8f2', dim: '#9aa0b0', editorBg: '#282a36', editorFg: '#f8f8f2', accent: '#bd93f9',
  }),
  makePreset('nord', 'Nord', {
    base: 'dark', window: '#2e3440', panel: '#2e3440', raised: '#3b4252', border: '#222831',
    fg: '#d8dee9', dim: '#7b8494', editorBg: '#2e3440', editorFg: '#d8dee9', accent: '#88c0d0',
  }),
  makePreset('one-dark', 'One Dark', {
    base: 'dark', window: '#21252b', panel: '#21252b', raised: '#2c313a', border: '#181a1f',
    fg: '#abb2bf', dim: '#5c6370', editorBg: '#282c34', editorFg: '#abb2bf', accent: '#61afef',
  }),
  makePreset('solarized-dark', 'Solarized Dark', {
    base: 'dark', window: '#002b36', panel: '#073642', raised: '#0a4a59', border: '#00212b',
    fg: '#93a1a1', dim: '#586e75', editorBg: '#002b36', editorFg: '#93a1a1', accent: '#268bd2',
  }),
];

export const DEFAULT_THEME: ThemeSetting = {
  presetId: 'jetbrains-dark',
  accent: '#3574f0',
  fontSize: 13,
  fontFamily: DEFAULT_FONT,
};

export function getPreset(id: string): ThemePreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgba(hex: string, a: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Pick black or white text for legibility on the given background colour. */
export function readableOn(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#1b1b1b' : '#ffffff';
}

/** Apply a theme by writing CSS variables onto the document root. */
export function applyTheme(setting: ThemeSetting): void {
  const preset = getPreset(setting.presetId);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(preset.vars)) root.style.setProperty(k, v);
  root.style.setProperty('--accent', setting.accent);
  root.style.setProperty('--accent-fg', readableOn(setting.accent));
  root.style.setProperty('--accent-soft', rgba(setting.accent, preset.base === 'dark' ? 0.28 : 0.24));
  root.style.setProperty('--code-font', setting.fontFamily || DEFAULT_FONT);
  root.dataset.base = preset.base;
}

/** Monaco editor colours for the current theme. */
export function monacoColors(setting: ThemeSetting): { name: string; base: 'vs' | 'vs-dark'; bg: string; fg: string } {
  const preset = getPreset(setting.presetId);
  return {
    name: 'jakide',
    base: preset.base === 'light' ? 'vs' : 'vs-dark',
    bg: preset.editorBg,
    fg: preset.editorFg,
  };
}

/** xterm.js theme object for the current theme. */
export function xtermTheme(setting: ThemeSetting): Record<string, string> {
  const preset = getPreset(setting.presetId);
  const dark = preset.base === 'dark';
  return {
    background: preset.editorBg,
    foreground: preset.editorFg,
    cursor: setting.accent,
    cursorAccent: preset.editorBg,
    selectionBackground: rgba(setting.accent, 0.35),
    black: dark ? '#2b2b2b' : '#1b1b1b',
    red: '#e06c75',
    green: '#98c379',
    yellow: '#e5c07b',
    blue: '#61afef',
    magenta: '#c678dd',
    cyan: '#56b6c2',
    white: '#d7dae0',
    brightBlack: '#5c6370',
    brightRed: '#e06c75',
    brightGreen: '#98c379',
    brightYellow: '#e5c07b',
    brightBlue: '#61afef',
    brightMagenta: '#c678dd',
    brightCyan: '#56b6c2',
    brightWhite: '#ffffff',
  };
}
