import { useStore } from '../../store';
import { getAuthStatus, authLogin, authLogout } from '../../api';

/** Anthropic / Claude Code sign-in status. */
export function AccountSettings() {
  const auth = useStore((s) => s.auth);
  const setAuth = useStore((s) => s.setAuth);
  const authBusy = useStore((s) => s.authBusy);
  const setAuthBusy = useStore((s) => s.setAuthBusy);

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
    <section>
      <h4>Claude account</h4>
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
          Requests run through your logged-in <code>claude</code> CLI. Manage this login with the CLI (
          <code>claude</code> / <code>/login</code>).
        </div>
      )}
      {auth.method === 'none' && (
        <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          {auth.claudeInstalled ? 'You have Claude Code — run `claude` and log in, then reload. ' : ''}
          {!auth.antInstalled && 'Anthropic sign-in needs the `ant` CLI. '}
          You can also set an API key.
        </div>
      )}
    </section>
  );
}
