import { useEffect, useState } from 'react';
import { IconWinMinimize, IconWinMaximize, IconWinRestore, IconClose } from './icons';

/** Custom minimize/maximize/close buttons for the frameless desktop window. */
export function WindowControls() {
  const jak = window.jakide;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!jak?.isDesktop) return;
    jak.winIsMaximized?.().then((v) => setMaximized(!!v));
    const unsubscribe = jak.onWinStateChange?.((state) => setMaximized(state.maximized));
    return unsubscribe;
  }, [jak]);

  if (!jak?.isDesktop) return null;

  return (
    <div className="win-controls">
      <button className="tb-icon-btn win-ctl-btn" onClick={() => jak.winMinimize?.()} title="Minimize">
        <IconWinMinimize size={15} />
      </button>
      <button
        className="tb-icon-btn win-ctl-btn"
        onClick={() => jak.winToggleMaximize?.()}
        title={maximized ? 'Restore' : 'Maximize'}
      >
        {maximized ? <IconWinRestore size={14} /> : <IconWinMaximize size={14} />}
      </button>
      <button className="tb-icon-btn win-ctl-btn win-ctl-close" onClick={() => jak.winClose?.()} title="Close">
        <IconClose size={15} />
      </button>
    </div>
  );
}
