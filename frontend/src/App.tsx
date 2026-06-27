import { useEffect, useState } from 'react';
import { useStore } from './store';
import { getHealth, getShells, getAuthStatus, getFonts, getProjects, gitStatus } from './api';
import { applyTheme } from './theme';
import { FileExplorer } from './components/FileExplorer';
import { EditorPane } from './components/EditorPane';
import { ChatPanel } from './components/ChatPanel';
import { TerminalPanel } from './components/TerminalPanel';
import { Splitter } from './components/Splitter';
import { StatusBar } from './components/StatusBar';
import { SettingsPanel } from './components/SettingsPanel';
import { SearchEverywhere } from './components/SearchEverywhere';
import { ProjectMenu } from './components/ProjectMenu';
import { GitPanel } from './components/GitPanel';
import { MainMenu } from './components/MainMenu';
import { BranchWidget } from './components/BranchWidget';
import { FolderPicker } from './components/FolderPicker';
import { IconProject, IconSearch, IconSettings, IconAI, IconTerminal, IconBranch } from './components/icons';

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
  const toggleBottom = useStore((s) => s.toggleBottom);
  const folderPickerOpen = useStore((s) => s.folderPickerOpen);
  const openFolderPicker = useStore((s) => s.openFolderPicker);
  const closeFolderPicker = useStore((s) => s.closeFolderPicker);
  const switchProject = useStore((s) => s.switchProject);
  const resizeLeft = useStore((s) => s.resizeLeft);
  const resizeRight = useStore((s) => s.resizeRight);
  const resizeBottom = useStore((s) => s.resizeBottom);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [finderOpen, setFinderOpen] = useState(false);

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
  }, []);

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

  // Global shortcut: Cmd/Ctrl+P opens Search Everywhere (quick file open).
  // (Ctrl/Cmd+K is left to Monaco, which uses it as a chord prefix.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setFinderOpen(true);
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
            onSearch={() => setFinderOpen(true)}
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
          <button className="tb-icon-btn" onClick={() => setFinderOpen(true)} title="Search Everywhere (Ctrl P)">
            <IconSearch size={17} />
          </button>
          <button className="tb-icon-btn" onClick={() => setSettingsOpen(true)} title="Settings">
            <IconSettings size={17} />
          </button>
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
            label="Version Control"
            active={layout.leftOpen && layout.leftView === 'git'}
            onClick={() => selectLeftView('git')}
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
                  {layout.leftView === 'git' ? <GitPanel /> : <FileExplorer />}
                </div>
                <Splitter orientation="v" onDelta={resizeLeft} />
              </>
            )}

            <div className="ide-editor">
              <EditorPane />
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
                <TerminalPanel />
              </div>
            </>
          )}

          <div className="bottom-bar">
            <button
              className={'bottom-btn' + (layout.bottomOpen ? ' active' : '')}
              onClick={toggleBottom}
              title="Toggle Terminal"
            >
              <IconTerminal size={15} />
              Terminal
            </button>
          </div>
        </div>

        <div className="activity-bar activity-right">
          <ActivityButton label="AI Assistant" active={layout.rightOpen} onClick={toggleRight}>
            <IconAI size={18} />
          </ActivityButton>
        </div>
      </div>

      <StatusBar />

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {finderOpen && <SearchEverywhere onClose={() => setFinderOpen(false)} />}
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
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
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
    </button>
  );
}
