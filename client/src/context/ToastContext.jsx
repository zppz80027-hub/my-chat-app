import React, { createContext, useCallback, useContext, useState } from 'react';

const ToastContext = createContext(null);

let toastSeq = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast) => {
      const id = toastSeq++;
      const entry = { id, kind: 'info', duration: 4000, ...toast };
      setToasts((prev) => [...prev.slice(-2), entry]);
      if (entry.duration > 0) {
        setTimeout(() => dismiss(id), entry.duration);
      }
      return id;
    },
    [dismiss]
  );

  const value = { toasts, push, dismiss };
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToasts() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToasts must be used inside ToastProvider');
  return ctx;
}
