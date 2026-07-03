import { Fragment, useEffect, useState } from 'react';
import { useStore } from './store';
import { getHealth, getShells, getAuthStatus, getFonts, getProjects, gitStatus } from './api';
import { applyTheme } from './theme';
import { useEditorChrome } from './hooks/useEditorChrome';
import { useLsp } from './hooks/useLsp';
import { FileExplorer } from './components/FileExplorer';
import { FindInFiles } from './components/FindInFiles';
import { EditorGroupView } from './components/EditorGroupView';
import { ChatPanel } from './components/ChatPanel';
import { TerminalPanel } from './components/TerminalPanel';
import { RunPanel } from './components/RunPanel';
import { DockerPanel } from './components/DockerPanel';
import { DbPanel } from './components/DbPanel';
import { ProblemsPanel } from './components/ProblemsPanel';
import { useAllProblems } from './hooks/useProblems';
import { Splitter } from './components/Splitter';
import { StatusBar } from './components/StatusBar';
import { SettingsPanel } from './components/SettingsPanel';
import { SearchModal, type SearchTab } from './components/SearchModal';
import { GoToSymbol } from './components/GoToSymbol';
import { MergeModal } from './components/MergeModal';
import { ProjectMenu } from './components/ProjectMenu';
import { GitPanel } from './components/GitPanel';
import { MainMenu } from './components/MainMenu';
import { BranchWidget } from './components/BranchWidget';
import { FolderPicker } from './components/FolderPicker';
import { WindowControls } from './components/WindowControls';
import { IconProject, IconSearch, IconSettings, IconAI, IconTerminal, IconBranch, IconRun, IconWarning, IconDocker, IconDatabase } from './components/icons';

