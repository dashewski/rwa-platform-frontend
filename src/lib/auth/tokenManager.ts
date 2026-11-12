'use client';

import { API_ENDPOINT } from '../config';

const SKEW_SEC = 60;

export const AUTH_SESSION_EXPIRED_EVENT = 'auth:session-expired';

let accessToken: string | null = null;
let sessionUser: { userId: string; wallet: string } | null = null;
let refreshInFlight: Promise<boolean> | null = null;
let sessionExpiredNotified = false;

function decodeExp(token: string): number {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');

    return JSON.parse(atob(payload)).exp ?? 0;
  } catch {
    return 0;
  }
}

function isFresh(token: string): boolean {
  return decodeExp(token) - Date.now() / 1000 > SKEW_SEC;
}

export function saveAccessToken(token: string, user?: { userId: string; wallet: string }): void {
  accessToken = token;

  if (user) {
    sessionUser = user;
  }

  sessionExpiredNotified = false;
}

export function currentUser(): { userId: string; wallet: string } | null {
  return sessionUser;
}

export function clearTokens(): void {
  accessToken = null;
  sessionUser = null;
}

export function clearSession(): void {
  clearTokens();

  if (sessionExpiredNotified) {
    return;
  }

  sessionExpiredNotified = true;

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
  }
}

async function performRefresh(): Promise<boolean> {
  try {
    const response = await fetch(`${API_ENDPOINT}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();

    saveAccessToken(data.accessToken, { userId: data.userId, wallet: data.wallet });

    return true;
  } catch {
    return false;
  }
}

export async function getAccessToken(): Promise<string | null> {
  if (accessToken && isFresh(accessToken)) {
    return accessToken;
  }

  if (typeof navigator === 'undefined') {
    return null;
  }

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      let refreshed = false;

      await navigator.locks.request('auth-refresh', async () => {
        refreshed = await performRefresh();
      });

      return refreshed;
    })().finally(() => {
      refreshInFlight = null;
    });
  }

  const refreshed = await refreshInFlight;

  if (!refreshed) {
    clearSession();

    return null;
  }

  return accessToken;
}
