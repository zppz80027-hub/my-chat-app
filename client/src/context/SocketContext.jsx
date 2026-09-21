import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { io } from 'socket.io-client';
import { apiBase } from '../utils/api';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

// Socket events we forward to subscriber callbacks.
const FORWARDED = [
  'message:new',
  'message:updated',
  'message:deleted',
  'message:reaction',
  'message:read',
  'message:status',
  'call:offer',
  'call:answer',
  'call:ice',
  'call:reject',
  'call:end',
  'call:ringing',
];

const TYPING_TTL_MS = 5000;

export function SocketProvider({ children }) {
  const { token, user } = useAuth();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState({}); // userId -> { isOnline, lastSeen }
  const [typing, setTyping] = useState({}); // convId -> { userId: true }
  const handlers = useRef(new Map()); // event -> Set<fn>
  const typingTimers = useRef({}); // `${convId}:${userId}` -> timeout

  const subscribe = useCallback((event, fn) => {
    if (!handlers.current.has(event)) handlers.current.set(event, new Set());
    handlers.current.get(event).add(fn);
    return () => {
      const set = handlers.current.get(event);
      if (set) set.delete(fn);
    };
  }, []);

  useEffect(() => {
    if (!token || !user) {
      setSocket(null);
      setConnected(false);
      return;
    }
    const s = io(apiBase || undefined, { auth: { token } });
    setSocket(s);

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);

    const forwarders = {};
    FORWARDED.forEach((evt) => {
      const fn = (payload) => {
        const set = handlers.current.get(evt);
        if (set) set.forEach((cb) => {
          try {
            cb(payload);
          } catch (e) {
            console.error(`socket handler error (${evt})`, e);
          }
        });
      };
      forwarders[evt] = fn;
      s.on(evt, fn);
    });

    s.on('typing:update', ({ conversationId, userId, isTyping }) => {
      if (!conversationId || !userId || userId === user.id) return;
      const key = `${conversationId}:${userId}`;
      if (typingTimers.current[key]) {
        clearTimeout(typingTimers.current[key]);
        delete typingTimers.current[key];
      }
      setTyping((prev) => {
        const conv = { ...(prev[conversationId] || {}) };
        if (isTyping) conv[userId] = true;
        else delete conv[userId];
        const next = { ...prev };
        if (Object.keys(conv).length === 0) delete next[conversationId];
        else next[conversationId] = conv;
        return next;
      });
      if (isTyping) {
        typingTimers.current[key] = setTimeout(() => {
          delete typingTimers.current[key];
          setTyping((prev) => {
            const conv = { ...(prev[conversationId] || {}) };
            delete conv[userId];
            const next = { ...prev };
            if (Object.keys(conv).length === 0) delete next[conversationId];
            else next[conversationId] = conv;
            return next;
          });
        }, TYPING_TTL_MS);
      }
    });

    s.on('presence:update', ({ userId, isOnline, lastSeen }) => {
      if (!userId) return;
      setOnline((prev) => ({ ...prev, [userId]: { isOnline: !!isOnline, lastSeen } }));
    });

    return () => {
      FORWARDED.forEach((evt) => s.off(evt, forwarders[evt]));
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [token, user]);

  // Clear per-user timers on unmount.
  useEffect(() => {
    const timers = typingTimers.current;
    return () => Object.values(timers).forEach(clearTimeout);
  }, []);

  const emit = useCallback(
    (event, payload) => {
      if (socket && socket.connected) socket.emit(event, payload);
    },
    [socket]
  );

  const typingUsers = useCallback(
    (conversationId) => Object.keys(typing[conversationId] || {}),
    [typing]
  );

  const isOnline = useCallback((userId) => !!online[userId]?.isOnline, [online]);
  const lastSeen = useCallback((userId) => online[userId]?.lastSeen || null, [online]);

  const value = {
    socket,
    connected,
    emit,
    subscribe,
    typingUsers,
    isOnline,
    lastSeen,
    online,
  };
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used inside SocketProvider');
  return ctx;
}
