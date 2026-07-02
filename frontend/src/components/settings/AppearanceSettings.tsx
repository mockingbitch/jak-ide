import { useStore } from '../../store';
import { PRESETS, getPreset, DEFAULT_FONT, FONT_FALLBACK } from '../../theme';

/** Theme preset, accent colour, and code font — everything that changes how the IDE looks. */
export function AppearanceSettings() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const fonts = useStore((s) => s.fonts);
  const preset = getPreset(theme.presetId);

  // The currently-selected primary family (first entry of the font-family stack).
  const primaryFont = (theme.fontFamily.split(',')[0] || '').replace(/["']/g, '').trim();
  const fontOptions = fonts.includes(primaryFont) || !primaryFont ? fonts : [primaryFont, ...fonts];
  const pickFont = (family: string) => setTheme({ fontFamily: `"${family}", ${FONT_FALLBACK}` });

  return (
    <>
      <section>
        <h4>Theme</h4>
        <div className="preset-grid">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className={'preset' + (p.id === theme.presetId ? ' active' : '')}
              onClick={() => setTheme({ presetId: p.id, accent: p.defaultAccent })}
            >
              <span className="swatches">
                <i style={{ background: p.vars['--bg-2'] }} />
                <i style={{ background: p.editorBg }} />
                <i style={{ background: p.defaultAccent }} />
              </span>
              {p.name}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h4>Accent colour</h4>
        <div className="accent-row">
          <input type="color" value={theme.accent} onChange={(e) => setTheme({ accent: e.target.value })} />
          <code>{theme.accent}</code>
          <button className="link" onClick={() => setTheme({ accent: preset.defaultAccent })}>
            reset
          </button>
        </div>
      </section>

      <section>
        <h4>Code font {fonts.length > 0 && <span className="muted">· {fonts.length} OS fonts</span>}</h4>
        <div className="accent-row">
          <select
            className="font-select"
            value={primaryFont}
            onChange={(e) => pickFont(e.target.value)}
            title="Choose an installed font"
          >
            {fontOptions.length === 0 && <option value={primaryFont}>{primaryFont || '(loading…)'}</option>}
            {fontOptions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <button className="link" onClick={() => setTheme({ fontFamily: DEFAULT_FONT })}>
            reset
          </button>
        </div>
        <input
          className="font-input"
          type="text"
          spellCheck={false}
          value={theme.fontFamily}
          onChange={(e) => setTheme({ fontFamily: e.target.value })}
          title="Full CSS font-family (advanced)"
        />
        <div className="font-preview" style={{ fontFamily: theme.fontFamily }}>
          const greet = (name) =&gt; `Hello, ${'{name}'}`; // Il1 O0 — 0123456789
        </div>
      </section>

      <section>
        <h4>Font size</h4>
        <div className="accent-row">
          <input
            type="range"
            min={10}
            max={22}
            value={theme.fontSize}
            onChange={(e) => setTheme({ fontSize: Number(e.target.value) })}
          />
          <code>{theme.fontSize}px</code>
        </div>
      </section>
    </>
  );
}
