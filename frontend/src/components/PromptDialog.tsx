import { useState } from 'react';
import { IconClose } from './icons';

/** A modal text-input dialog. Replaces window.prompt(), which Electron does not
 *  implement (prompt()-based flows silently no-op in the packaged app). */
export function PromptDialog({
  title,
  label,
  initial = '',
  placeholder,
  confirmLabel = 'OK',
  onSubmit,
  onClose,
}: {
  title: string;
  label?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const submit = () => {
    const v = value.trim();
    if (v) onSubmit(v);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal prompt-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{title}</span>
          <button className="icon-btn" onClick={onClose} title="Close">
            <IconClose size={16} />
          </button>
        </div>
        <div className="modal-body">
          <label className="prompt-field">
            {label && <span>{label}</span>}
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              spellCheck={false}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  onClose();
                }
              }}
            />
          </label>
        </div>
        <div className="modal-footer">
          <span className="fp-actions">
            <button onClick={onClose}>Cancel</button>
            <button className="primary" onClick={submit} disabled={!value.trim()}>
              {confirmLabel}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
