import { useEffect } from 'react';
import { useDockerStore } from '../../lib/dockerStore';
import { dockerInspectContainer } from '../../api';
import { IconClose } from '../icons';

const NEVER_FINISHED = '0001-01-01T00:00:00Z'; // Go's zero time — Docker's "not applicable" sentinel

/** `docker inspect` detail view for one container — read-only, fetched once per open. */
export function DockerInspectView({ id, name }: { id: string; name: string }) {
  const detail = useDockerStore((s) => s.inspectDetail);
  const loading = useDockerStore((s) => s.inspectLoading);
  const error = useDockerStore((s) => s.inspectError);
  const closeInspect = useDockerStore((s) => s.closeInspect);
  const setInspectDetail = useDockerStore((s) => s.setInspectDetail);
  const setInspectError = useDockerStore((s) => s.setInspectError);

  useEffect(() => {
    let cancelled = false;
    dockerInspectContainer(id)
      .then((d) => {
        if (!cancelled) setInspectDetail(d);
      })
      .catch((e) => {
        if (!cancelled) setInspectError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [id, setInspectDetail, setInspectError]);

  return (
    <div className="docker-panel">
      <div className="tw-header">
        <button className="icon-btn" title="Back" onClick={closeInspect}>
          <IconClose size={15} />
        </button>
        <span className="tw-title">Inspect — {name}</span>
      </div>
      <div className="docker-inspect-body">
        {loading && <div className="docker-empty">Loading…</div>}
        {error && <div className="docker-banner error">{error}</div>}
        {detail && (
          <>
            <Row label="ID" value={detail.id} mono />
            <Row label="Image" value={detail.image} />
            <Row label="Command" value={detail.command} mono />
            <Row label="State" value={detail.state} />
            <Row label="Created" value={detail.created} />
            <Row label="Started" value={detail.startedAt} />
            {detail.finishedAt !== NEVER_FINISHED && <Row label="Finished" value={detail.finishedAt} />}
            <Row label="Restarts" value={String(detail.restartCount)} />
            <Row label="Platform" value={detail.platform} />
            <Row label="IP address" value={detail.ipAddress} mono />
            <ListSection label="Ports" items={detail.ports} />
            <ListSection label="Networks" items={detail.networks} />
            <ListSection label="Mounts" items={detail.mounts} />
            <ListSection label="Env" items={detail.env} />
            <ListSection label="Labels" items={detail.labels} />
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="docker-inspect-row">
      <span className="docker-inspect-label">{label}</span>
      <span className={mono ? 'docker-inspect-value mono' : 'docker-inspect-value'}>{value}</span>
    </div>
  );
}

function ListSection({ label, items }: { label: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="docker-inspect-section">
      <span className="docker-inspect-label">{label}</span>
      <ul className="docker-inspect-list">
        {items.map((it) => (
          <li key={it}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
