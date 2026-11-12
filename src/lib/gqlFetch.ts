import { GRAPHQL_ENDPOINT } from './config';
import { clearSession, getAccessToken } from './auth/tokenManager';

export async function gqlFetch(query: string, variables: Record<string, unknown>) {
  const token = await getAccessToken();

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await response.json();

  if (json.errors) {
    if (json.errors.some((e: { message?: string }) => e.message === 'Authentication required')) {
      clearSession();
    }
    throw new Error(json.errors[0].message);
  }

  return json.data;
}
