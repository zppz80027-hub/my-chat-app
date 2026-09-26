import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from '../utils/api';
import { useAuth } from './AuthContext';
import { useSocket } from './SocketContext';
import { useToasts } from './ToastContext';
import { playPop } from '../utils/ringtone';

const ChatContext = createContext(null);
const PAGE_LIMIT = 50;

let tmpSeq = 1;
const tmpId = () => `tmp-${Date.now()}-${tmpSeq++}`;

function sortConvs(list) {
  return [...list].sort(
    (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
  );
}

function previewOf(m) {
  if (!m) return '';
  if (m.deletedForEveryone) return 'This message was deleted';
  if (m.kind === 'image') return `📷 ${m.text || 'Photo'}`;
  if (m.kind === 'file') return `📎 ${m.file?.filename || m.text || 'File'}`;
  return m.text || '';
}

export function ChatProvider({ children }) {
  const { user } = useAuth();
  const { socket, subscribe, emit } = useSocket();
  const { push } = useToasts();

  const [conversations, setConversations] = useState([]);
  const [convsLoading, setConvsLoading] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [msgs, setMsgs] = useState({}); // convId -> { items, hasMore, loading, loadingMore }

  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const msgsRef = useRef(msgs);
  msgsRef.current = msgs;
  const userRef = useRef(user);
  userRef.current = user;
  const ackedRef = useRef(new Set());
  const typingStateRef = useRef({}); // convId -> { active: bool, timer }
  const emitRef = useRef(emit);
  emitRef.current = emit;

  // ---------- conversations ----------

  const refreshConversations = useCallback(async () => {
    if (!userRef.current) return;
    setConvsLoading(true);
    try {
      const list = await api.get('/api/conversations');
      setConversations(sortConvs(Array.isArray(list) ? list : []));
    } catch (e) {
      push({ kind: 'error', title: 'Could not load chats', body: e.message });
    } finally {
      setConvsLoading(false);
    }
  }, [push]);

  useEffect(() => {
    if (user) refreshConversations();
    else {
      setConversations([]);
      setMsgs({});
      setActiveId(null);
    }
  }, [user, refreshConversations]);

  const getConversation = useCallback(
    (id) => conversations.find((c) => c.id === id) || null,
    [conversations]
  );

  const updateConversation = useCallback((id, patch) => {
    setConversations((prev) =>
      sortConvs(prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    );
  }, []);

  const removeConversation = useCallback((id) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setMsgs((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (activeIdRef.current === id) setActiveId(null);
  }, []);

  // ---------- messages ----------

  const ensureMessages = useCallback(
    async (convId) => {
      const cur = msgsRef.current[convId];
      if (cur && (cur.items.length > 0 || cur.loading)) return;
      setMsgs((prev) => ({
        ...prev,
        [convId]: { items: [], hasMore: true, loading: true, loadingMore: false },
      }));
      try {
        const list = await api.get(
          `/api/conversations/${convId}/messages?limit=${PAGE_LIMIT}`
        );
        const items = Array.isArray(list) ? list : [];
        setMsgs((prev) => ({
          ...prev,
          [convId]: {
            items,
            hasMore: items.length >= PAGE_LIMIT,
            loading: false,
            loadingMore: false,
          },
        }));
      } catch (e) {
        setMsgs((prev) => ({
          ...prev,
          [convId]: { items: [], hasMore: false, loading: false, loadingMore: false },
        }));
        push({ kind: 'error', title: 'Could not load messages', body: e.message });
      }
    },
    [push]
  );

  const loadOlder = useCallback(
    async (convId) => {
      const cur = msgsRef.current[convId];
      if (!cur || cur.loadingMore || !cur.hasMore || cur.items.length === 0) return;
      setMsgs((prev) => ({
        ...prev,
        [convId]: { ...prev[convId], loadingMore: true },
      }));
      try {
        const list = await api.get(
          `/api/conversations/${convId}/messages?limit=${PAGE_LIMIT}&before=${cur.items[0].id}`
        );
        const older = Array.isArray(list) ? list : [];
        setMsgs((prev) => {
          const existing = new Set(prev[convId].items.map((m) => m.id));
          const fresh = older.filter((m) => !existing.has(m.id));
          return {
            ...prev,
            [convId]: {
              ...prev[convId],
              items: [...fresh, ...prev[convId].items],
              hasMore: older.length >= PAGE_LIMIT,
              loadingMore: false,
            },
          };
        });
      } catch (e) {
        setMsgs((prev) => ({
          ...prev,
          [convId]: { ...prev[convId], loadingMore: false },
        }));
      }
    },
    []
  );

  const upsertMessage = useCallback((convId, message) => {
    setMsgs((prev) => {
      const cur = prev[convId];
      if (!cur) return prev;
      const idx = cur.items.findIndex((m) => m.id === message.id);
      let items;
      if (idx >= 0) {
        items = [...cur.items];
        items[idx] = { ...items[idx], ...message };
      } else {
        items = [...cur.items, message];
      }
      return { ...prev, [convId]: { ...cur, items } };
    });
  }, []);

  // ---------- read receipts ----------

  const markAsRead = useCallback(
    async (convId) => {
      const me = userRef.current;
      if (!me) return;
      const cur = msgsRef.current[convId];
      if (!cur || cur.items.length === 0) return;
      const lastIncoming = [...cur.items]
        .reverse()
        .find((m) => m.senderId !== me.id && !m.deletedForEveryone);
      updateConversation(convId, { unreadCount: 0 });
      if (!lastIncoming) return;
      try {
        await api.post(`/api/conversations/${convId}/read`, {
          messageId: lastIncoming.id,
        });
      } catch {
        /* non-fatal */
      }
    },
    [updateConversation]
  );

  // ---------- socket event wiring ----------

  useEffect(() => {
    const unsubs = [];

    // Shared wallpaper badla to turant lagao (sab ko dikhega).
    unsubs.push(
      subscribe('conversation:wallpaper', ({ conversationId, wallpaper }) => {
        if (!conversationId) return;
        updateConversation(conversationId, { wallpaper: wallpaper || null });
      })
    );

    unsubs.push(
      subscribe('message:new', (m) => {
        if (!m || !m.id || !m.conversationId) return;
        const me = userRef.current;
        const convId = m.conversationId;
        const isActive = activeIdRef.current === convId;

        setMsgs((prev) => {
          const cur = prev[convId];
          if (!cur) return prev; // not loaded yet; conversation refresh covers it
          if (cur.items.some((x) => x.id === m.id)) return prev;
          return { ...prev, [convId]: { ...cur, items: [...cur.items, m] } };
        });

        setConversations((prev) => {
          const exists = prev.some((c) => c.id === convId);
          const bump = m.senderId !== me?.id && !isActive ? 1 : 0;
          let next;
          if (exists) {
            next = prev.map((c) =>
              c.id === convId
                ? {
                    ...c,
                    lastMessage: m,
                    updatedAt: m.createdAt,
                    unreadCount: (c.unreadCount || 0) + bump,
                  }
                : c
            );
          } else {
            // New conversation we don't know about yet — refresh list.
            refreshConversations();
            return prev;
          }
          return sortConvs(next);
        });

        if (m.senderId !== me?.id) {
          if (!ackedRef.current.has(m.id)) {
            ackedRef.current.add(m.id);
            emitRef.current('message:delivered', { messageIds: [m.id] });
          }
          if (isActive) {
            markAsRead(convId);
            playPop();
          } else {
            const sender =
              m.senderDisplayName ||
              (m.senderId ? `User` : 'Someone');
            push({
              title: `New message from ${sender}`,
              body: previewOf(m),
              onClick: () => setActiveId(convId),
            });
          }
        }
      })
    );

    unsubs.push(
      subscribe('message:updated', (m) => {
        if (!m || !m.id || !m.conversationId) return;
        upsertMessage(m.conversationId, m);
        setConversations((prev) =>
          prev.map((c) =>
            c.id === m.conversationId && c.lastMessage?.id === m.id
              ? { ...c, lastMessage: m }
              : c
          )
        );
      })
    );

    unsubs.push(
      subscribe('message:deleted', ({ messageId, conversationId, scope }) => {
        if (!messageId) return;
        const convId =
          conversationId ||
          Object.keys(msgsRef.current).find((cid) =>
            msgsRef.current[cid].items.some((m) => m.id === messageId)
          );
        if (!convId) return;
        if (scope === 'me') {
          setMsgs((prev) => {
            const cur = prev[convId];
            if (!cur) return prev;
            return {
              ...prev,
              [convId]: {
                ...cur,
                items: cur.items.filter((m) => m.id !== messageId),
              },
            };
          });
        } else {
          upsertMessage(convId, { id: messageId, deletedForEveryone: true, text: '' });
        }
      })
    );

    unsubs.push(
      subscribe('message:reaction', ({ messageId, conversationId, reactions }) => {
        if (!messageId || !reactions) return;
        const convId =
          conversationId ||
          Object.keys(msgsRef.current).find((cid) =>
            msgsRef.current[cid].items.some((m) => m.id === messageId)
          );
        if (convId) upsertMessage(convId, { id: messageId, reactions });
      })
    );

    const applyRead = (conversationId, userId, messageId) => {
      if (!conversationId || !userId) return;
      setMsgs((prev) => {
        const cur = prev[conversationId];
        if (!cur) return prev;
        let cutoff = Infinity;
        if (messageId) {
          const idx = cur.items.findIndex((m) => m.id === messageId);
          if (idx >= 0) cutoff = idx;
        }
        const items = cur.items.map((m, i) => {
          if (i > cutoff) return m;
          const readBy = Array.isArray(m.readBy) ? m.readBy : [];
          if (readBy.includes(userId)) return m;
          return { ...m, readBy: [...readBy, userId] };
        });
        return { ...prev, [conversationId]: { ...cur, items } };
      });
    };

    unsubs.push(
      subscribe('message:read', ({ conversationId, userId, messageId }) =>
        applyRead(conversationId, userId, messageId)
      )
    );

    // Defensive: accept a few plausible delivery-status shapes.
    unsubs.push(
      subscribe('message:status', (p) => {
        if (!p) return;
        const ids = p.messageIds || (p.messageId ? [p.messageId] : []);
        const uid = p.userId;
        const status = p.status;
        if (!ids.length || !uid) return;
        setMsgs((prev) => {
          const next = { ...prev };
          Object.keys(next).forEach((cid) => {
            const cur = next[cid];
            const hit = cur.items.some((m) => ids.includes(m.id));
            if (!hit) return;
            next[cid] = {
              ...cur,
              items: cur.items.map((m) => {
                if (!ids.includes(m.id)) return m;
                const out = { ...m };
                if (status === 'read' || p.readBy) {
                  const rb = Array.isArray(m.readBy) ? m.readBy : [];
                  if (!rb.includes(uid)) out.readBy = [...rb, uid];
                } else {
                  const dt = Array.isArray(m.deliveredTo) ? m.deliveredTo : [];
                  if (!dt.includes(uid)) out.deliveredTo = [...dt, uid];
                }
                return out;
              }),
            };
          });
          return next;
        });
      })
    );

    return () => unsubs.forEach((u) => u());
  }, [subscribe, upsertMessage, markAsRead, refreshConversations, push]);

  // Join room + load + mark read when the active conversation changes.
  useEffect(() => {
    if (!activeId || !socket) return;
    emit('conversation:join', { conversationId: activeId });
    ensureMessages(activeId).then(() => markAsRead(activeId));
  }, [activeId, socket, emit, ensureMessages, markAsRead]);

  // ---------- sending / mutating ----------

  const sendText = useCallback(
    async (convId, text, replyTo) => {
      const me = userRef.current;
      if (!me || !text.trim()) return;
      const optimistic = {
        id: tmpId(),
        conversationId: convId,
        senderId: me.id,
        senderDisplayName: me.displayName,
        kind: 'text',
        text: text.trim(),
        replyTo: replyTo || null,
        file: null,
        createdAt: new Date().toISOString(),
        editedAt: null,
        reactions: [],
        readBy: [],
        deliveredTo: [],
        _pending: true,
      };
      setMsgs((prev) => {
        const cur = prev[convId];
        if (!cur) return prev;
        return { ...prev, [convId]: { ...cur, items: [...cur.items, optimistic] } };
      });
      try {
        const saved = await api.post(`/api/conversations/${convId}/messages`, {
          kind: 'text',
          text: text.trim(),
          ...(replyTo ? { replyTo: replyTo.id } : {}),
        });
        const real = saved?.message || saved;
        setMsgs((prev) => {
          const cur = prev[convId];
          if (!cur) return prev;
          return {
            ...prev,
            [convId]: {
              ...cur,
              items: cur.items.map((m) => (m.id === optimistic.id ? { ...real, _pending: false } : m)),
            },
          };
        });
        updateConversation(convId, {
          lastMessage: real,
          updatedAt: real.createdAt,
        });
      } catch (e) {
        setMsgs((prev) => {
          const cur = prev[convId];
          if (!cur) return prev;
          return {
            ...prev,
            [convId]: { ...cur, items: cur.items.filter((m) => m.id !== optimistic.id) },
          };
        });
        push({ kind: 'error', title: 'Message not sent', body: e.message });
        throw e;
      }
    },
    [push, updateConversation]
  );

  const sendFileMessage = useCallback(
    async (convId, upload, kind, text, replyTo) => {
      const me = userRef.current;
      if (!me) return;
      try {
        const saved = await api.post(`/api/conversations/${convId}/messages`, {
          kind,
          fileId: upload.fileId,
          ...(text ? { text } : {}),
          ...(replyTo ? { replyTo: replyTo.id } : {}),
        });
        const real = saved?.message || saved;
        // Rely on socket echo; if the conversation isn't loaded it doesn't matter.
        setConversations((prev) =>
          sortConvs(
            prev.map((c) =>
              c.id === convId
                ? { ...c, lastMessage: real, updatedAt: real.createdAt }
                : c
            )
          )
        );
        return real;
      } catch (e) {
        push({ kind: 'error', title: 'Could not send file', body: e.message });
        throw e;
      }
    },
    [push]
  );

  const editMessage = useCallback(
    async (messageId, text) => {
      const updated = await api.patch(`/api/messages/${messageId}`, { text });
      const real = updated?.message || updated;
      if (real?.conversationId) upsertMessage(real.conversationId, real);
      return real;
    },
    [upsertMessage]
  );

  const deleteMessage = useCallback(
    async (messageId, scope) => {
      await api.del(`/api/messages/${messageId}?scope=${scope}`);
      // UI updates arrive via the message:deleted socket event.
    },
    []
  );

  const toggleReaction = useCallback(
    async (messageId, emoji) => {
      // Optimistic toggle; the message:reaction event reconciles.
      const me = userRef.current;
      setMsgs((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((cid) => {
          const cur = next[cid];
          const idx = cur.items.findIndex((m) => m.id === messageId);
          if (idx < 0) return;
          const m = cur.items[idx];
          const reactions = [...(m.reactions || [])];
          const mine = reactions.findIndex(
            (r) => r.emoji === emoji && r.userId === me?.id
          );
          if (mine >= 0) reactions.splice(mine, 1);
          else reactions.push({ emoji, userId: me?.id, username: me?.username });
          const items = [...cur.items];
          items[idx] = { ...m, reactions };
          next[cid] = { ...cur, items };
        });
        return next;
      });
      try {
        await api.post(`/api/messages/${messageId}/reactions`, { emoji });
      } catch (e) {
        push({ kind: 'error', title: 'Reaction failed', body: e.message });
      }
    },
    [push]
  );

  // ---------- typing ----------

  const startTyping = useCallback(
    (convId) => {
      const st = typingStateRef.current[convId] || {};
      if (!st.active) {
        emitRef.current('typing:start', { conversationId: convId });
        st.active = true;
      }
      if (st.timer) clearTimeout(st.timer);
      st.timer = setTimeout(() => {
        emitRef.current('typing:stop', { conversationId: convId });
        st.active = false;
      }, 2500);
      typingStateRef.current[convId] = st;
    },
    []
  );

  const stopTyping = useCallback((convId) => {
    const st = typingStateRef.current[convId];
    if (st?.active) {
      emitRef.current('typing:stop', { conversationId: convId });
      st.active = false;
    }
    if (st?.timer) clearTimeout(st.timer);
  }, []);

  // ---------- derived ----------

  const unreadTotal = useMemo(
    () => conversations.reduce((n, c) => n + (c.unreadCount || 0), 0),
    [conversations]
  );

  const value = {
    conversations,
    convsLoading,
    refreshConversations,
    activeId,
    setActiveId,
    getConversation,
    updateConversation,
    removeConversation,
    msgs,
    ensureMessages,
    loadOlder,
    sendText,
    sendFileMessage,
    editMessage,
    deleteMessage,
    toggleReaction,
    markAsRead,
    startTyping,
    stopTyping,
    unreadTotal,
    previewOf,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside ChatProvider');
  return ctx;
}
