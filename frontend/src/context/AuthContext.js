import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import api, { getToken, setToken, getGuestId, setGuestId, clearAuth } from '@/lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);       // { id, username, avatar_url, is_guest }
  const [loading, setLoading] = useState(true);  // true while checking stored token

  useEffect(() => {
    const token = getToken();
    if (token) {
      api.get('/auth/me')
        .then((res) => {
          setUser(res.data);
        })
        .catch(() => {

          clearAuth();
          setUser(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (username, email, password, bio = '') => {
    const res = await api.post('/auth/register', { username, email, password, bio });
    const { token, user: userData } = res.data;
    setToken(token);
    setGuestId(null);
    setUser({ ...userData, is_guest: false });
    return userData;
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    const { token, user: userData } = res.data;
    setToken(token);
    setGuestId(null);
    setUser({ ...userData, is_guest: false });
    return userData;
  }, []);

  const logout = useCallback(() => {
    clearAuth();
    setUser(null);
  }, []);

  const ensureGuestSession = useCallback(async () => {

    if (user) return user;

    const existingGuestId = getGuestId();
    const existingToken = getToken();
    if (existingGuestId && existingToken) {
      try {
        const res = await api.get('/auth/me');
        if (res.data.is_guest) {
          setUser(res.data);
          return res.data;
        }
      } catch {

      }
    }

    const res = await api.post('/auth/guest-session');
    const { guest_session_id, token } = res.data;
    setToken(token);
    setGuestId(guest_session_id);
    const guestUser = { id: guest_session_id, username: 'Guest', is_guest: true };
    setUser(guestUser);
    return guestUser;
  }, [user]);

  const convertGuest = useCallback(async (username, email, password, bio = '') => {
    const guestId = getGuestId() || user?.id;
    if (!guestId) throw new Error('No guest session to convert');
    const res = await api.post('/auth/convert-guest', {
      guest_session_id: guestId,
      username,
      email,
      password,
      bio,
    });
    const { token, user: userData } = res.data;
    setToken(token);
    setGuestId(null);
    setUser({ ...userData, is_guest: false });
    return userData;
  }, [user]);

  const refreshProfile = useCallback(async () => {
    try {
      const res = await api.get('/auth/me');
      setUser(res.data);
      return res.data;
    } catch {
      return null;
    }
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    isAuthenticated: !!user && !user.is_guest,
    isGuest: user?.is_guest === true,
    register,
    login,
    logout,
    ensureGuestSession,
    convertGuest,
    refreshProfile,
  }), [user, loading, register, login, logout, ensureGuestSession, convertGuest, refreshProfile]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
