import { useEffect, useRef } from 'react';
import { useDockerStore } from '../lib/dockerStore';
import { startDockerLogs, stopDockerLogs } from '../lib/dockerLogsService';
import { DockerInspectView } from './docker/DockerInspectView';
import { DockerExecView } from './docker/DockerExecView';
import {
  dockerStatus,
  dockerContainers,
  dockerImages,
  dockerStartContainer,
  dockerStopContainer,
  dockerRestartContainer,
  dockerRemoveContainer,
  dockerRemoveImage,
} from '../api';
import { IconRun, IconStop, IconRefresh, IconTrash, IconTerminal, IconClose, IconInfo, IconLogs } from './icons';

const POLL_MS = 5000;

/** Docker tool window: containers + images, start/stop/restart/remove, an
 *  inspect (detail) view, an interactive exec terminal, and a streamed
 *  `docker logs -f` view — a lightweight "Docker Desktop" panel that shells
 *  out to the `docker` CLI via the Rust core (see core/src/docker/mod.rs). */
export function DockerPanel() {
  const view = useDockerStore((s) => s.view);
  const status = useDockerStore((s) => s.status);
  const containers = useDockerStore((s) => s.containers);
  const images = useDockerStore((s) => s.images);
  const loading = useDockerStore((s) => s.loading);
  const error = useDockerStore((s) => s.error);
  const busyId = useDockerStore((s) => s.busyId);
  const logsContainerId = useDockerStore((s) => s.logsContainerId);
  const logs = useDockerStore((s) => s.logs);
  const logsStreaming = useDockerStore((s) => s.logsStreaming);
  const inspectContainerId = useDockerStore((s) => s.inspectContainerId);
  const execContainerId = useDockerStore((s) => s.execContainerId);
  const setView = useDockerStore((s) => s.setView);
  const setStatus = useDockerStore((s) => s.setStatus);
  const setContainers = useDockerStore((s) => s.setContainers);
  const setImages = useDockerStore((s) => s.setImages);
  const setLoading = useDockerStore((s) => s.setLoading);
  const setError = useDockerStore((s) => s.setError);
  const setBusy = useDockerStore((s) => s.setBusy);
  const openLogs = useDockerStore((s) => s.openLogs);
  const closeLogs = useDockerStore((s) => s.closeLogs);
  const openInspect = useDockerStore((s) => s.openInspect);
  const openExec = useDockerStore((s) => s.openExec);
  const closeExec = useDockerStore((s) => s.closeExec);

  const refresh = async () => {
    setLoading(true);
    try {
      const st = await dockerStatus();
      setStatus(st);
      if (st.running) {
        const [c, i] = await Promise.all([dockerContainers(), dockerImages()]);
        setContainers(c);
        setImages(i);
        setError(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open/close the log stream whenever the selected container changes.
  useEffect(() => {
    if (logsContainerId) startDockerLogs(logsContainerId);
    return () => stopDockerLogs();
  }, [logsContainerId]);

  const outRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  const runAction = async (id: string, fn: (id: string) => Promise<unknown>) => {
    setBusy(id);
    try {
      await fn(id);
      await refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (execContainerId) {
    const c = containers.find((x) => x.id === execContainerId);
    return <DockerExecView id={execContainerId} name={c?.name ?? execContainerId} onClose={closeExec} />;
  }

  if (inspectContainerId) {
    const c = containers.find((x) => x.id === inspectContainerId);
    return <DockerInspectView id={inspectContainerId} name={c?.name ?? inspectContainerId} />;
  }

  if (logsContainerId) {
    const c = containers.find((x) => x.id === logsContainerId);
    return (
      <div className="docker-panel">
        <div className="tw-header">
          <button className="icon-btn" title="Back" onClick={closeLogs}>
            <IconClose size={15} />
          </button>
          <span className="tw-title">Logs — {c?.name ?? logsContainerId}</span>
          <div className="tw-actions">{logsStreaming && <span className="docker-live-dot" title="Streaming" />}</div>
        </div>
        <pre className="docker-logs" ref={outRef}>
          {logs || (logsStreaming ? '' : 'No log output yet.')}
        </pre>
      </div>
    );
  }

  return (
    <div className="docker-panel">
      <div className="tw-header">
        <span className="tw-title">Docker</span>
        <div className="docker-tabs">
          <button className={view === 'containers' ? 'active' : ''} onClick={() => setView('containers')}>
            Containers{containers.length > 0 && <span className="docker-count">{containers.length}</span>}
          </button>
          <button className={view === 'images' ? 'active' : ''} onClick={() => setView('images')}>
            Images{images.length > 0 && <span className="docker-count">{images.length}</span>}
          </button>
        </div>
        <div className="tw-actions">
          <button className="icon-btn" title="Refresh" onClick={refresh} disabled={loading}>
            <IconRefresh size={15} />
          </button>
        </div>
      </div>

      {status && !status.installed && <div className="docker-banner">Docker CLI not found. Install Docker to use this panel.</div>}
      {status && status.installed && !status.running && <div className="docker-banner">Docker daemon is not running.</div>}
      {error && status?.running && <div className="docker-banner error">{error}</div>}

      {status?.running && view === 'containers' && (
        <div className="docker-list">
          {containers.length === 0 ? (
            <div className="docker-empty">No containers yet.</div>
          ) : (
            containers.map((c) => (
              <div className="docker-row" key={c.id}>
                <span className={'docker-state-dot ' + c.state} title={c.state} />
                <div className="docker-row-main">
                  <span className="docker-row-name">{c.name}</span>
                  <span className="docker-row-sub">
                    {c.image} · {c.status}
                    {c.ports ? ` · ${c.ports}` : ''}
                  </span>
                </div>
                <div className="docker-row-actions">
                  {c.state === 'running' ? (
                    <button className="icon-btn" title="Stop" disabled={busyId === c.id} onClick={() => runAction(c.id, dockerStopContainer)}>
                      <IconStop size={14} />
                    </button>
                  ) : (
                    <button className="icon-btn" title="Start" disabled={busyId === c.id} onClick={() => runAction(c.id, dockerStartContainer)}>
                      <IconRun size={14} />
                    </button>
                  )}
                  <button className="icon-btn" title="Restart" disabled={busyId === c.id} onClick={() => runAction(c.id, dockerRestartContainer)}>
                    <IconRefresh size={14} />
                  </button>
                  <button className="icon-btn" title="Inspect" onClick={() => openInspect(c.id)}>
                    <IconInfo size={14} />
                  </button>
                  {c.state === 'running' && (
                    <button className="icon-btn" title="Execute shell in container" onClick={() => openExec(c.id)}>
                      <IconTerminal size={14} />
                    </button>
                  )}
                  <button className="icon-btn" title="View logs" onClick={() => openLogs(c.id)}>
                    <IconLogs size={14} />
                  </button>
                  <button
                    className="icon-btn danger"
                    title="Remove"
                    disabled={busyId === c.id}
                    onClick={() => confirm(`Remove container "${c.name}"?`) && runAction(c.id, dockerRemoveContainer)}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {status?.running && view === 'images' && (
        <div className="docker-list">
          {images.length === 0 ? (
            <div className="docker-empty">No images yet.</div>
          ) : (
            images.map((img) => (
              <div className="docker-row" key={img.id}>
                <div className="docker-row-main">
                  <span className="docker-row-name">
                    {img.repository}:{img.tag}
                  </span>
                  <span className="docker-row-sub">
                    {img.id.replace('sha256:', '').slice(0, 12)} · {img.size} · {img.createdSince}
                  </span>
                </div>
                <div className="docker-row-actions">
                  <button
                    className="icon-btn danger"
                    title="Remove"
                    disabled={busyId === img.id}
                    onClick={() => confirm(`Remove image "${img.repository}:${img.tag}"?`) && runAction(img.id, dockerRemoveImage)}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
