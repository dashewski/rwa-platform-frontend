import { API_ENDPOINT } from '../config';
import { saveAccessToken } from './tokenManager';

interface TypedData {
  domain: {
    name: string;
    version: string;
  };
  types: {
    Message: Array<{ name: string; type: string }>;
  };
  primaryType: string;
  message: {
    domain: string;
    wallet: string;
    nonce: string;
    message: string;
  };
}

interface ChallengeResponse {
  nonce: string;
  expiresAt: number;
  typedData: TypedData;
}

interface AuthenticateInput {
  wallet: string;
  nonce: string;
  signature: string;
}

interface SessionResponse {
  userId: string;
  wallet: string;
  accessToken: string;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_ENDPOINT}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error?.message ?? data?.message ?? `HTTP ${response.status}`);
  }

  return data as T;
}

export const authService = {
  challenge(wallet: string): Promise<ChallengeResponse> {
    return post<ChallengeResponse>('/auth/challenge', { wallet });
  },

  async authenticate(input: AuthenticateInput): Promise<SessionResponse> {
    const data = await post<SessionResponse>('/auth/authenticate', input);

    saveAccessToken(data.accessToken, { userId: data.userId, wallet: data.wallet });

    return data;
  },

  async logout(): Promise<void> {
    await post<{ ok: boolean }>('/auth/logout');
  },

  async logoutAll(): Promise<number> {
    const data = await post<{ revokedCount: number }>('/auth/logoutAll');

    return data.revokedCount;
  },
};
