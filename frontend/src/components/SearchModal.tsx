import { useEffect } from 'react';
import { FileNameSearchPanel } from './FileNameSearchPanel';
import { ContentSearchPanel } from './ContentSearchPanel';

export type SearchTab = 'files' | 'content';

/** Ctrl/Cmd+P (Files) and Ctrl/Cmd+Shift+F (Text) both open this modal — one shell,
 *  two tabs. Controlled: the parent owns the active tab so those shortcuts can flip
 *  the tab even while the modal is already open. Both panels stay mounted (hidden,
 *  not unmounted) so each tab keeps its query/results when you switch away and back. */
export function SearchModal({
  tab,
  onTab,
  onClose,
}: {
  tab: SearchTab;
  onTab: (t: SearchTab) => void;
  onClose: () => void;
}) {
  // Escape closes from anywhere in the modal (focus may sit on a toggle button, not
  // an input, so the per-input handlers aren't enough).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="finder-overlay" onClick={onClose}>
      <div className="finder finder-search" onClick={(e) => e.stopPropagation()}>
        <div className="finder-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'files'}
            className={'finder-tab' + (tab === 'files' ? ' active' : '')}
            onClick={() => onTab('files')}
          >
            Files <span className="finder-tab-kbd">⌘P</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'content'}
            className={'finder-tab' + (tab === 'content' ? ' active' : '')}
            onClick={() => onTab('content')}
          >
            Text <span className="finder-tab-kbd">⌘⇧F</span>
          </button>
        </div>

        <div className={'finder-panel' + (tab === 'files' ? '' : ' hidden')}>
          <FileNameSearchPanel active={tab === 'files'} onClose={onClose} />
        </div>
        <div className={'finder-panel' + (tab === 'content' ? '' : ' hidden')}>
          <ContentSearchPanel active={tab === 'content'} onClose={onClose} />
        </div>
      </div>
    </div>
  );
}
