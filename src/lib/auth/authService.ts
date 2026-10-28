import { apolloClient } from '../apollo/client';
import { LOGIN, LOGOUT, LOGOUT_ALL } from './operations';
import type { Session } from './session';

interface EIP712TypedData {
  types: {
    Message: Array<{ name: string; type: string }>;
  };
  primaryType: string;
  domain: {
    name: string;
    version: string;
  };
  message: {
    wallet: string;
    timestamp: number;
    message: string;
  };
}

interface LoginInput {
  wallet: string;
  signature: string;
  timestamp: number;
}

const WELCOME_MESSAGE =
  'Welcome to RWA Platform!\n\nWe prioritize the security of your assets and personal data. To ensure secure access to your account, we kindly request you to verify ownership of your wallet by signing this message.';

export const authService = {
  createTypedData(wallet: string): EIP712TypedData {
    const timestamp = Math.floor(Date.now() / 1000);

    return {
      types: {
        Message: [
          { name: 'wallet', type: 'address' },
          { name: 'timestamp', type: 'uint256' },
          { name: 'message', type: 'string' },
        ],
      },
      primaryType: 'Message',
      domain: {
        name: 'RWA Platform',
        version: '1',
      },
      message: {
        wallet,
        timestamp,
        message: WELCOME_MESSAGE,
      },
    };
  },

  async login(input: LoginInput): Promise<Session> {
    const { data, error } = await apolloClient.mutate<{ login: Session }>({
      mutation: LOGIN,
      variables: { input },
    });

    if (error) throw new Error(`Authentication error: ${error.message}`);
    if (!data?.login) throw new Error('Authentication failed');

    return data.login;
  },

  async logout(): Promise<void> {
    await apolloClient.mutate<{ logout: boolean }>({ mutation: LOGOUT });
  },

  async logoutAll(): Promise<void> {
    await apolloClient.mutate<{ logoutAll: boolean }>({ mutation: LOGOUT_ALL });
  },
};
