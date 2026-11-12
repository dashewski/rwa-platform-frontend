'use client';

import React, { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { useAccount, useDisconnect, useWalletClient } from 'wagmi';
import { signTypedData } from 'viem/actions';
import { useRouter } from 'next/navigation';
import { authService } from './authService';
import {
  AUTH_SESSION_EXPIRED_EVENT,
  clearTokens,
  currentUser,
  getAccessToken,
} from './tokenManager';
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
}

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  isLoading: true,
  user: null,
  login: async () => {},
  logout: async () => {},
});

export const useAuth = () => useContext(AuthContext);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const { data: walletClient } = useWalletClient();
  const router = useRouter();

  const login = useCallback(async () => {
    if (!address) {
      throw new Error('Wallet not connected');
    }

    if (!walletClient) {
      throw new Error('Wallet client not available');
    }

    try {
      setIsLoading(true);

      const { nonce, typedData } = await authService.challenge(address);

      const signature = await signTypedData(walletClient, {
        domain: typedData.domain as any,
        types: { Message: typedData.types.Message } as any,
        primaryType: 'Message',
        message: typedData.message as any,
      });

      const session = await authService.authenticate({
        wallet: address,
        nonce,
        signature,
      });

      if (session.wallet.toLowerCase() !== address.toLowerCase()) {
        throw new Error('Signed wallet does not match the connected wallet');
      }

      setUser({ userId: session.userId, wallet: session.wallet });

      toast('Signed in successfully!');
      router.push('/portfolio/');
    } catch (error) {
      toast('Sign in failed. Please try again.', 'error');
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [address, walletClient, router]);

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch {
      // the refresh session may already be gone
    }

    clearTokens();
    setUser(null);
    disconnect();
    toast('Signed out successfully.');
    router.push('/');
  }, [disconnect, router]);

  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      setIsLoading(true);

      const token = await getAccessToken();
      const restored = currentUser();

      if (!cancelled && token && restored) {
        setUser(restored);
      }

      if (!cancelled) {
        setIsLoading(false);
      }
    };

    restore();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleExpired = () => {
      setUser(null);
      toast('Session expired. Please sign in again.', 'error');
      router.push('/');
    };

    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleExpired);

    return () => {
      window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleExpired);
    };
  }, [router]);

  return (
    <AuthContext.Provider
      value={{ isAuthenticated: user !== null, isLoading, user, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}
