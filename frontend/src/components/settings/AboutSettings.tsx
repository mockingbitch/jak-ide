import { useEffect, useState } from 'react';

const REPO_URL = 'https://github.com/mockingbitch/jakide';

/** App identity: icon, version, update check, and links — no app state to wire up. */
export function AboutSettings() {
  const jak = window.jakide;
  const desktop = !!jak?.isDesktop;
  const [version, setVersion] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!jak?.getAppVersion) return;
    jak.getAppVersion().then(setVersion).catch(() => setVersion(null));
  }, [jak]);

  const checkForUpdates = async () => {
    if (!jak?.checkForUpdates || checking) return;
    setChecking(true);
    try {
      await jak.checkForUpdates();
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className="about-section">
      <div className="about-identity">
        <img src="/app-icon.png" alt="" width={64} height={64} />
        <div>
          <div className="about-name">JakIDE</div>
          <div className="muted">AI-first IDE</div>
          {version && <div className="about-version">Version {version}</div>}
        </div>
      </div>

      {desktop && jak?.checkForUpdates && (
        <div className="accent-row" style={{ marginTop: 16 }}>
          <button onClick={checkForUpdates} disabled={checking}>
            {checking ? 'Checking…' : 'Check for Updates…'}
          </button>
        </div>
      )}

      <div className="about-links">
        <a href={REPO_URL} target="_blank" rel="noreferrer">
          GitHub repository
        </a>
        <a href={`${REPO_URL}/releases`} target="_blank" rel="noreferrer">
          Release notes
        </a>
        <a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer">
          Report an issue
        </a>
      </div>

      <div className="muted about-legal">
        MIT License — © 2026 PhongTran
        <br />
        Built with Electron, React, Rust, and Monaco.
      </div>
    </section>
  );
}
