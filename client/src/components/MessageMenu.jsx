import React from 'react';
import { QUICK_REACTIONS } from '../utils/emojis';

/**
 * Bottom-sheet action menu for a message (long-press / right-click).
 */
export default function MessageMenu({ message, isOwn, onClose, onAction }) {
  if (!message) return null;
  const m = message;
  const deleted = !!m.deletedForEveryone;

  const rows = [];
  if (!deleted) {
    rows.push({ key: 'reply', label: '↩️  Reply', action: () => onAction('reply', m) });
    if (m.kind === 'text' && m.text)
      rows.push({ key: 'copy', label: '📋  Copy', action: () => onAction('copy', m) });
  }
  if (isOwn && !deleted && m.kind === 'text')
    rows.push({ key: 'edit', label: '✏️  Edit', action: () => onAction('edit', m) });
  if (!deleted) {
    rows.push({ key: 'del-me', label: '🗑️  Delete for me', danger: true, action: () => onAction('delete-me', m) });
    if (isOwn)
      rows.push({ key: 'del-all', label: '🗑️  Delete for everyone', danger: true, action: () => onAction('delete-everyone', m) });
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-sm animate-fade-in rounded-t-2xl bg-ink-850 p-3 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {!deleted && (
          <div className="mb-2 flex justify-center gap-2 border-b border-ink-700 pb-3">
            {QUICK_REACTIONS.map((e) => (
              <button
                key={e}
                onClick={() => onAction('react', m, e)}
                className="rounded-full p-2 text-2xl hover:bg-ink-700"
              >
                {e}
              </button>
            ))}
          </div>
        )}
        {rows.map((r) => (
          <button
            key={r.key}
            onClick={r.action}
            className={`block w-full rounded-lg px-4 py-3 text-left text-[15px] hover:bg-ink-700 ${
              r.danger ? 'text-red-400' : 'text-gray-100'
            }`}
          >
            {r.label}
          </button>
        ))}
        <button
          onClick={onClose}
          className="mt-1 block w-full rounded-lg bg-ink-700 px-4 py-3 text-center text-[15px] font-semibold text-gray-200"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
