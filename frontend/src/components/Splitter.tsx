import { useCallback } from 'react';

interface SplitterProps {
  orientation: 'v' | 'h';
  /** Called with the incremental pointer delta (px) along the splitter axis. */
  onDelta: (delta: number) => void;
}

/** A draggable divider between tool windows / the editor (JetBrains-style). */
export function Splitter({ orientation, onDelta }: SplitterProps) {
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const axis = orientation === 'v' ? 'clientX' : 'clientY';
      let last = e[axis];
      const move = (ev: PointerEvent) => {
        const cur = ev[axis];
        onDelta(cur - last);
        last = cur;
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      document.body.style.cursor = orientation === 'v' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [orientation, onDelta]
  );

  return <div className={`splitter ${orientation}`} onPointerDown={onPointerDown} />;
}
