import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  readonly id: number;
  readonly kind: ToastKind;
  readonly message: string;
}

interface ToastState {
  toasts: readonly Toast[];
  /** Show a toast; it auto-dismisses after `ttl` ms (default 3500). */
  push: (kind: ToastKind, message: string, ttl?: number) => void;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, message, ttl = 3500) => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => get().dismiss(id), ttl);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Fire-and-forget helper for non-React call sites. */
export const toast = (kind: ToastKind, message: string, ttl?: number) =>
  useToastStore.getState().push(kind, message, ttl);
