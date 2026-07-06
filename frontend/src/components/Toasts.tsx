import { useToastStore } from '../lib/toastStore';
import { IconCheck, IconClose, IconWarning } from './icons';

/** Bottom-right transient notifications (save success / errors). Mounted once. */
export function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={'toast toast-' + t.kind}>
          <span className="toast-icon">
            {t.kind === 'success' ? <IconCheck size={14} /> : <IconWarning size={14} />}
          </span>
          <span className="toast-msg">{t.message}</span>
          <button className="toast-close" title="Dismiss" onClick={() => dismiss(t.id)}>
            <IconClose size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
