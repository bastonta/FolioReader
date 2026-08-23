import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
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
  isNetworkError,
} from '../api/tokenManager';
import { syncAllPending } from '../services/readerDb';
import { clearAllUserData } from '../services/storage';

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

  // ── Fetch profile (validates token and caches user) ──────────────────

  const fetchProfile = useCallback(async () => {
    try {
      const data = await profileApi.getProfile();
      setUser(data);
      setCachedUser(data);
      setIsOffline(false);
      return data;
    } catch (err: any) {
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
      } else if (err?.status === 401) {
        // Genuine 401: session is permanently expired or invalidated
        setUser(null);
        clearAllUserData({ preserveServerUrl: true }).catch(console.error);
      } else {
        // Other errors (e.g. 500), keep cached session
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

    try {
      const data = await profileApi.getProfile();
      if (data) {
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
      if (err?.status === 401) {
        setUser(null);
        clearAllUserData({ preserveServerUrl: true }).catch(console.error);
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
    const bootstrap = async () => {
      const url = getServerUrl();
      const token = getAccessToken();
      const cached = getCachedUser();

      if (url && token) {
        if (cached) {
          setUser(cached);
        }
        await fetchProfile();
      }
      setIsLoading(false);
    };
    bootstrap();
  }, [fetchProfile]);

  // ── Active background probe when offline ─────────────────────────────

  useEffect(() => {
    if (!isOffline) return;

    // Probe server every 5 seconds while offline to automatically recover
    const interval = setInterval(async () => {
      const token = getAccessToken();
      const url = getServerUrl();
      if (!url || !token) return;

      try {
        const data = await profileApi.getProfile();
        if (data) {
          setUser(data);
          setCachedUser(data);
          setIsOffline(false);
          syncAllPending().catch(console.warn);
        }
      } catch (err: any) {
        if (err?.status === 401) {
          setUser(null);
          clearAllUserData({ preserveServerUrl: true }).catch(console.error);
        }
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [isOffline]);

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
    const handleExpired = () => {
      setUser(null);
      clearAllUserData({ preserveServerUrl: true }).catch(console.error);
    };
    window.addEventListener('folio:session-expired', handleExpired);
    return () =>
      window.removeEventListener('folio:session-expired', handleExpired);
  }, []);

  // ── Auth methods ─────────────────────────────────────────────────────

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResponse> => {
      const res = await authApi.login(email, password);
      if (!res.need2fa) {
        await clearAllUserData({ preserveServerUrl: true });
        setAccessToken(res.token);
        await fetchProfile();
      }
      return res;
    },
    [fetchProfile],
  );

  const login2fa = useCallback(
    async (
      userId: string,
      token: string,
      code: string,
      type: Login2faType = 'code',
    ): Promise<void> => {
      const res = await authApi.login2fa(userId, token, code, type);
      await clearAllUserData({ preserveServerUrl: true });
      setAccessToken(res.token);
      await fetchProfile();
    },
    [fetchProfile],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      return authApi.register(name, email, password);
    },
    [],
  );

  const emailConfirm = useCallback(
    async (userId: string, code: string): Promise<void> => {
      const res = await authApi.emailConfirm(userId, code);
      await clearAllUserData({ preserveServerUrl: true });
      setAccessToken(res.token);
      await fetchProfile();
    },
    [fetchProfile],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore
    }
    await clearAllUserData({ preserveServerUrl: true });
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
    persistServerUrl(null);
    clearAllUserData({ preserveServerUrl: false }).catch(console.error);
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
