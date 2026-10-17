import { gql } from '@apollo/client';

export const GET_POOL_BY_ID = gql`
  query GetPoolById($id: ID!) {
    getPool(id: $id) {
      id
      name
      businessId
      description
      poolAddress
      rwaAddress
      expectedHoldAmount
      expectedRwaAmount
      rewardPercent
      entryFeePercent
      exitFeePercent
      entryPeriodStart
      entryPeriodExpired
      completionPeriodExpired
      fixedSell
      paused
      tags
      image
      imageUrl
      fileId
      chainId
      createdAt
      realHoldReserve
      virtualHoldReserve
      virtualRwaReserve
      isTargetReached
      isFullyReturned
      awaitingRwaAmount
      allowEntryBurn
      ownerId
      ownerType
      incomingTranches {
        amount
        expiredAt
        returnedAmount
      }
    }
  }
`;

export const GET_POOL_DETAIL = gql`
  query GetPoolDetail($input: FilterInput!) {
    getPools(input: $input) {
      id
      name
      businessId
      description
      poolAddress
      rwaAddress
      expectedHoldAmount
      expectedRwaAmount
      rewardPercent
      entryFeePercent
      exitFeePercent
      entryPeriodStart
      entryPeriodExpired
      completionPeriodExpired
      fixedSell
      paused
      tags
      image
      imageUrl
      fileId
      chainId
      createdAt
      realHoldReserve
      virtualHoldReserve
      virtualRwaReserve
      isTargetReached
      incomingTranches {
        amount
        expiredAt
        returnedAmount
      }
    }
  }
`;

export const GET_POOLS= gql`
  query GetPools($input: FilterInput!) {
    getPools(input: $input) {
      id
      name
      businessId
      description
      poolAddress
      expectedHoldAmount
      expectedRwaAmount
      rewardPercent
      entryPeriodStart
      entryPeriodExpired
      completionPeriodExpired
      fixedSell
      paused
      chainId
      createdAt
      image
      imageUrl
      fileId
      realHoldReserve
      virtualHoldReserve
      virtualRwaReserve
      isFullyReturned
      isTargetReached
      tags
      riskScore
    }
  }
`;

export const CREATE_POOL = gql`
  mutation CreatePool($input: CreatePoolInput!) {
    createPool(input: $input) {
      id
      rwaAddress
      chainId
      ownerId
      ownerType
      entryFeePercent
      exitFeePercent
      expectedHoldAmount
      expectedRwaAmount
      rewardPercent
      priceImpactPercent
      entryPeriodStart
      entryPeriodExpired
      completionPeriodExpired
      fixedSell
      allowEntryBurn
      awaitCompletionExpired
      floatingOutTranchesTimestamps
      outgoingTranches {
        amount
        timestamp
        executedAmount
      }
      incomingTranches {
        amount
        expiredAt
        returnedAmount
      }
    }
  }
`;

export const REQUEST_POOL_APPROVAL_SIGNATURES = gql`
  mutation RequestPoolApprovalSignatures($input: RequestPoolApprovalSignaturesInput!) {
    requestPoolApprovalSignatures(input: $input) {
      taskId
    }
  }
`;

export const GET_RAW_PRICE_DATA = gql`
  query GetRawPriceData($input: GetRawPriceDataInput!) {
    getRawPriceData(input: $input) {
      timestamp
      price
    }
  }
`;

export const EDIT_POOL = gql`
  mutation EditPool($input: EditPoolInput!) {
    editPool(input: $input) {
      id
      name
      description
      tags
      image
      imageUrl
      fileId
    }
  }
`;

export const GET_LATEST_PRICE = gql`
  query GetLatestPrice($input: GetRawPriceDataInput!) {
    getRawPriceData(input: $input) {
      price
    }
  }
`;

export const GET_OHLC_PRICE_DATA = gql`
  query GetOhlcPriceData($input: GetOhlcPriceDataInput!) {
    getOhlcPriceData(input: $input) {
      timestamp
      open
      high
      low
      close
    }
  }
`;

export const GET_VOLUME_DATA = gql`
  query GetVolumeData($input: GetVolumeDataInput!) {
    getVolumeData(input: $input) {
      timestamp
      mintVolume
      burnVolume
    }
  }
`;

export const GET_SIGNATURE_TASK = gql`
  query GetSignatureTask($input: GetSignatureTaskInput!) {
    getSignatureTask(input: $input) {
      id
      completed
      expired
      signatures {
        signer
        signature
      }
    }
  }
`;

// Everything the Deploy button needs: the signed fields (the deployPool args are rebuilt from
// them) plus the state of the signature task, so a pending task is reused instead of re-requested.
export const GET_POOL_DEPLOY_INFO = gql`
  query GetPoolDeployInfo($id: ID!) {
    getPool(id: $id) {
      id
      poolAddress
      rwaAddress
      expectedHoldAmount
      expectedRwaAmount
      priceImpactPercent
      rewardPercent
      entryPeriodStart
      entryPeriodExpired
      completionPeriodExpired
      entryFeePercent
      exitFeePercent
      fixedSell
      allowEntryBurn
      awaitCompletionExpired
      floatingOutTranchesTimestamps
      outgoingTranches {
        amount
        timestamp
      }
      incomingTranches {
        amount
        expiredAt
      }
      approvalSignaturesTaskId
      approvalSignaturesTaskExpired
    }
  }
`;

export const REJECT_POOL_APPROVAL_SIGNATURES = gql`
  mutation RejectPoolApprovalSignatures($id: ID!) {
    rejectPoolApprovalSignatures(id: $id)
  }
`;
