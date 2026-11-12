import { ApolloClient, InMemoryCache, HttpLink, ApolloLink, CombinedGraphQLErrors } from '@apollo/client';
import { ErrorLink } from '@apollo/client/link/error';
import { setContext } from '@apollo/client/link/context';
import { GRAPHQL_ENDPOINT } from '../config';
import { clearSession, getAccessToken } from '../auth/tokenManager';

declare module '@apollo/client' {
  namespace ApolloClient {
    namespace DeclareDefaultOptions {
      interface WatchQuery {
        errorPolicy?: 'all';
        fetchPolicy?: 'network-only';
      }
      interface Query {
        errorPolicy?: 'all';
        fetchPolicy?: 'network-only';
      }
      interface Mutate {
        errorPolicy?: 'all';
      }
    }
  }
}

const authLink = setContext(async (_, { headers }) => {
  const token = await getAccessToken();

  return {
    headers: {
      ...headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
});

const httpLink = new HttpLink({ uri: GRAPHQL_ENDPOINT, credentials: 'include' });

const errorLink = new ErrorLink(({ error }) => {
  if (
    CombinedGraphQLErrors.is(error) &&
    error.errors.some((e) => e.message === 'Authentication required')
  ) {
    // Security invariant: never refresh/replay a GraphQL Mutation automatically after an auth failure.
    clearSession();
  }
});

export const apolloClient = new ApolloClient({
  link: ApolloLink.from([errorLink, authLink, httpLink]),
  cache: new InMemoryCache(),
  defaultOptions: {
    watchQuery: {
      fetchPolicy: 'network-only',
      errorPolicy: 'all',
    },
    query: {
      fetchPolicy: 'network-only',
      errorPolicy: 'all',
    },
    mutate: {
      errorPolicy: 'all',
    },
  },
});
