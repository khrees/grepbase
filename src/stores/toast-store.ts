import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  durationMs: number;
}

interface ToastState {
  toast: Toast | null;
  fireToast: (message: string, kind?: ToastKind, durationMs?: number) => void;
  dismiss: () => void;
}

let nextId = 0;

export const useToastStore = create<ToastState>((set) => ({
  toast: null,

  fireToast: (message, kind = 'info', durationMs = 2800) => {
    const id = ++nextId;
    set({ toast: { id, message, kind, durationMs: Math.max(1200, durationMs) } });
  },

  dismiss: () => {
    set({ toast: null });
  },
}));

/**
 * Convenience function for firing toasts outside of React components.
 * Drop-in replacement for the old CustomEvent-based `fireToast`.
 */
export function fireToast(message: string, kind: ToastKind = 'info', durationMs?: number) {
  useToastStore.getState().fireToast(message, kind, durationMs);
}
