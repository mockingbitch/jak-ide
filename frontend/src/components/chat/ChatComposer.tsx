import { useMemo, useRef, useState } from 'react';
import { useAiStore, MODELS, PERMISSION_MODES, EFFORTS, type PermissionMode, type Effort } from '../../lib/aiStore';
import { useStore } from '../../store';
import { isImageFile, type AttachedImage } from '../../lib/imageAttach';
import { FileIcon } from '../FileIcon';
import { MentionPicker } from './MentionPicker';
import { ComposerMenu } from './ComposerMenu';
import { IconPaperclip, IconArrowUp, IconStop, IconClose, IconAt } from '../icons';

interface Props {
  attachments: AttachedImage[];
  onAddFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  busy: boolean;
  disabled: boolean;
  placeholder: string;
  contextPath?: string; // active file, shown as a Cursor-style context pill
  mentions: string[]; // @-mentioned files added to context
  onAddMention: (path: string) => void;
  onRemoveMention: (path: string) => void;
}

const MAX_TEXTAREA = 200;
const base = (p: string) => p.split('/').pop() ?? p;

export function ChatComposer({
  attachments,
  onAddFiles,
  onRemove,
  onSend,
  onStop,
  busy,
  disabled,
  placeholder,
  contextPath,
  mentions,
  onAddMention,
  onRemoveMention,
}: Props) {
  const model = useAiStore((s) => s.model);
  const setModel = useAiStore((s) => s.setModel);
  const permissionMode = useAiStore((s) => s.permissionMode);
  const setPermissionMode = useAiStore((s) => s.setPermissionMode);
  const effort = useAiStore((s) => s.effort);
  const setEffort = useAiStore((s) => s.setEffort);
  const defaultModel = useStore((s) => s.model);
  // "Default model" resolves to whatever the IDE is actually configured with —
  // show that real id on the button instead of the generic placeholder label.
  const models = useMemo(
    () => MODELS.map((m) => (m.id === 'default' && defaultModel ? { ...m, buttonLabel: defaultModel } : m)),
    [defaultModel]
  );
  const [input, setInput] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
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
    if (!text && attachments.length === 0 && mentions.length === 0) return;
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
      return;
    }
    // "@" at a word boundary opens the file-mention picker (like Cursor).
    if (e.key === '@' && !disabled) {
      const before = input.slice(0, e.currentTarget.selectionStart ?? input.length);
      if (before.length === 0 || /\s$/.test(before)) {
        e.preventDefault();
        setMentionOpen(true);
      }
    }
  };

  const pickMention = (path: string) => {
    onAddMention(path);
    setMentionOpen(false);
    taRef.current?.focus();
  };

  const modeHint = PERMISSION_MODES.find((m) => m.id === permissionMode)?.hint ?? '';
  const showContextRow = !!contextPath || mentions.length > 0;

  return (
    <div className="chat-composer">
      <div className="composer-box">
        {showContextRow && (
          <div className="composer-context">
            {contextPath && (
              <span className="ctx-pill" title={contextPath}>
                <FileIcon name={base(contextPath)} />
                <span className="ctx-name">{base(contextPath)}</span>
                <span className="ctx-tag">current</span>
              </span>
            )}
            {mentions.map((p) => (
              <span className="ctx-pill mention" key={p} title={p}>
                <FileIcon name={base(p)} />
                <span className="ctx-name">{base(p)}</span>
                <button className="ctx-x" title="Remove from context" onClick={() => onRemoveMention(p)}>
                  <IconClose size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

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
          onKeyDown={onKeyDown}
        />

        <div className="composer-bar">
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
          <button className="composer-btn" title="Add file to context (@)" disabled={disabled} onClick={() => setMentionOpen(true)}>
            <IconAt size={16} />
          </button>
          <button className="composer-btn" title="Attach image" disabled={disabled} onClick={() => fileRef.current?.click()}>
            <IconPaperclip size={16} />
          </button>
          <ComposerMenu
            value={permissionMode}
            options={PERMISSION_MODES}
            onChange={(id) => setPermissionMode(id as PermissionMode)}
            disabled={disabled}
            title={modeHint}
            className={'mode-' + permissionMode}
          />
          <ComposerMenu value={model} options={models} onChange={setModel} disabled={disabled} title="Model" />
          <ComposerMenu
            value={effort}
            options={EFFORTS}
            onChange={(id) => setEffort(id as Effort)}
            disabled={disabled}
            title="Reasoning effort"
            className={'effort-' + effort}
            align="right"
          />
          <span className="composer-spacer" />
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

        {mentionOpen && <MentionPicker onPick={pickMention} onClose={() => setMentionOpen(false)} />}
      </div>
    </div>
  );
}
