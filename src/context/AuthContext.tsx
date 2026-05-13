import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api, tokenStore } from '../api';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: 'super_admin' | 'admin' | 'manager' | 'user' | 'viewer';
  status: string;
  two_factor_enabled: number;
  last_login_at: string | null;
  created_at: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ requiresTwoFactor: boolean; preToken?: string }>;
  verify2FA: (preToken: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    if (!tokenStore.get()) { setUser(null); setLoading(false); return; }
    try {
      const me = await api.getMe();
      setUser(me);
    } catch {
      tokenStore.clear();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
    const onLogout = () => { setUser(null); };
    window.addEventListener('logivice:logout', onLogout);
    return () => window.removeEventListener('logivice:logout', onLogout);
  }, [refreshUser]);

  const login = async (email: string, password: string) => {
    const data = await api.login(email, password);
    if (data.token && data.user) {
      setUser(data.user as unknown as AuthUser);
    }
    return {
      requiresTwoFactor: Boolean(data.requiresTwoFactor),
      preToken: data.preToken,
    };
  };

  const verify2FA = async (preToken: string, code: string) => {
    const data = await api.verify2FA(preToken, code);
    setUser(data.user as unknown as AuthUser);
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, verify2FA, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function useRequireRole(...roles: AuthUser['role'][]): AuthUser {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) {
    throw new Error('Insufficient permissions');
  }
  return user;
}
