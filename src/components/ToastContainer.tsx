import { useEffect, useState } from 'react';
import { toast, type Toast } from '../toast';

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => toast.subscribe(setToasts), []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-16 right-5 z-50 flex flex-col gap-2 w-80">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`rounded-lg border shadow-lg p-3 text-sm flex gap-2 items-start ${
            t.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : t.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-slate-200 bg-white text-slate-800'
          }`}
        >
          <div className="flex-1 leading-snug">{t.message}</div>
          <div className="flex flex-col gap-1 shrink-0">
            {t.type === 'error' && (
              <button
                onClick={() => { toast.reportBug(t.message); toast.dismiss(t.id); }}
                className="rounded bg-red-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-red-700 whitespace-nowrap"
              >
                Report Bug
              </button>
            )}
            <button
              onClick={() => toast.dismiss(t.id)}
              className="rounded border border-current px-2 py-0.5 text-xs font-semibold opacity-60 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