export default function App() {
  const layout = useStore((s) => s.layout);
  const theme = useStore((s) => s.theme);
  const setMeta = useStore((s) => s.setMeta);
  const setProjects = useStore((s) => s.setProjects);
  const setGit = useStore((s) => s.setGit);
  const setGitFiles = useStore((s) => s.setGitFiles);
  const projectRoot = useStore((s) => s.projectRoot);
  const gitRefreshSeq = useStore((s) => s.gitRefreshSeq);
  const bumpGitRefresh = useStore((s) => s.bumpGitRefresh);
  const setAuth = useStore((s) => s.setAuth);
  const setShells = useStore((s) => s.setShells);
  const setFonts = useStore((s) => s.setFonts);
  const selectLeftView = useStore((s) => s.selectLeftView);
  const toggleRight = useStore((s) => s.toggleRight);
  const selectBottomView = useStore((s) => s.selectBottomView);
  const folderPickerOpen = useStore((s) => s.folderPickerOpen);
  const openFolderPicker = useStore((s) => s.openFolderPicker);
  const closeFolderPicker = useStore((s) => s.closeFolderPicker);
  const switchProject = useStore((s) => s.switchProject);
  const resizeLeft = useStore((s) => s.resizeLeft);
  const resizeRight = useStore((s) => s.resizeRight);
  const resizeBottom = useStore((s) => s.resizeBottom);
  const groups = useStore((s) => s.groups);
  const activeGroupId = useStore((s) => s.activeGroupId);
  const resizeGroup = useStore((s) => s.resizeGroup);
  // Number of changed files, shown as a badge on the Version Control activity button.
  const gitChanged = useStore((s) => s.git.changed);
  const mergeModal = useStore((s) => s.mergeModal);

  const problemCount = useAllProblems().length;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [finder, setFinder] = useState<{ open: boolean; tab: SearchTab }>({ open: false, tab: 'files' });
  const [symbolOpen, setSymbolOpen] = useState(false);
  const openFinder = (tab: SearchTab) => setFinder({ open: true, tab });

  useEditorChrome();
  useLsp();

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    getHealth()
      .then((h) => setMeta({ hasApiKey: !!h.hasApiKey, model: h.model, projectRoot: h.projectRoot }))
      .catch(() => {});
    getAuthStatus().then(setAuth).catch(() => {});
    getShells()
      .then(({ shells, default: def }) => setShells(shells, def))
      .catch(() => {});
    getFonts()
      .then(({ fonts }) => setFonts(fonts))
      .catch(() => {});
    getProjects()
      .then((p) => setProjects(p.current, p.recents))
      .catch(() => {});
  }, [setMeta, setAuth, setShells, setFonts, setProjects]);

  // Keep the status-bar branch widget in sync with the active project.
  useEffect(() => {
    if (!projectRoot) return;
    gitStatus()
      .then((st) => {
        setGit({ repo: st.repo, branch: st.branch, ahead: st.ahead, behind: st.behind, changed: st.files.length, detached: st.detached });
        setGitFiles(st.files);
      })
      .catch(() => {});
  }, [projectRoot, gitRefreshSeq, setGit, setGitFiles]);

  // Refresh git when the window regains focus (catches changes made elsewhere).
  useEffect(() => {
    const onFocus = () => bumpGitRefresh();
    const onVis = () => document.visibilityState === 'visible' && bumpGitRefresh();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [bumpGitRefresh]);

  // Global shortcuts: the search modal opens on the Files tab (Cmd/Ctrl+P) or the
  // Text/content tab (Cmd/Ctrl+Shift+F). Either shortcut also flips the tab while the
  // modal is already open. (Ctrl/Cmd+K is left to Monaco, which uses it as a chord prefix.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        openFinder('files');
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        openFinder('content');
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        setSymbolOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="ide">
      {/* ---- title bar ---- */}
      <div className="titlebar">
        <div className="tb-left">
          <MainMenu
            onSettings={() => setSettingsOpen(true)}
            onSearch={() => openFinder('files')}
            onOpenFolder={openFolderPicker}
          />
          <ProjectMenu />
          <BranchWidget />
        </div>

        <div className="tb-center" />

        <div className="tb-right">
          <button className="tb-icon-btn" onClick={toggleRight} title="AI Assistant" aria-pressed={layout.rightOpen}>
            <IconAI size={17} />
          </button>
          <button className="tb-icon-btn" onClick={() => openFinder('files')} title="Search Everywhere (Ctrl P)">
            <IconSearch size={17} />
          </button>
          <button className="tb-icon-btn" onClick={() => setSettingsOpen(true)} title="Settings">
            <IconSettings size={17} />
          </button>
          <WindowControls />
        </div>
      </div>

      {/* ---- body ---- */}
      <div className="ide-body">
        <div className="activity-bar activity-left">
          <ActivityButton
            label="Project"
            active={layout.leftOpen && layout.leftView === 'project'}
            onClick={() => selectLeftView('project')}
          >
            <IconProject size={18} />
          </ActivityButton>
          <ActivityButton
            label="Find in Files (docked) — Ctrl Shift F for the search popup"
            active={layout.leftOpen && layout.leftView === 'search'}
            onClick={() => selectLeftView('search')}
          >
            <IconSearch size={18} />
          </ActivityButton>
          <ActivityButton
            label={`Version Control${gitChanged > 0 ? ` — ${gitChanged} changed file${gitChanged === 1 ? '' : 's'}` : ''}`}
            active={layout.leftOpen && layout.leftView === 'git'}
            onClick={() => selectLeftView('git')}
            badge={gitChanged}
          >
            <IconBranch size={18} />
          </ActivityButton>
          <div className="activity-spacer" />
          <ActivityButton label="Settings" active={false} onClick={() => setSettingsOpen(true)}>
            <IconSettings size={18} />
          </ActivityButton>
        </div>

        <div className={'ide-main' + (layout.bottomOpen ? '' : ' no-bottom')}>
          <div className="ide-panes">
            {layout.leftOpen && (
              <>
                <div className="tw tw-left" style={{ width: layout.leftW }}>
                  {layout.leftView === 'git' ? (
                    <GitPanel />
                  ) : layout.leftView === 'search' ? (
                    <FindInFiles />
                  ) : (
                    <FileExplorer />
                  )}
                </div>
                <Splitter orientation="v" onDelta={resizeLeft} />
              </>
            )}

            <div className="ide-editor">
              {groups.map((g, i) => (
                <Fragment key={g.id}>
                  {i > 0 && <Splitter orientation="v" onDelta={(d) => resizeGroup(i - 1, d)} />}
                  <EditorGroupView group={g} isActive={g.id === activeGroupId} />
                </Fragment>
              ))}
            </div>

            {layout.rightOpen && (
              <>
                <Splitter orientation="v" onDelta={(d) => resizeRight(-d)} />
                <div className="tw tw-right" style={{ width: layout.rightW }}>
                  <ChatPanel />
                </div>
              </>
            )}
          </div>

          {layout.bottomOpen && (
            <>
              <Splitter orientation="h" onDelta={(d) => resizeBottom(-d)} />
              <div className="tw tw-bottom" style={{ height: layout.bottomH }}>
                {/* Terminal stays mounted (its PTY sessions keep running) even when the
                    Run view is showing; Run can mount/unmount (its WS lives in runnerService). */}
                <div className="bottom-view" style={{ display: layout.bottomView === 'terminal' ? 'flex' : 'none' }}>
                  <TerminalPanel />
                </div>
                {layout.bottomView === 'run' && (
                  <div className="bottom-view">
                    <RunPanel />
                  </div>
                )}
                {layout.bottomView === 'docker' && (
                  <div className="bottom-view">
                    <DockerPanel />
                  </div>
                )}
                {layout.bottomView === 'database' && (
                  <div className="bottom-view">
                    <DbPanel />
                  </div>
                )}
                {layout.bottomView === 'problems' && (
                  <div className="bottom-view">
                    <ProblemsPanel />
                  </div>
                )}
              </div>
            </>
          )}

          <div className="bottom-bar">
            <button
              className={'bottom-btn' + (layout.bottomOpen && layout.bottomView === 'terminal' ? ' active' : '')}
              onClick={() => selectBottomView('terminal')}
              title="Terminal"
            >
              <IconTerminal size={15} />
              Terminal
            </button>
            <button
              className={'bottom-btn' + (layout.bottomOpen && layout.bottomView === 'run' ? ' active' : '')}
              onClick={() => selectBottomView('run')}
              title="Run"
            >
              <IconRun size={13} />
              Run
            </button>
            <button
              className={'bottom-btn' + (layout.bottomOpen && layout.bottomView === 'docker' ? ' active' : '')}
              onClick={() => selectBottomView('docker')}
              title="Docker"
            >
              <IconDocker size={14} />
              Docker
            </button>
            <button
              className={'bottom-btn' + (layout.bottomOpen && layout.bottomView === 'database' ? ' active' : '')}
              onClick={() => selectBottomView('database')}
              title="Database"
            >
              <IconDatabase size={14} />
              Database
            </button>
            <button
              className={'bottom-btn' + (layout.bottomOpen && layout.bottomView === 'problems' ? ' active' : '')}
              onClick={() => selectBottomView('problems')}
              title="Problems"
            >
              <IconWarning size={14} />
              Problems
              {problemCount > 0 && <span className="bottom-badge">{problemCount}</span>}
            </button>
          </div>
        </div>
      </div>

      <StatusBar />

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {finder.open && (
        <SearchModal
          tab={finder.tab}
          onTab={(tab) => setFinder((f) => ({ ...f, tab }))}
          onClose={() => setFinder((f) => ({ ...f, open: false }))}
        />
      )}
      {symbolOpen && <GoToSymbol onClose={() => setSymbolOpen(false)} />}
      {mergeModal && <MergeModal session={mergeModal} />}
      {folderPickerOpen && (
        <FolderPicker
          onClose={closeFolderPicker}
          onPick={(p) => {
            switchProject(p).catch((e) => alert('Could not open project: ' + (e as Error).message));
          }}
        />
      )}
    </div>
  );
}

function ActivityButton({
  label,
  active,
  onClick,
  children,
  badge,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: number;
}) {
  return (
    <button
      className={'activity-btn' + (active ? ' active' : '')}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      {children}
      {badge != null && badge > 0 && <span className="activity-badge">{badge > 99 ? '99+' : badge}</span>}
    </button>
  );
}
