import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { User, LoginResponse, Login2faType } from '../types/auth';
import { authApi } from '../api/authApi';
import { profileApi } from '../api/profileApi';
import {
  getAccessToken,
  setAccessToken,
  getServerUrl,
  setServerUrl as persistServerUrl,
  getCachedUser,
  setCachedUser,
  clearTokens,
  isNetworkError,
} from '../api/tokenManager';
import { syncAllPending } from '../services/readerDb';
import { claimLocalDataForUser } from '../services/storage';

// ─── Context shape ───────────────────────────────────────────────────────

interface AuthContextType {
  user: User | null;
  serverUrl: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isOffline: boolean;

  checkOnlineStatus: () => Promise<boolean>;
  login: (email: string, password: string) => Promise<LoginResponse>;
  login2fa: (
    userId: string,
    token: string,
    code: string,
    type?: Login2faType,
  ) => Promise<void>;
  register: (
    name: string,
    email: string,
    password: string,
  ) => Promise<{ userId: string; resendAfter: number }>;
  emailConfirm: (userId: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setServerUrl: (url: string) => void;
  clearServer: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ─── Provider ────────────────────────────────────────────────────────────

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(() => getCachedUser());
  const [serverUrl, setServerUrlState] = useState<string | null>(getServerUrl);
  const [isLoading, setIsLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  );

  const authOpIdRef = useRef<number>(0);

  // ── Fetch profile (validates token and caches user) ──────────────────

  const fetchProfile = useCallback(async () => {
    const opId = ++authOpIdRef.current;
    try {
      const data = await profileApi.getProfile();
      if (opId !== authOpIdRef.current) return null;
      // Sign-in already claimed the local data for this account; this covers
      // sessions that started before ownership was recorded.
      await claimLocalDataForUser(data.userId).catch(console.error);
      if (opId !== authOpIdRef.current) return null;
      setUser(data);
      setCachedUser(data);
      setIsOffline(false);
      return data;
    } catch (err: any) {
      if (opId !== authOpIdRef.current) return null;
      if (isNetworkError(err) || err?.status === 0) {
        setIsOffline(true);
        // Do NOT clear tokens or kick user out when offline
        const cached = getCachedUser();
        if (cached) {
          setUser(cached);
        } else if (getAccessToken()) {
          // If no cached profile existed yet, provide fallback offline user
          const fallbackUser: User = {
            userId: 'offline-user',
            name: 'Reader (Offline)',
            email: '',
            twoFactorEnabled: false,
            emailConfirmed: true,
          };
          setUser(fallbackUser);
          setCachedUser(fallbackUser);
        }
      } else if (err?.status === 401 && !getAccessToken()) {
        // The refresh endpoint rejected the session (the HTTP client has
        // already dropped the tokens). Local data is kept for the next
        // sign-in of the same account.
        setUser(null);
      } else {
        // Other errors (e.g. 500, or a 401 for a request retried with a
        // freshly refreshed token), keep cached session
        const cached = getCachedUser();
        if (cached) {
          setUser(cached);
        }
      }
      return null;
    }
  }, []);

  // ── Active online status checker ─────────────────────────────────────

  const checkOnlineStatus = useCallback(async (): Promise<boolean> => {
    const token = getAccessToken();
    const url = getServerUrl();
    if (!url || !token) {
      return false;
    }

    const opId = ++authOpIdRef.current;
    try {
      const data = await profileApi.getProfile();
      if (opId !== authOpIdRef.current) return false;
      if (data) {
        await claimLocalDataForUser(data.userId).catch(console.error);
        if (opId !== authOpIdRef.current) return false;
        setUser(data);
        setCachedUser(data);
        setIsOffline(false);
        // Sync pending changes in background
        syncAllPending().catch((e) =>
          console.warn('Sync on checkOnlineStatus failed:', e),
        );
        return true;
      }
      return false;
    } catch (err: any) {
      if (opId !== authOpIdRef.current) return false;
      if (err?.status === 401 && !getAccessToken()) {
        // Session rejected by the refresh endpoint; local data is kept.
        setUser(null);
        return false;
      }
      if (isNetworkError(err) || err?.status === 0) {
        setIsOffline(true);
      }
      return false;
    }
  }, []);

  // ── Bootstrap: check if we have a valid session ──────────────────────

  useEffect(() => {
    let isCancelled = false;

    const bootstrap = async () => {
      // Safety guard: ensure the splash screen never hangs for more than 3.5s
      const splashTimeout = setTimeout(() => {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }, 3500);

      try {
        const url = getServerUrl();
        const token = getAccessToken();
        const cached = getCachedUser();

        if (url && (token || cached)) {
          if (cached) {
            setUser(cached);
          }
          await fetchProfile();
        }
      } catch (e) {
        console.error('Auth bootstrap failed:', e);
      } finally {
        clearTimeout(splashTimeout);
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    bootstrap();

    return () => {
      isCancelled = true;
    };
  }, [fetchProfile]);

  // ── Active background probe when offline ─────────────────────────────

  useEffect(() => {
    if (!isOffline) return;

    // Probe server every 5 seconds while offline to automatically recover
    const interval = setInterval(async () => {
      const token = getAccessToken();
      const url = getServerUrl();
      if (!url || !token) return;

      await checkOnlineStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, [isOffline, checkOnlineStatus]);

  // ── Listen for network online/offline, window focus & custom events ──

  useEffect(() => {
    const triggerOnlineRecovery = async () => {
      const token = getAccessToken();
      const url = getServerUrl();
      if (url && token) {
        await checkOnlineStatus();
      }
    };

    const handleConnectionRestored = () => {
      setIsOffline(false);
      const token = getAccessToken();
      const url = getServerUrl();
      if (url && token) {
        syncAllPending().catch(console.warn);
      }
    };

    const handleConnectionLost = () => {
      setIsOffline(true);
    };

    const handleWindowFocus = () => {
      triggerOnlineRecovery();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        triggerOnlineRecovery();
      }
    };

    window.addEventListener('online', triggerOnlineRecovery);
    window.addEventListener('offline', handleConnectionLost);
    window.addEventListener('folio:connection-restored', handleConnectionRestored);
    window.addEventListener('folio:connection-lost', handleConnectionLost);
    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('online', triggerOnlineRecovery);
      window.removeEventListener('offline', handleConnectionLost);
      window.removeEventListener('folio:connection-restored', handleConnectionRestored);
      window.removeEventListener('folio:connection-lost', handleConnectionLost);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [checkOnlineStatus]);

  // ── Listen for session-expired events from the HTTP client ───────────

  useEffect(() => {
    // Fired only when the refresh endpoint definitively rejected the session.
    // The credentials are already gone; local data (including changes that
    // were not synced yet) is kept and pushed after the next sign-in.
    const handleExpired = () => {
      ++authOpIdRef.current;
      setUser(null);
    };
    window.addEventListener('folio:session-expired', handleExpired);
    return () =>
      window.removeEventListener('folio:session-expired', handleExpired);
  }, []);

  // ── Auth methods ─────────────────────────────────────────────────────

  // Makes a sign-in that the server accepted the current session. Before the
  // token becomes usable, local data left by another account is removed
  // (data of the same account is kept). If that fails the sign-in is undone:
  // the new account must never read or sync another account's data.
  const startSession = useCallback(
    async (userId: string, token: string): Promise<void> => {
      try {
        await claimLocalDataForUser(userId);
      } catch (err) {
        clearTokens();
        throw err;
      }
      setAccessToken(token);
      await fetchProfile();
      // Changes made before the previous session ended are still waiting in
      // the local database
      syncAllPending().catch((e) =>
        console.warn('Sync after sign-in failed:', e),
      );
    },
    [fetchProfile],
  );

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResponse> => {
      const opId = ++authOpIdRef.current;
      const res = await authApi.login(email, password);
      if (opId !== authOpIdRef.current) return res;
      if (!res.need2fa) {
        await startSession(res.userId, res.token);
      }
      return res;
    },
    [startSession],
  );

  const login2fa = useCallback(
    async (
      userId: string,
      token: string,
      code: string,
      type: Login2faType = 'code',
    ): Promise<void> => {
      const opId = ++authOpIdRef.current;
      const res = await authApi.login2fa(userId, token, code, type);
      if (opId !== authOpIdRef.current) return;
      await startSession(res.userId || userId, res.token);
    },
    [startSession],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      return authApi.register(name, email, password);
    },
    [],
  );

  const emailConfirm = useCallback(
    async (userId: string, code: string): Promise<void> => {
      const opId = ++authOpIdRef.current;
      const res = await authApi.emailConfirm(userId, code);
      if (opId !== authOpIdRef.current) return;
      await startSession(userId, res.token);
    },
    [startSession],
  );

  const logout = useCallback(async () => {
    ++authOpIdRef.current;
    // Last chance to push unsynced changes while the token still works.
    // Whatever does not make it stays in the local database and is pushed
    // after the next sign-in of the same account.
    try {
      await Promise.race([
        syncAllPending(),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    } catch {
      // ignore
    }
    try {
      await authApi.logout();
    } catch {
      // ignore
    }
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    if (getAccessToken()) {
      await fetchProfile();
    }
  }, [fetchProfile]);

  const handleSetServerUrl = useCallback((url: string) => {
    persistServerUrl(url);
    setServerUrlState(url);
  }, []);

  const clearServer = useCallback(() => {
    ++authOpIdRef.current;
    persistServerUrl(null);
    clearTokens();
    setServerUrlState(null);
    setUser(null);
  }, []);

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <AuthContext.Provider
      value={{
        user,
        serverUrl,
        isAuthenticated: !!user,
        isLoading,
        isOffline,
        checkOnlineStatus,
        login,
        login2fa,
        register,
        emailConfirm,
        logout,
        refreshUser,
        setServerUrl: handleSetServerUrl,
        clearServer,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// ─── Hook ────────────────────────────────────────────────────────────────

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
