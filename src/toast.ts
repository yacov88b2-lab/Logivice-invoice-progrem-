type ToastType = 'error' | 'success' | 'info';

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
let nextId = 1;
let listeners: Listener[] = [];
let bugReportCallback: ((message: string) => void) | null = null;

function notify() {
  listeners.forEach(l => l([...toasts]));
}

export const toast = {
  error(message: string) {
    const t: Toast = { id: nextId++, type: 'error', message };
    toasts = [...toasts, t];
    notify();
    setTimeout(() => toast.dismiss(t.id), 8000);
  },
  success(message: string) {
    const t: Toast = { id: nextId++, type: 'success', message };
    toasts = [...toasts, t];
    notify();
    setTimeout(() => toast.dismiss(t.id), 4000);
  },
  info(message: string) {
    const t: Toast = { id: nextId++, type: 'info', message };
    toasts = [...toasts, t];
    notify();
    setTimeout(() => toast.dismiss(t.id), 4000);
  },
  dismiss(id: number) {
    toasts = toasts.filter(t => t.id !== id);
    notify();
  },
  subscribe(listener: Listener) {
    listeners.push(listener);
    return () => { listeners = listeners.filter(l => l !== listener); };
  },
  onReportBug(cb: (message: string) => void) {
    bugReportCallback = cb;
  },
  reportBug(message: string) {
    bugReportCallback?.(message);
  },
};
