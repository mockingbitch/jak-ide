import { useRef, useState } from 'react';
import { useAiStore, MODELS, PERMISSION_MODES, type PermissionMode } from '../../lib/aiStore';
import { isImageFile, type AttachedImage } from '../../lib/imageAttach';
import { IconPaperclip, IconArrowUp, IconStop, IconClose } from '../icons';

interface Props {
  attachments: AttachedImage[];
  onAddFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  busy: boolean;
  disabled: boolean;
  placeholder: string;
}

const MAX_TEXTAREA = 200;

export function ChatComposer({ attachments, onAddFiles, onRemove, onSend, onStop, busy, disabled, placeholder }: Props) {
  const model = useAiStore((s) => s.model);
  const setModel = useAiStore((s) => s.setModel);
  const permissionMode = useAiStore((s) => s.permissionMode);
  const setPermissionMode = useAiStore((s) => s.setPermissionMode);
  const [input, setInput] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const grow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, MAX_TEXTAREA) + 'px';
  };

  const submit = () => {
    if (busy || disabled) return;
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    onSend(input);
    setInput('');
    setTimeout(grow, 0);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files).filter(isImageFile);
    if (files.length) {
      e.preventDefault();
      onAddFiles(files);
    }
  };

  const modeHint = PERMISSION_MODES.find((m) => m.id === permissionMode)?.hint ?? '';

  return (
    <div className="chat-composer">
      {attachments.length > 0 && (
        <div className="chat-tray">
          {attachments.map((a) => (
            <div className="chat-thumb" key={a.id} title={a.name}>
              <img src={a.previewUrl} alt={a.name} />
              <button className="chat-thumb-x" title="Remove" onClick={() => onRemove(a.id)}>
                <IconClose size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={taRef}
        className="chat-input"
        value={input}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        rows={1}
        onChange={(e) => {
          setInput(e.target.value);
          grow();
        }}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />

      <div className="chat-toolbar">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            onAddFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
        <button className="chat-tool-btn" title="Attach image" disabled={disabled} onClick={() => fileRef.current?.click()}>
          <IconPaperclip size={16} />
        </button>
        <select className="chat-pill" title="Model" value={model} disabled={disabled} onChange={(e) => setModel(e.target.value)}>
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <select
          className={'chat-pill mode-' + permissionMode}
          title={modeHint}
          value={permissionMode}
          disabled={disabled}
          onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}
        >
          {PERMISSION_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <span className="chat-toolbar-spacer" />
        {busy ? (
          <button className="chat-send stop" title="Stop" onClick={onStop}>
            <IconStop size={13} />
          </button>
        ) : (
          <button className="chat-send" title="Send (Enter)" disabled={disabled} onClick={submit}>
            <IconArrowUp size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
