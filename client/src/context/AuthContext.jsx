import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken, setAuthFailureHandler } from '../utils/api';

const AuthContext = createContext(null);

// Naam phone me hamesha save rahe — token kho jaye to bhi wahi naam wapas mile.
const NAME_KEY = 'cloude.displayName';

function saveName(name) {
  try {
    if (name) localStorage.setItem(NAME_KEY, name);
  } catch {
    /* storage unavailable */
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get('/api/auth/me')
      .then(({ user: u }) => {
        if (cancelled) return;
        setUser(u || null);
        if (u && u.displayName) saveName(u.displayName);
      })
      .catch(async () => {
        // Purana token expire ho gaya ho to wahi purani identity wapas lao —
        // naya naam / nayi pehchaan nahi banegi, chats bhi bache rahenge.
        try {
          const { token: fresh, user: u } = await api.post('/api/auth/rejoin', { token });
          if (cancelled) return;
          setToken(fresh);
          setUser(u);
          if (u && u.displayName) saveName(u.displayName);
        } catch {
          setToken(null);
          if (!cancelled) setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Kahin bhi 401 aaye to pehle purani identity wapas lao (rejoin),
  // na mile to naya guest bana ke kaam chalao — user ko pata bhi nahi chalega.
  useEffect(() => {
    setAuthFailureHandler(async () => {
      const oldToken = getToken();
      if (oldToken) {
        try {
          const { token: fresh, user: u } = await api.post('/api/auth/rejoin', { token: oldToken });
          setToken(fresh);
          setUser(u);
          if (u && u.displayName) saveName(u.displayName);
          return true;
        } catch {
          /* neeche naya guest */
        }
      }
      try {
        await join('chat');
        return true;
      } catch {
        return false;
      }
    });
    return () => setAuthFailureHandler(null);
  }, [join]);

  const join = useCallback(async (name) => {
    const { token, user: u } = await api.post('/api/auth/guest', { name });
    setToken(token);
    setUser(u);
    if (u && u.displayName) saveName(u.displayName);
    return u;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const updateUser = useCallback((u) => {
    setUser(u);
    if (u && u.displayName) saveName(u.displayName);
  }, []);

  const value = { user, loading, join, logout, updateUser, token: getToken() };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
