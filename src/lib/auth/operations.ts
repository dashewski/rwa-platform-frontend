import { gql } from '@apollo/client';

// Signs the user in; the gateway sets the session cookie in the response
export const LOGIN = gql`
  mutation Login($input: AuthSessionLoginInput!) {
    login(input: $input) {
      sessionId
      userId
      wallet
      expiresAt
    }
  }
`;

// Revokes the current session
export const LOGOUT = gql`
  mutation Logout {
    logout
  }
`;

// Revokes every session of the current user
export const LOGOUT_ALL = gql`
  mutation LogoutAll {
    logoutAll
  }
`;
