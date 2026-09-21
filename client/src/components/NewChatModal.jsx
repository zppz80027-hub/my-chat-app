import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useSocket } from '../context/SocketContext';
import { useChat } from '../context/ChatContext';
import { useToasts } from '../context/ToastContext';
import Avatar from './Avatar';

export default function NewChatModal({ onClose, onCreated }) {
  const { isOnline } = useSocket();
  const { refreshConversations } = useChat();
  const { push } = useToasts();
  const [mode, setMode] = useState('dm'); // 'dm' | 'group'
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [groupName, setGroupName] = useState('');
  const [picked, setPicked] = useState(new Set());
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api
      .get('/api/contacts')
      .then((list) => setContacts(Array.isArray(list) ? list : []))
      .catch(() => setContacts([]))
      .finally(() => setLoading(false));
  }, []);

  const q = search.trim().toLowerCase();
  const visible = q
    ? contacts.filter(
        (c) =>
          c.displayName?.toLowerCase().includes(q) ||
          c.username?.toLowerCase().includes(q)
      )
    : contacts;

  const togglePick = (id) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createDm = async (memberId) => {
    setCreating(true);
    try {
      const conv = await api.post('/api/conversations', { type: 'dm', memberId });
      await refreshConversations();
      onCreated(conv.id || conv.conversation?.id);
    } catch (e) {
      push({ kind: 'error', title: 'Could not start chat', body: e.message });
    } finally {
      setCreating(false);
    }
  };

  const createGroup = async () => {
    if (!groupName.trim()) {
      push({ kind: 'info', title: 'Name your group' });
      return;
    }
    if (picked.size === 0) {
      push({ kind: 'info', title: 'Pick at least one member' });
      return;
    }
    setCreating(true);
    try {
      const conv = await api.post('/api/conversations', {
        type: 'group',
        name: groupName.trim(),
        memberIds: [...picked],
      });
      await refreshConversations();
      onCreated(conv.id || conv.conversation?.id);
    } catch (e) {
      push({ kind: 'error', title: 'Could not create group', body: e.message });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative flex max-h-[85vh] w-full max-w-md animate-fade-in flex-col rounded-t-2xl bg-ink-900 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <span className="text-base font-semibold">New chat</span>
          <button onClick={onClose} className="p-1 text-2xl text-gray-400" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex gap-2 px-4 pt-3">
          {['dm', 'group'].map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded-xl py-2 text-sm font-semibold ${
                mode === m ? 'bg-mint-400 text-ink-950' : 'bg-ink-800 text-gray-300'
              }`}
            >
              {m === 'dm' ? 'Direct message' : 'Group'}
            </button>
          ))}
        </div>

        {mode === 'group' && (
          <div className="px-4 pt-3">
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Group name"
              maxLength={60}
              className="w-full rounded-xl border border-ink-700 bg-ink-800 px-4 py-2.5 text-sm"
            />
            {picked.size > 0 && (
              <div className="mt-2 text-xs text-gray-400">
                {picked.size} member{picked.size > 1 ? 's' : ''} selected
              </div>
            )}
          </div>
        )}

        <div className="px-4 pt-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts…"
            className="w-full rounded-xl border border-ink-700 bg-ink-800 px-4 py-2.5 text-sm"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="p-4 text-center text-sm text-gray-500">Loading contacts…</div>
          ) : visible.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">
              No contacts yet. Add people from the Contacts tab first.
            </div>
          ) : (
            visible.map((c) => (
              <button
                key={c.id}
                onClick={() => (mode === 'dm' ? createDm(c.id) : togglePick(c.id))}
                disabled={creating}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-ink-800"
              >
                <Avatar name={c.displayName} src={c.avatarUrl} size={44} online={isOnline(c.id)} />
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-[15px] text-gray-100">{c.displayName}</span>
                  <span className="block truncate text-xs text-gray-500">@{c.username}</span>
                </span>
                {mode === 'group' && (
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                      picked.has(c.id) ? 'border-mint-400 bg-mint-400 text-ink-950' : 'border-gray-600'
                    }`}
                  >
                    {picked.has(c.id) ? '✓' : ''}
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        {mode === 'group' && (
          <div className="border-t border-ink-700 p-4">
            <button
              onClick={createGroup}
              disabled={creating}
              className="w-full rounded-xl bg-mint-400 py-3 text-[15px] font-semibold text-ink-950 disabled:opacity-50"
            >
              {creating ? 'Creating…' : `Create group${picked.size ? ` (${picked.size})` : ''}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
