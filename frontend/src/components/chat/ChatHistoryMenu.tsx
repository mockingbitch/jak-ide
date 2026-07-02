import { useState } from 'react';
import { useChatHistory } from '../../lib/chatHistoryStore';
import { IconHistory, IconClose } from '../icons';

/** Header dropdown listing past chats. Selecting one loads it (parent archives the
 *  current conversation first); the × removes a session. */
export function ChatHistoryMenu({ onSelect }: { onSelect: (id: string) => void }) {
  const sessions = useChatHistory((s) => s.sessions);
  const remove = useChatHistory((s) => s.remove);
  const clearAll = useChatHistory((s) => s.clearAll);
  const [open, setOpen] = useState(false);

  return (
    <div className="chat-history">
      <button className="chat-newchat" title="Chat history" aria-pressed={open} onClick={() => setOpen((o) => !o)}>
        <IconHistory size={15} />
      </button>
      {open && (
        <>
          <div className="menu-overlay" onClick={() => setOpen(false)} />
          <div className="chat-history-menu">
            {sessions.length === 0 ? (
              <div className="chat-history-empty">No past chats yet.</div>
            ) : (
              <>
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className="chat-history-item"
                    title={s.title}
                    onClick={() => {
                      onSelect(s.id);
                      setOpen(false);
                    }}
                  >
                    <span className="chi-title">{s.title}</span>
                    <button
                      className="chi-del"
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(s.id);
                      }}
                    >
                      <IconClose size={12} />
                    </button>
                  </div>
                ))}
                <button className="chat-history-clear" onClick={() => clearAll()}>
                  Clear history
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
