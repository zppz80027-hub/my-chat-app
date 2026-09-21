import React from 'react';
import { useToasts } from '../context/ToastContext';

const KIND_STYLES = {
  info: 'border-ink-700 bg-ink-800',
  error: 'border-red-900 bg-red-950',
  success: 'border-emerald-900 bg-emerald-950',
};

export default function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-[100] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => {
            dismiss(t.id);
            if (t.onClick) t.onClick();
          }}
          className={`pointer-events-auto w-full max-w-sm animate-fade-in rounded-xl border px-4 py-3 text-left shadow-xl ${
            KIND_STYLES[t.kind] || KIND_STYLES.info
          }`}
        >
          <div className="text-sm font-semibold text-gray-100">{t.title}</div>
          {t.body && <div className="mt-0.5 line-clamp-2 text-xs text-gray-400">{t.body}</div>}
        </button>
      ))}
    </div>
  );
}
