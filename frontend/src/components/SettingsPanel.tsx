import { useStore } from '../store';
import { PRESETS, getPreset, DEFAULT_FONT, FONT_FALLBACK } from '../theme';
import { getAuthStatus, authLogin, authLogout } from '../api';
import { IconClose } from './icons';

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const fonts = useStore((s) => s.fonts);
  const auth = useStore((s) => s.auth);
  const setAuth = useStore((s) => s.setAuth);
  const authBusy = useStore((s) => s.authBusy);
  const setAuthBusy = useStore((s) => s.setAuthBusy);
  const preset = getPreset(theme.presetId);

  // The currently-selected primary family (first entry of the font-family stack).
  const primaryFont = (theme.fontFamily.split(',')[0] || '').replace(/["']/g, '').trim();
  const fontOptions = fonts.includes(primaryFont) || !primaryFont ? fonts : [primaryFont, ...fonts];
  const pickFont = (family: string) => setTheme({ fontFamily: `"${family}", ${FONT_FALLBACK}` });

  const refreshAuth = async () => {
    try {
      setAuth(await getAuthStatus());
    } catch {
      /* ignore */
    }
  };
  const signIn = async () => {
    if (authBusy) return; // shared guard — also covers the AI-panel sign-in button
    setAuthBusy(true);
    try {
      const r = await authLogin();
      if (!r.ok && r.error) alert(r.error);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      await refreshAuth();
      setAuthBusy(false);
    }
  };
  const signOut = async () => {
    if (authBusy) return;
    setAuthBusy(true);
    try {
      await authLogout();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      await refreshAuth();
      setAuthBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Appearance &amp; Settings</span>
          <button className="icon-btn" onClick={onClose} title="Close">
            <IconClose size={16} />
          </button>
        </div>

        <div className="modal-body">
          <section className="row">
            <h4>Account</h4>
            <div className="accent-row">
              <span>
                {auth.method === 'claude-code'
                  ? '🟢 Using Claude Code login'
                  : auth.method === 'oauth'
                    ? '🟢 Signed in with Anthropic'
                    : auth.method === 'apikey'
                      ? '🟢 Using API key'
                      : '⚪ Not connected'}
              </span>
              {auth.method === 'oauth' ? (
                <button onClick={signOut} disabled={authBusy}>
                  Sign out
                </button>
              ) : auth.method === 'apikey' || auth.method === 'claude-code' ? null : (
                <button onClick={signIn} disabled={authBusy}>
                  {authBusy ? 'Finish in your browser…' : 'Sign in with Anthropic'}
                </button>
              )}
            </div>
            {auth.method === 'claude-code' && (
              <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                Requests run through your logged-in <code>claude</code> CLI. Manage this login with the CLI
                (<code>claude</code> / <code>/login</code>).
              </div>
            )}
            {auth.method === 'none' && (
              <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                {auth.claudeInstalled
                  ? 'You have Claude Code — run `claude` and log in, then reload. '
                  : ''}
                {!auth.antInstalled && 'Anthropic sign-in needs the `ant` CLI. '}
                You can also set an API key.
              </div>
            )}
          </section>

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

          <section className="row">
            <h4>Accent colour</h4>
            <div className="accent-row">
              <input
                type="color"
                value={theme.accent}
                onChange={(e) => setTheme({ accent: e.target.value })}
              />
              <code>{theme.accent}</code>
              <button className="link" onClick={() => setTheme({ accent: preset.defaultAccent })}>
                reset
              </button>
            </div>
          </section>

          <section className="row">
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

          <section className="row">
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
        </div>

        <div className="modal-footer">
          <span className="muted">Preferences are saved locally in your browser / app.</span>
          <button onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
