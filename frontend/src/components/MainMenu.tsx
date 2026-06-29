import { useState } from 'react';
import { IconMenu } from './icons';

/** Title-bar hamburger main menu — replaces the native File/View/Help bar. */
export function MainMenu({
  onSettings,
  onSearch,
  onOpenFolder,
}: {
  onSettings: () => void;
  onSearch: () => void;
  onOpenFolder: () => void;
}) {
  const [open, setOpen] = useState(false);
  const jak = window.jakide;
  const desktop = !!jak?.isDesktop;
  const pick = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  return (
    <div className="main-menu-wrap">
      <button
        className="tb-icon-btn"
        onClick={() => setOpen((o) => !o)}
        title="Main menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <IconMenu size={18} />
      </button>
      {open && (
        <>
          <div className="menu-overlay" onClick={() => setOpen(false)} />
          <div className="main-menu" role="menu">
            <button onClick={() => pick(onSearch)}>
              Search Everywhere
              <span className="kbd">Ctrl P</span>
            </button>
            <button onClick={() => pick(onOpenFolder)}>Open Folder…</button>
            <button onClick={() => pick(onSettings)}>Settings</button>
            {desktop && jak?.setApiKey && <button onClick={() => pick(() => jak.setApiKey!())}>Set Anthropic API Key…</button>}
            <div className="ctx-sep" />
            {desktop && jak?.toggleDevTools && (
              <button onClick={() => pick(() => jak.toggleDevTools!())}>Toggle Developer Tools</button>
            )}
            <button onClick={() => pick(() => window.location.reload())}>Reload Window</button>
          </div>
        </>
      )}
    </div>
  );
}
