import { create } from 'zustand';
import type { DockerContainer, DockerContainerDetail, DockerImage, DockerStatus } from '../types';

export type DockerView = 'containers' | 'images';

/** Docker tool window state. Containers/images are live server data (re-fetched,
 *  never persisted); only the active tab and detail-view state live here so the
 *  panel keeps its place across renders (the log WebSocket itself lives in
 *  dockerLogsService, tied to the panel's mount, not the store; the exec
 *  terminal's WebSocket similarly lives inside its own TerminalInstance).
 *  At most one of logs/inspect/exec is open at a time — opening one closes
 *  the others. */
interface DockerState {
  view: DockerView;
  status: DockerStatus | null;
  containers: readonly DockerContainer[];
  images: readonly DockerImage[];
  loading: boolean;
  error: string | null;
  busyId: string | null; // container/image id with an action in flight

  logsContainerId: string | null; // non-null → showing the log-stream view for this container
  logs: string;
  logsStreaming: boolean;

  inspectContainerId: string | null; // non-null → showing container details for this container
  inspectDetail: DockerContainerDetail | null;
  inspectLoading: boolean;
  inspectError: string | null;

  execContainerId: string | null; // non-null → showing an interactive exec terminal for this container

  setView: (v: DockerView) => void;
  setStatus: (s: DockerStatus) => void;
  setContainers: (c: DockerContainer[]) => void;
  setImages: (i: DockerImage[]) => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
  setBusy: (id: string | null) => void;

  openLogs: (id: string) => void;
  closeLogs: () => void;
  appendLog: (data: string) => void;
  setLogsStreaming: (b: boolean) => void;

  openInspect: (id: string) => void;
  closeInspect: () => void;
  setInspectDetail: (d: DockerContainerDetail) => void;
  setInspectLoading: (b: boolean) => void;
  setInspectError: (e: string | null) => void;

  openExec: (id: string) => void;
  closeExec: () => void;
}

const LOG_CAP = 1_000_000; // keep at most ~1MB of streamed log text

export const useDockerStore = create<DockerState>((set) => ({
  view: 'containers',
  status: null,
  containers: [],
  images: [],
  loading: false,
  error: null,
  busyId: null,

  logsContainerId: null,
  logs: '',
  logsStreaming: false,

  inspectContainerId: null,
  inspectDetail: null,
  inspectLoading: false,
  inspectError: null,

  execContainerId: null,

  setView: (view) => set({ view }),
  setStatus: (status) => set({ status }),
  setContainers: (containers) => set({ containers }),
  setImages: (images) => set({ images }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setBusy: (busyId) => set({ busyId }),

  openLogs: (id) =>
    set({ logsContainerId: id, logs: '', logsStreaming: false, inspectContainerId: null, execContainerId: null }),
  closeLogs: () => set({ logsContainerId: null, logs: '', logsStreaming: false }),
  appendLog: (data) =>
    set((s) => {
      let logs = s.logs + data;
      if (logs.length > LOG_CAP) logs = '…(truncated)…\n' + logs.slice(logs.length - LOG_CAP);
      return { logs };
    }),
  setLogsStreaming: (logsStreaming) => set({ logsStreaming }),

  openInspect: (id) =>
    set({
      inspectContainerId: id,
      inspectDetail: null,
      inspectLoading: true,
      inspectError: null,
      logsContainerId: null,
      execContainerId: null,
    }),
  closeInspect: () => set({ inspectContainerId: null, inspectDetail: null, inspectError: null }),
  setInspectDetail: (inspectDetail) => set({ inspectDetail, inspectLoading: false }),
  setInspectLoading: (inspectLoading) => set({ inspectLoading }),
  setInspectError: (inspectError) => set({ inspectError, inspectLoading: false }),

  openExec: (id) => set({ execContainerId: id, logsContainerId: null, inspectContainerId: null }),
  closeExec: () => set({ execContainerId: null }),
}));
