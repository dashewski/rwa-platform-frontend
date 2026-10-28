import { API_ENDPOINT } from '../config';

export interface Session {
  sessionId: string;
  userId: string;
  wallet: string;
  expiresAt: number;
}

export const SESSION_EXPIRED_EVENT = 'auth:session-expired';

let inflight: Promise<Session | null> | null = null;

// The session lives in an HttpOnly cookie: the browser sends it, we only ask
// the gateway who we are. Returns null for guests and when the gateway is down.
export function getSession(): Promise<Session | null> {
  if (typeof window === 'undefined') {
    return Promise.resolve(null);
  }

  if (!inflight) {
    inflight = fetch(`${API_ENDPOINT}/getMySession`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) {
          return null;
        }

        return (await response.json()) as Session;
      })
      .catch(() => null)
      .finally(() => {
        inflight = null;
      });
  }

  return inflight;
}

export function notifySessionExpired(): void {
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}
