import { GRAPHQL_ENDPOINT } from './config';
import { notifySessionExpired } from './auth/session';

export async function gqlFetch(query: string, variables: Record<string, unknown>) {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });

  const json = await response.json();

  if (json.errors) {
    if (json.errors.some((e: { message?: string }) => e.message === 'Authentication required')) {
      notifySessionExpired();
    }
    throw new Error(json.errors[0].message);
  }

  return json.data;
}
