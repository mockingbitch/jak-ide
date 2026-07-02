import { useState } from 'react';
import { IconChevronDown } from '../icons';

export interface MenuOption {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  /** Full/technical label shown on the collapsed button; falls back to `label`. */
  readonly buttonLabel?: string;
}

/** Flat Cursor-style dropdown for the composer bar (mode / model). Shows the current
 *  label + chevron; opens a popup list above the bar. */
export function ComposerMenu({
  value,
  options,
  onChange,
  disabled,
  title,
  className,
  align = 'left',
}: {
  value: string;
  options: readonly MenuOption[];
  onChange: (id: string) => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  /** Which edge the popup hangs from — 'right' for menus near the bar's right end,
   *  so the popup doesn't spill past the panel's edge. */
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === value);

  return (
    <div className="composer-menu">
      <button
        type="button"
        className={'composer-menu-btn' + (className ? ' ' + className : '')}
        title={title}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="cmb-label">{current?.buttonLabel ?? current?.label ?? value}</span>
        <IconChevronDown size={12} />
      </button>
      {open && (
        <>
          <div className="menu-overlay" onClick={() => setOpen(false)} />
          <div className={'composer-menu-pop' + (align === 'right' ? ' align-right' : '')} role="listbox">
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={o.id === value}
                className={'composer-menu-item' + (o.id === value ? ' active' : '')}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
              >
                <span className="cmi-label">{o.label}</span>
                {o.hint && <span className="cmi-hint">{o.hint}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
