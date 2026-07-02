import { TerminalInstance } from '../TerminalInstance';
import { IconClose } from '../icons';

/** Interactive `docker exec -it` session for one container, reusing the same
 *  xterm/PTY wiring as the local Terminal feature (TerminalInstance) pointed
 *  at the docker-exec WebSocket instead of `/ws/terminal`. */
export function DockerExecView({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  return (
    <div className="docker-panel">
      <div className="tw-header">
        <button className="icon-btn" title="Back" onClick={onClose}>
          <IconClose size={15} />
        </button>
        <span className="tw-title">Exec — {name}</span>
      </div>
      <div className="docker-exec-body">
        <TerminalInstance key={id} wsPath={`/ws/docker/exec/${encodeURIComponent(id)}`} visible />
      </div>
    </div>
  );
}
