import { gql } from '@apollo/client';

export const GET_POOLS_FOR_DEBT_REPAYMENTS = gql`
  query GetPoolsForDebtRepayments($input: FilterInput!) {
    getPools(input: $input) {
      id
      name
      poolAddress
      rwaAddress
      businessId
      ownerId
      ownerType
      virtualHoldReserve
      realHoldReserve
      virtualRwaReserve
      exitFeePercent
      paused
      isTargetReached
      isFullyReturned
      entryPeriodStart
      entryPeriodExpired
      incomingTranches {
        amount
        expiredAt
        returnedAmount
      }
      lastCompletedIncomingTranche
    }
  }
`;

export const GET_BUSINESSES_FOR_DEBT_REPAYMENTS = gql`
  query GetBusinessesForDebtRepayments($input: FilterInput!) {
    getBusinesses(input: $input) {
      id
      name
      ownerId
      ownerType
    }
  }
`;

export const GET_COMPANIES_FOR_DEBT_REPAYMENTS = gql`
  query GetCompaniesForDebtRepayments($input: GetCompaniesInput) {
    getCompanies(input: $input) {
      id
      name
    }
  }
`;

// Repayments transfer HOLD *to* the pool address (the inverse of Withdrawals'
// `from: wallet` burn transfers) — filtering by `to` over the caller's own
// pool addresses isolates their repayment transactions.
export const GET_DEBT_REPAYMENT_TRANSACTIONS = gql`
  query GetDebtRepaymentTransactions($input: GetTransactionsInput!) {
    getTransactions(input: $input) {
      id
      from
      to
      poolAddress
      transactionHash
      amount
      createdAt
    }
  }
`;

// Recipients count for the detail sidebar — distinct RWA holders of a single
// pool, fetched on demand (only while the sidebar for that pool is open).
export const GET_POOL_RECIPIENTS = gql`
  query GetPoolRecipients($input: GetBalancesInput!) {
    getBalances(input: $input) {
      id
      owner
      balance
    }
  }
`;
