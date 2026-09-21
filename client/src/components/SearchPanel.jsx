import React, { useState } from 'react';
import { api } from '../utils/api';
import { fmtTime } from '../utils/format';
import { useToasts } from '../context/ToastContext';

/** In-chat message search: input + results, click to jump & highlight. */
export default function SearchPanel({ convId, onJump, onClose }) {
  const { push } = useToasts();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const doSearch = async () => {
    const q = query.trim();
    if (q.length < 2 || searching) return;
    setSearching(true);
    try {
      const list = await api.get(
        `/api/conversations/${convId}/search?q=${encodeURIComponent(q)}`
      );
      setResults(Array.isArray(list) ? list : list?.messages || []);
      setSearched(true);
    } catch (e) {
      push({ kind: 'error', title: 'Search failed', body: e.message });
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="animate-fade-in border-b border-ink-700 bg-ink-900">
      <div className="flex items-center gap-2 px-3 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch()}
          placeholder="Search messages…"
          autoFocus
          className="flex-1 rounded-xl border border-ink-700 bg-ink-800 px-4 py-2 text-sm"
        />
        <button
          onClick={doSearch}
          disabled={searching}
          className="rounded-xl bg-mint-400 px-3 py-2 text-sm font-semibold text-ink-950 disabled:opacity-50"
        >
          {searching ? '…' : 'Go'}
        </button>
        <button onClick={onClose} className="p-1 text-xl text-gray-400" aria-label="Close search">
          ✕
        </button>
      </div>
      {searched && (
        <div className="max-h-56 overflow-y-auto border-t border-ink-800">
          {results.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-500">No messages found.</div>
          ) : (
            results.map((m) => (
              <button
                key={m.id}
                onClick={() => onJump(m)}
                className="flex w-full items-center gap-3 border-b border-ink-800/60 px-4 py-2.5 text-left hover:bg-ink-800"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-mint-400">
                    {m.senderDisplayName || 'Message'}
                  </div>
                  <div className="truncate text-sm text-gray-200">
                    {m.kind === 'image' ? '📷 Photo' : m.kind === 'file' ? `📎 ${m.file?.filename || 'File'}` : m.text}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-gray-500">{fmtTime(m.createdAt)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
