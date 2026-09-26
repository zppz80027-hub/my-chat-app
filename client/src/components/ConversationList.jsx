import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useChat } from '../context/ChatContext';
import { fmtListTime } from '../utils/format';
import Avatar from './Avatar';
import { ListSkeleton, EmptyState } from './States';

function dmPeer(conv, myId) {
  return (conv.members || []).find((m) => m.id !== myId) || null;
}

// Chats tab khali ho to yahin sab log dikhao — tap karte hi seedha chat khule.
function StartChatting({ onSelect }) {
  const { isOnline } = useSocket();
  const { refreshConversations } = useChat();
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/api/users')
      .then((list) => {
        if (!cancelled) setPeople(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setPeople([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openDm = async (userId) => {
    try {
      const conv = await api.post('/api/conversations', { type: 'dm', memberId: userId });
      await refreshConversations();
      onSelect(conv.id || conv.conversation?.id);
    } catch {
      /* silent — row stays for retry */
    }
  };

  if (loading) return <ListSkeleton rows={5} />;

  return (
    <div className="flex-1 overflow-y-auto pb-24 md:pb-4">
      <div className="px-4 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Tap anyone to start chatting
      </div>
      {people.length === 0 ? (
        <EmptyState
          icon="💬"
          title="No people yet"
          body="Ask your friend to open the app once — their name will appear here."
        />
      ) : (
        people.map((u) => (
          <button
            key={u.id}
            onClick={() => openDm(u.id)}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-ink-800/60"
          >
            <Avatar name={u.displayName} src={u.avatarUrl} size={48} online={isOnline(u.id)} />
            <span className="min-w-0 flex-1 border-b border-ink-800 pb-2.5">
              <span className="block truncate text-[15px] text-gray-100">{u.displayName}</span>
              <span className="block truncate text-xs text-gray-500">
                @{u.username}
                {u.about ? ` \u00b7 ${u.about}` : ''}
              </span>
            </span>
          </button>
        ))
      )}
    </div>
  );
}

export default function ConversationList({ activeId, onSelect }) {
  const { user } = useAuth();
  const { isOnline } = useSocket();
  const { conversations, convsLoading, previewOf } = useChat();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const peer = c.type === 'dm' ? dmPeer(c, user.id) : null;
      const name = (c.type === 'group' ? c.name : peer?.displayName || peer?.username || '').toLowerCase();
      return name.includes(q);
    });
  }, [conversations, query, user.id]);

  if (convsLoading) return <ListSkeleton rows={8} />;

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pb-2 pt-1">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chats"
          className="w-full rounded-xl border border-ink-700 bg-ink-800 px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500"
        />
      </div>
      {filtered.length === 0 ? (
        query ? (
          <EmptyState
            icon="💬"
            title="No chats found"
            body="Try a different search."
          />
        ) : (
          <StartChatting onSelect={onSelect} />
        )
      ) : (
        <div className="flex-1 overflow-y-auto pb-24 md:pb-4">
          {filtered.map((conv) => {
            const isGroup = conv.type === 'group';
            const peer = isGroup ? null : dmPeer(conv, user.id);
            const name = isGroup ? conv.name : peer?.displayName || peer?.username || 'Unknown';
            const avatarSrc = isGroup ? null : peer?.avatarUrl;
            const online = !isGroup && peer ? isOnline(peer.id) : undefined;
            const last = conv.lastMessage;
            const preview = last
              ? `${last.senderId === user.id ? 'You: ' : ''}${previewOf(last)}`
              : 'No messages yet';
            return (
              <button
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={`flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-ink-800/60 ${
                  activeId === conv.id ? 'bg-ink-800' : ''
                }`}
              >
                <Avatar name={name} src={avatarSrc} size={50} online={online} />
                <div className="min-w-0 flex-1 border-b border-ink-800 pb-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[15px] font-medium text-gray-100">
                      {name}
                    </span>
                    {last && (
                      <span
                        className={`shrink-0 text-xs ${
                          conv.unreadCount > 0 ? 'font-semibold text-mint-400' : 'text-gray-500'
                        }`}
                      >
                        {fmtListTime(last.createdAt)}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-gray-400">{preview}</span>
                    {conv.unreadCount > 0 && (
                      <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-mint-400 px-1.5 text-xs font-bold text-ink-950">
                        {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
