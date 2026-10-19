'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import type { SessionUserDto } from '@ishan/contracts';
import { ApiClientError, api } from './api';

interface AuthState {
  user: SessionUserDto | null;
  loading: boolean;
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['me'],
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        return await api<SessionUserDto>('/auth/me');
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 401) return null;
        throw e;
      }
    },
  });
  const user = data ?? null;
  const can = useCallback((p: string) => !!user?.permissions.includes(p), [user]);
  const refresh = useCallback(async () => void (await refetch()), [refetch]);
  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    qc.clear();
    window.location.assign('/login');
  }, [qc]);
  return (
    <AuthContext.Provider value={{ user, loading: isLoading, can, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
