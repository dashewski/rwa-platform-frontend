'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { useAccount, useDisconnect, useWalletClient } from 'wagmi';
import { signTypedData } from 'viem/actions';
import { useRouter } from 'next/navigation';
import { authService } from './authService';
import { getSession, SESSION_EXPIRED_EVENT, type Session } from './session';
import { toast } from '@/components/ui/Toast';

interface AuthUser {
  userId: string;
  wallet: string;
}

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  isLoading: true,
  user: null,
  login: async () => {},
  logout: async () => {},
  logoutAll: async () => {},
});

export const useAuth = () => useContext(AuthContext);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const { data: walletClient } = useWalletClient();
  const router = useRouter();
  const loginAttempted = useRef(false);

  const login = useCallback(async () => {
    if (!address) {
      throw new Error('Wallet not connected');
    }

    if (!walletClient) {
      throw new Error('Wallet client not available');
    }

    try {
      setIsLoading(true);

      const typedData = authService.createTypedData(address);
      const signature = await signTypedData(walletClient, {
        domain: typedData.domain as any,
        types: typedData.types as any,
        primaryType: typedData.primaryType,
        message: typedData.message,
      });

      const next = await authService.login({
        wallet: address,
        signature,
        timestamp: typedData.message.timestamp,
      });

      setSession(next);

      toast('Signed in successfully!');
      router.push('/portfolio/');
    } catch (error) {
      toast('Sign in failed. Please try again.', 'error');
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [address, walletClient, router]);

  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      setIsLoading(true);

      const current = await getSession();

      if (cancelled) {
        return;
      }

      setSession(current);

      if (!current && address && walletClient && !loginAttempted.current) {
        loginAttempted.current = true;

        try {
          await login();
        } catch {
          // the toast is already shown by login()
        }
      }

      if (!cancelled) {
        setIsLoading(false);
      }
    };

    restore();

    return () => {
      cancelled = true;
    };
  }, [address, walletClient, login]);

  useEffect(() => {
    const handleSessionExpired = () => {
      setSession(null);
      toast('Session expired. Please sign in again.', 'error');
      router.push('/');
    };

    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, [router]);

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch {
      // the session is gone either way
    }

    setSession(null);
    disconnect();
    toast('Signed out successfully.');
    router.push('/');
  }, [disconnect, router]);

  const logoutAll = useCallback(async () => {
    try {
      await authService.logoutAll();
    } catch {
      // the session is gone either way
    }

    setSession(null);
    disconnect();
    toast('Signed out on all devices.');
    router.push('/');
  }, [disconnect, router]);

  const value = {
    isAuthenticated: session !== null,
    isLoading,
    user: session ? { userId: session.userId, wallet: session.wallet } : null,
    login,
    logout,
    logoutAll,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
