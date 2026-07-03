import { IconClose } from '../icons';

/** The list of prompts the user queued while a reply was streaming — they run one
 *  after another. Shows the order + text; each can be removed before it runs. */
export function ChatQueue({ items, onRemove }: { items: { id: number; text: string }[]; onRemove: (id: number) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="chat-queue">
      <div className="chat-queue-head">
        Queued · {items.length} — runs after the current reply
      </div>
      {items.map((it, i) => (
        <div className="chat-queue-item" key={it.id}>
          <span className="chat-queue-num">{i + 1}</span>
          <span className="chat-queue-text" title={it.text}>
            {it.text.trim() || '(attachment only)'}
          </span>
          <button className="chat-queue-x" title="Remove from queue" onClick={() => onRemove(it.id)}>
            <IconClose size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}
