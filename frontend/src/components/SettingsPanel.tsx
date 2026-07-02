import { useState } from 'react';
import { AppearanceSettings } from './settings/AppearanceSettings';
import { AccountSettings } from './settings/AccountSettings';
import { AboutSettings } from './settings/AboutSettings';
import { IconClose, IconPalette, IconUser, IconInfo } from './icons';

type Category = 'appearance' | 'account' | 'about';

const CATEGORIES: { id: Category; label: string; icon: typeof IconPalette }[] = [
  { id: 'appearance', label: 'Appearance', icon: IconPalette },
  { id: 'account', label: 'Account', icon: IconUser },
  { id: 'about', label: 'About', icon: IconInfo },
];

/** Settings modal: a JetBrains-style left-nav of categories + a scrollable
 *  content pane, so each settings area can grow without turning into one
 *  long undifferentiated scroll. */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [category, setCategory] = useState<Category>('appearance');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Settings</span>
          <button className="icon-btn" onClick={onClose} title="Close">
            <IconClose size={16} />
          </button>
        </div>

        <div className="settings-layout">
          <nav className="settings-nav">
            {CATEGORIES.map(({ id, label, icon: Icon }) => (
              <button key={id} className={id === category ? 'active' : ''} onClick={() => setCategory(id)}>
                <Icon size={15} />
                {label}
              </button>
            ))}
          </nav>
          <div className="modal-body settings-content">
            {category === 'appearance' && <AppearanceSettings />}
            {category === 'account' && <AccountSettings />}
            {category === 'about' && <AboutSettings />}
          </div>
        </div>

        <div className="modal-footer">
          <span className="muted">Preferences are saved locally in your browser / app.</span>
          <button onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
