import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useSocket } from '../context/SocketContext';
import { useChat } from '../context/ChatContext';
import { useToasts } from '../context/ToastContext';
import Avatar from '../components/Avatar';
import { ListSkeleton, EmptyState } from '../components/States';

export default function ContactsPage({ onOpenChat }) {
  const { isOnline } = useSocket();
  const { refreshConversations } = useChat();
  const { push } = useToasts();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [contactIds, setContactIds] = useState(new Set());

  const loadContacts = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.get('/api/contacts');
      const arr = Array.isArray(list) ? list : [];
      setContacts(arr);
      setContactIds(new Set(arr.map((c) => c.id)));
    } catch (e) {
      push({ kind: 'error', title: 'Could not load contacts', body: e.message });
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  // Debounced user search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const list = await api.get(`/api/users/search?q=${encodeURIComponent(q)}`);
        setResults(Array.isArray(list) ? list : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  const addContact = async (u) => {
    try {
      await api.post('/api/contacts', { userId: u.id });
      push({ kind: 'success', title: `Added ${u.displayName}` });
      loadContacts();
    } catch (e) {
      push({ kind: 'error', title: 'Could not add contact', body: e.message });
    }
  };

  const removeContact = async (u) => {
    if (!window.confirm(`Remove ${u.displayName} from contacts?`)) return;
    try {
      await api.del(`/api/contacts/${u.id}`);
      loadContacts();
    } catch (e) {
      push({ kind: 'error', title: 'Could not remove contact', body: e.message });
    }
  };

  const openDm = async (userId) => {
    try {
      const conv = await api.post('/api/conversations', { type: 'dm', memberId: userId });
      await refreshConversations();
      onOpenChat(conv.id || conv.conversation?.id);
    } catch (e) {
      push({ kind: 'error', title: 'Could not open chat', body: e.message });
    }
  };

  const row = (u, action) => (
    <div key={u.id} className="flex items-center gap-3 px-3 py-2.5">
      <button onClick={() => openDm(u.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <Avatar name={u.displayName} src={u.avatarUrl} size={48} online={isOnline(u.id)} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] text-gray-100">{u.displayName}</span>
          <span className="block truncate text-xs text-gray-500">
            @{u.username}
            {u.about ? ` · ${u.about}` : ''}
          </span>
        </span>
      </button>
      {action}
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pb-2 pt-1">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people by username…"
          className="w-full rounded-xl border border-ink-700 bg-ink-800 px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500"
        />
      </div>

      <div className="flex-1 overflow-y-auto pb-24 md:pb-4">
        {query.trim().length >= 2 && (
          <div className="mb-2">
            <div className="px-4 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              People {searching && '· searching…'}
            </div>
            {results.length === 0 && !searching ? (
              <div className="px-4 py-3 text-sm text-gray-500">No users found.</div>
            ) : (
              results.map((u) =>
                row(
                  u,
                  contactIds.has(u.id) ? (
                    <span className="shrink-0 text-xs text-gray-500">Added</span>
                  ) : (
                    <button
                      onClick={() => addContact(u)}
                      className="shrink-0 rounded-lg bg-mint-400 px-3 py-1.5 text-xs font-semibold text-ink-950"
                    >
                      Add
                    </button>
                  )
                )
              )
            )}
          </div>
        )}

        <div className="px-4 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
          My contacts
        </div>
        {loading ? (
          <ListSkeleton rows={5} />
        ) : contacts.length === 0 ? (
          <EmptyState
            icon="👥"
            title="No contacts yet"
            body="Search for people above and add them to start chatting."
          />
        ) : (
          contacts.map((u) =>
            row(
              u,
              <button
                onClick={() => removeContact(u)}
                className="shrink-0 rounded-lg px-2 py-1 text-xs text-red-400 hover:bg-ink-800"
                aria-label={`Remove ${u.displayName}`}
              >
                ✕
              </button>
            )
          )
        )}
      </div>
    </div>
  );
}
