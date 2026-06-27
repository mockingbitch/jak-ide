import { useState } from 'react';

interface CounterProps {
  initial?: number;
  step?: number;
}

export function Counter({ initial = 0, step = 1 }: CounterProps) {
  const [count, setCount] = useState(initial);
  return (
    <div className="counter">
      <button onClick={() => setCount((c) => c - step)}>-</button>
      <span>{count}</span>
      <button onClick={() => setCount((c) => c + step)}>+</button>
    </div>
  );
}
