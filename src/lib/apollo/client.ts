import { ApolloClient, InMemoryCache, HttpLink, ApolloLink, CombinedGraphQLErrors } from '@apollo/client';
import { ErrorLink } from '@apollo/client/link/error';
import { GRAPHQL_ENDPOINT } from '../config';
import { notifySessionExpired } from '../auth/session';

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

const httpLink = new HttpLink({ uri: GRAPHQL_ENDPOINT, credentials: 'include' });

const errorLink = new ErrorLink(({ error }) => {
  if (
    CombinedGraphQLErrors.is(error) &&
    error.errors.some((e) => e.message === 'Authentication required')
  ) {
    notifySessionExpired();
  }
});

export const apolloClient = new ApolloClient({
  link: ApolloLink.from([errorLink, httpLink]),
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
