import { monacoColors, type ThemeSetting } from '../theme';

/** Define + register the shared 'jakide' Monaco theme for the current app theme. */
export function defineJakIDETheme(monaco: any, themeSetting: ThemeSetting): void {
  const c = monacoColors(themeSetting);
  const dark = c.base === 'vs-dark';
  monaco.editor.defineTheme('jakide', {
    base: c.base,
    inherit: true,
    rules: [],
    colors: {
      'editor.background': c.bg,
      'editor.foreground': c.fg,
      'editorGutter.background': c.bg,
      'editorLineNumber.foreground': dark ? '#4b4e54' : '#aeb1b8',
      'editorLineNumber.activeForeground': dark ? '#a0a4ab' : '#5a5d66',
      'editor.lineHighlightBackground': dark ? '#26282e' : '#f5f6f8',
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': themeSetting.accent + '44',
      'editor.inactiveSelectionBackground': themeSetting.accent + '22',
      'editorCursor.foreground': themeSetting.accent,
      'editorIndentGuide.background1': dark ? '#2f3137' : '#e9eaee',
      'editorIndentGuide.activeBackground1': dark ? '#43454a' : '#c9ccd2',
      'editorWidget.background': dark ? '#2b2d30' : '#ffffff',
      'editorWidget.border': dark ? '#393b40' : '#ebecf0',
      'editorBracketMatch.background': themeSetting.accent + '22',
      'editorBracketMatch.border': themeSetting.accent + '88',
      'scrollbarSlider.background': dark ? '#393b4080' : '#c9ccd280',
      'scrollbarSlider.hoverBackground': dark ? '#4b4e54aa' : '#aeb1b8aa',
      focusBorder: '#00000000',
    },
  });
}
