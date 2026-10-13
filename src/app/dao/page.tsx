'use client';

import React, { FC, useMemo, useRef, useState } from 'react';
import { DashboardLayout, Wrapper } from '@/components/layout';
import { Icon, Pagination, toast } from '@/components/ui';
import { Modal } from '@/components/common';
import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi';
import { useApolloClient, useQuery } from '@apollo/client/react';
import { encodeFunctionData, formatUnits, parseUnits } from 'viem';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import clsx from 'clsx';

import { GET_PROPOSALS, GET_VOTES } from '@/lib/dao/operations';
import { useKeepInViewport } from '@/lib/useKeepInViewport';
import { GOVERNANCE_ABI, CONFIG_ABI, DAO_STAKING_ABI, POOL_PAUSE_ABI, TREASURY_ABI } from '@/lib/dao/abi';
import {
  GOVERNANCE_ADDRESS, CONFIG_ADDRESS, DAO_STAKING_ADDRESS, TREASURY_ADDRESS, PLT_TOKEN_ADDRESS,
  ERC20_APPROVE_ABI,
} from '@/lib/contracts';
import { useAuth } from '@/lib/auth/AuthContext';
import type { Proposal as GqlProposal, Vote as GqlVote } from '@/gql/graphql';

type ProposalStatus = 'pending' | 'succeeded' | 'rejected';
type DaoTab = 'create' | 'proposals';
type StakeTab = 'stake' | 'unstake';

interface Proposal {
  id: string;
  proposalId: string;
  status: ProposalStatus;
  title: string;
  description: string;
  votingEnded: string;
  proposedBy: string;
  proposerAddress: string;
  forPercent: number;
  againstPercent: number;
  voters: number;
}

interface ActionParam {
  name: string;
  hint: string;
  tooltip?: string;
  validate?: (v: string, all: Record<string, string>) => string | null;
}

interface ConfirmData {
  contract: string;
  action: string;
  paramValues: Record<string, string>;
  description: string;
}

const FAQ_ITEMS = [
  {
    question: 'What is Slices Governance?',
    answer: 'Slices Governance allows DAO members to vote on protocol-level decisions, including platform settings, staking parameters, treasury actions, and pool-level freeze proposals.',
  },
  {
    question: 'What is voting power?',
    answer: 'Voting power represents your influence in DAO decisions. You receive voting power by staking PLT. The more voting power you have, the more weight your vote carries.',
  },
  {
    question: 'Why stake PLT?',
    answer: 'Staking PLT gives you voting power and allows you to participate in Slices DAO governance. Users with enough voting power may also create proposals.',
  },
  {
    question: 'Who can create proposals?',
    answer: 'Proposal creation requires a minimum amount of voting power. Users who do not meet the requirement can still vote on active proposals.',
  },
  {
    question: 'What can DAO change?',
    answer: 'DAO can vote on platform parameters, staking settings, treasury actions, selected protocol-level updates, and pool-level actions such as freeze proposals.',
  },
  {
    question: 'Can DAO freeze a pool?',
    answer: 'Yes. Only DAO governance can freeze a pool on-chain. The Slices interface may hide a pool during review, but contract-level freezing requires a successful DAO vote.',
  },
  {
    question: 'What is the difference between hiding and freezing a pool?',
    answer: 'Hiding a pool removes it from the Slices interface during review. Freezing a pool is an on-chain action that restricts the pool at the smart-contract level and can only happen through DAO governance.',
  },
  {
    question: 'Are staking rewards guaranteed?',
    answer: 'No. Any rewards, voting power, or governance mechanics may depend on protocol rules and can change over time through governance decisions.',
  },
];


const vBp = (minBp = 100, maxBp = 10000) => (v: string, _all: Record<string, string>): string | null => {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return 'Must be a whole number';
  if (n > maxBp) return `Cannot exceed ${maxBp} bp (= ${maxBp / 100}%)`;
  if (n % 100 !== 0) return 'Must be a multiple of 100 (tip: 100 bp = 1%, 500 bp = 5%)';
  if (n < minBp) return `Minimum is ${minBp} bp (= ${minBp / 100}%)`;
  return null;
};

const vBpZero = (maxBp = 10000) => (v: string, _all: Record<string, string>): string | null => {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return 'Must be a whole number';
  if (n < 0) return 'Cannot be negative';
  if (n > maxBp) return `Cannot exceed ${maxBp} bp (= ${maxBp / 100}%)`;
  if (n > 0 && n % 100 !== 0) return 'Must be a multiple of 100 (100 bp = 1%) or 0 to disable';
  return null;
};

const vSec = (v: string, _all: Record<string, string>): string | null => {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return 'Must be a positive integer in seconds (tip: 86400 = 1 day)';
  return null;
};

const vSecNonNeg = (v: string, _all: Record<string, string>): string | null => {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return 'Must be a non-negative integer in seconds';
  return null;
};

const vWei = (v: string, _all: Record<string, string>): string | null => {
  if (!v) return null;
  if (!/^\d+$/.test(v)) return 'Must be a positive integer in wei (no decimals). 1 token = 10^18 wei';
  if (v === '0') return 'Must be greater than 0';
  return null;
};

const vAddr = (v: string, _all: Record<string, string>): string | null => {
  if (!v) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) return 'Must be a valid Ethereum address (0x... 40 hex chars)';
  if (/^0x0+$/.test(v)) return 'Cannot be the zero address';
  return null;
};

const vCount = (minVal = 1) => (v: string, _all: Record<string, string>): string | null => {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < minVal) return `Must be a positive integer ≥ ${minVal}`;
  return null;
};

const vBpMin = (v: string, all: Record<string, string>): string | null => {
  const e = vBp()(v, all); if (e) return e;
  if (v && all['newMax'] && Number(v) >= Number(all['newMax'])) return 'Min must be less than max';
  return null;
};
const vBpMax = (v: string, all: Record<string, string>): string | null => {
  const e = vBp()(v, all); if (e) return e;
  if (v && all['newMin'] && Number(v) <= Number(all['newMin'])) return 'Max must be greater than min';
  return null;
};
const vSecMin = (v: string, all: Record<string, string>): string | null => {
  const e = vSec(v, all); if (e) return e;
  if (v && all['newMax'] && Number(v) >= Number(all['newMax'])) return 'Min must be less than max';
  return null;
};
const vSecMax = (v: string, all: Record<string, string>): string | null => {
  const e = vSec(v, all); if (e) return e;
  if (v && all['newMin'] && Number(v) <= Number(all['newMin'])) return 'Max must be greater than min';
  return null;
};
const vWeiMin = (v: string, all: Record<string, string>): string | null => {
  const e = vWei(v, all); if (e) return e;
  if (v && all['newMax'] && Number(v) >= Number(all['newMax'])) return 'Min must be less than max';
  return null;
};
const vWeiMax = (v: string, all: Record<string, string>): string | null => {
  const e = vWei(v, all); if (e) return e;
  if (v && all['newMin'] && Number(v) <= Number(all['newMin'])) return 'Max must be greater than min';
  return null;
};

const CONTRACT_OPTIONS = ['Config', 'Pool', 'Treasury', 'DAO Staking'];

const ACTIONS_BY_CONTRACT: Record<string, string[]> = {
  'Config': [
    'updateVotingPeriod',
    'updateVotingDelay',
    'updateQuorumPercentage',
    'updateProposalThreshold',
    'updateTimelockDelay',
    'updateDaoStakingAnnualRewardRate',
    'updateCreateRWAFeeRange',
    'updateCreatePoolFeeRatioRange',
    'updateEntryFeePercentRange',
    'updateExitFeePercentRange',
    'updateRewardPercentRange',
    'updateExpectedHoldAmountRange',
    'updateExpectedRwaAmountRange',
    'updateEntryPeriodDurationRange',
    'updateCompletionPeriodDurationRange',
    'updateEntryPeriodConfig',
    'updateOutgoingTranchesConfig',
    'updateIncomingTranchesConfig',
    'updateMinSignersRequired',
    'updateHoldToken',
    'updateBaseMetadataUri',
  ],
  'Pool':        ['enablePause', 'disablePause'],
  'Treasury':    ['withdrawERC20', 'withdrawETH'],
  'DAO Staking': ['lock'],
};

const PARAMS_BY_ACTION: Record<string, ActionParam[]> = {
  'updateVotingPeriod': [
    { name: 'newVotingPeriod', hint: 'e.g. 259200 (tip: 86400 sec = 1 day, 604800 = 1 week)', tooltip: 'Duration of the voting window in seconds', validate: vSec },
  ],
  'updateVotingDelay': [
    { name: 'newVotingDelay', hint: 'e.g. 86400 (tip: 86400 sec = 1 day; 0 = no delay)', validate: vSecNonNeg },
  ],
  'updateTimelockDelay': [
    { name: 'newTimelockDelay', hint: 'e.g. 172800 (tip: 86400 sec = 1 day)', tooltip: 'Delay before an approved proposal can be executed', validate: vSec },
  ],
  'updateEntryPeriodDurationRange': [
    { name: 'newMin', hint: 'e.g. 86400 (tip: 86400 = 1 day)', validate: vSecMin },
    { name: 'newMax', hint: 'e.g. 2592000 (tip: ~30 days; must be > min)', validate: vSecMax },
  ],
  'updateCompletionPeriodDurationRange': [
    { name: 'newMin', hint: 'e.g. 604800 (tip: ~7 days)', validate: vSecMin },
    { name: 'newMax', hint: 'e.g. 15552000 (tip: ~180 days; must be > min)', validate: vSecMax },
  ],
  'updateEntryPeriodConfig': [
    { name: 'newMaxPastOffset',   hint: 'e.g. 86400 (tip: 86400 = 1 day)', tooltip: 'Max seconds in the past entry period can start from now', validate: vSec },
    { name: 'newMaxFutureOffset', hint: 'e.g. 604800 (must be > newMaxPastOffset)', tooltip: 'Max seconds in the future entry period can start from now', validate: (v, all) => {
      const e = vSec(v, all); if (e) return e;
      if (v && all['newMaxPastOffset'] && Number(v) <= Number(all['newMaxPastOffset'])) return 'Must be greater than newMaxPastOffset';
      return null;
    }},
  ],

  'updateQuorumPercentage': [
    { name: 'newQuorumPercentage', hint: 'e.g. 500 (tip: 100 bp = 1%, 10000 bp = 100%)', tooltip: 'Min % of total voting power needed for a proposal to pass', validate: vBp(100, 10000) },
  ],
  'updateDaoStakingAnnualRewardRate': [
    { name: 'newRewardRate', hint: 'e.g. 500 (tip: 100 bp = 1% APR; 0 to disable rewards)', tooltip: 'Annual staking reward rate in basis points', validate: vBpZero() },
  ],
  'updateCreateRWAFeeRange': [
    { name: 'newMin', hint: 'e.g. 100 (tip: 100 bp = 1%)', validate: vBpMin },
    { name: 'newMax', hint: 'e.g. 1000 (tip: max ≤ 10000 bp; must be > min)', validate: vBpMax },
  ],
  'updateCreatePoolFeeRatioRange': [
    { name: 'newMin', hint: 'e.g. 100 (tip: 100 bp = 1%)', validate: vBpMin },
    { name: 'newMax', hint: 'e.g. 500 (tip: max ≤ 10000 bp; must be > min)', validate: vBpMax },
  ],
  'updateEntryFeePercentRange': [
    { name: 'newMin', hint: 'e.g. 100 (tip: 100 bp = 1%)', validate: vBpMin },
    { name: 'newMax', hint: 'e.g. 500 (tip: max ≤ 10000 bp; must be > min)', validate: vBpMax },
  ],
  'updateExitFeePercentRange': [
    { name: 'newMin', hint: 'e.g. 100 (tip: 100 bp = 1%)', validate: vBpMin },
    { name: 'newMax', hint: 'e.g. 500 (tip: max ≤ 10000 bp; must be > min)', validate: vBpMax },
  ],
  'updateRewardPercentRange': [
    { name: 'newMin', hint: 'e.g. 500 (tip: 100 bp = 1%)', validate: vBpMin },
    { name: 'newMax', hint: 'e.g. 5000 (tip: max ≤ 10000 bp; must be > min)', validate: vBpMax },
  ],

  'updateExpectedHoldAmountRange': [
    { name: 'newMin', hint: 'e.g. 1000000000000000000 (tip: 1e18 = 1 token)', validate: vWeiMin },
    { name: 'newMax', hint: 'e.g. 100000000000000000000 (must be > min)', validate: vWeiMax },
  ],
  'updateExpectedRwaAmountRange': [
    { name: 'newMin', hint: 'e.g. 1000000000000000000 (tip: 1e18 = 1 token)', validate: vWeiMin },
    { name: 'newMax', hint: 'e.g. 100000000000000000000 (must be > min)', validate: vWeiMax },
  ],

  'updateProposalThreshold': [
    { name: 'newProposalThreshold', hint: 'e.g. 1000000000000000000000 (tip: 1e18 = 1 PLT)', tooltip: 'Min voting power (staked PLT) required to submit a proposal', validate: vWei },
  ],
  'updateMinSignersRequired': [
    { name: 'newMinSignersRequired', hint: 'e.g. 3 (must be ≥ 1)', validate: vCount() },
  ],
  'updateHoldToken': [
    { name: 'newHoldToken', hint: '0x... ERC-20 token contract address', validate: vAddr },
  ],
  'updateBaseMetadataUri': [
    { name: 'newBaseMetadataUri', hint: 'e.g. https://api.slices.fi/metadata/' },
  ],
  'updateOutgoingTranchesConfig': [
    { name: 'newMinCount',    hint: 'e.g. 1 (min number of outgoing tranches, ≥ 1)', validate: vCount() },
    { name: 'newMaxCount',    hint: 'e.g. 12 (must be ≥ newMinCount)', validate: (v, all) => {
      const e = vCount()(v, all); if (e) return e;
      if (v && all['newMinCount'] && Number(v) < Number(all['newMinCount'])) return 'Must be ≥ newMinCount';
      return null;
    }},
    { name: 'newMinPercent',  hint: 'e.g. 100 (tip: 100 bp = 1%)', validate: (v, all) => {
      const e = vBp(100, 9999)(v, all); if (e) return e;
      if (v && all['newMaxPercent'] && Number(v) >= Number(all['newMaxPercent'])) return 'Must be < newMaxPercent';
      return null;
    }},
    { name: 'newMaxPercent',  hint: 'e.g. 5000 (max ≤ 10000; must be > newMinPercent)', validate: (v, all) => {
      const e = vBp()(v, all); if (e) return e;
      if (v && all['newMinPercent'] && Number(v) <= Number(all['newMinPercent'])) return 'Must be > newMinPercent';
      return null;
    }},
    { name: 'newMinInterval', hint: 'e.g. 2592000 (tip: 86400 = 1 day)', validate: vSec },
  ],
  'updateIncomingTranchesConfig': [
    { name: 'newMinCount',    hint: 'e.g. 1 (min number of incoming tranches, ≥ 1)', validate: vCount() },
    { name: 'newMaxCount',    hint: 'e.g. 12 (must be ≥ newMinCount)', validate: (v, all) => {
      const e = vCount()(v, all); if (e) return e;
      if (v && all['newMinCount'] && Number(v) < Number(all['newMinCount'])) return 'Must be ≥ newMinCount';
      return null;
    }},
    { name: 'newMinPercent',  hint: 'e.g. 100 (tip: 100 bp = 1%)', validate: (v, all) => {
      const e = vBp(100, 9999)(v, all); if (e) return e;
      if (v && all['newMaxPercent'] && Number(v) >= Number(all['newMaxPercent'])) return 'Must be < newMaxPercent';
      return null;
    }},
    { name: 'newMaxPercent',  hint: 'e.g. 5000 (max ≤ 10000; must be > newMinPercent)', validate: (v, all) => {
      const e = vBp()(v, all); if (e) return e;
      if (v && all['newMinPercent'] && Number(v) <= Number(all['newMinPercent'])) return 'Must be > newMinPercent';
      return null;
    }},
    { name: 'newMinInterval', hint: 'e.g. 2592000 (tip: 86400 = 1 day)', validate: vSec },
  ],

  'enablePause': [
    { name: 'poolAddress', hint: '0x... Pool contract address to freeze', tooltip: 'On-chain address of the pool contract. Only DAO can freeze a pool.', validate: vAddr },
  ],
  'disablePause': [
    { name: 'poolAddress', hint: '0x... Pool contract address to unfreeze', tooltip: 'On-chain address of the pool contract.', validate: vAddr },
  ],

  'withdrawERC20': [
    { name: 'token',  hint: '0x... ERC-20 token contract address', validate: vAddr },
    { name: 'to',     hint: '0x... Recipient wallet address', validate: vAddr },
    { name: 'amount', hint: 'e.g. 1000000000000000000 (tip: 1e18 = 1 token in wei)', validate: vWei },
  ],
  'withdrawETH': [
    { name: 'to',     hint: '0x... Recipient wallet address', validate: vAddr },
    { name: 'amount', hint: 'e.g. 1000000000000000000 (tip: 1e18 = 1 BNB in wei)', validate: vWei },
  ],

  'lock': [
    { name: 'user',            hint: '0x... User wallet address to lock', validate: vAddr },
    { name: 'unlockTimestamp', hint: 'Unix timestamp e.g. 1800000000 (must be in the future)', tooltip: 'Unix timestamp when the lock expires and user can unstake', validate: (v, _all) => {
      if (!v) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return 'Must be a positive Unix timestamp integer';
      if (n < Date.now() / 1000) return 'Timestamp must be in the future';
      return null;
    }},
  ],
};

const CONTRACT_ADDRESSES: Record<string, `0x${string}`> = {
  'Config':      CONFIG_ADDRESS,
  'Treasury':    TREASURY_ADDRESS,
  'DAO Staking': DAO_STAKING_ADDRESS,
  // Pool: address is dynamic — entered by user in poolAddress field
};


const STATUS_CONFIG: Record<ProposalStatus, { label: string; textClass: string }> = {
  pending:   { label: 'Pending',   textClass: 'text-[#d09005]' },
  succeeded: { label: 'Succeeded', textClass: 'text-[#5c9557]' },
  rejected:  { label: 'Rejected',  textClass: 'text-[#a22c14]' },
};


type Hex = `0x${string}`;

// builds the (target, calldata) pair that Governance.propose() expects
// signatures come from Config_Implementation.json / Treasury.json in deployments/bscTestnet
const buildProposalCalldata = (
  contract: string,
  action: string,
  paramValues: Record<string, string>,
): { target: Hex; calldata: Hex } => {
  const v = paramValues;
  const bn = (key: string) => BigInt(v[key]);
  const addr = (key: string) => v[key] as Hex;

  if (contract === 'Pool') {
    return {
      target: addr('poolAddress'),
      calldata: encodeFunctionData({ abi: POOL_PAUSE_ABI, functionName: action as 'enablePause' | 'disablePause', args: [] }),
    };
  }

  if (contract === 'Treasury') {
    if (action === 'withdrawERC20') {
      return { target: TREASURY_ADDRESS, calldata: encodeFunctionData({ abi: TREASURY_ABI, functionName: 'withdrawERC20', args: [addr('token'), addr('to'), bn('amount')] }) };
    }
    return { target: TREASURY_ADDRESS, calldata: encodeFunctionData({ abi: TREASURY_ABI, functionName: 'withdrawETH', args: [addr('to'), bn('amount')] }) };
  }

  if (contract === 'DAO Staking') {
    return {
      target: DAO_STAKING_ADDRESS,
      calldata: encodeFunctionData({ abi: DAO_STAKING_ABI, functionName: 'lock', args: [addr('user'), bn('unlockTimestamp')] }),
    };
  }

  // Config
  switch (action) {
    case 'updateVotingPeriod':                return { target: CONFIG_ADDRESS, calldata: encodeFunctionData({ abi: CONFIG_ABI, functionName: action, args: [bn('newVotingPeriod')] }) };
    case 'updateVotingDelay':                 return { target: CONFIG_ADDRESS, calldata: encodeFunctionData({ abi: CONFIG_ABI, functionName: action, args: [bn('newVotingDelay')] }) };
    case 'updateQuorumPercentage':            return { target: CONFIG_ADDRESS, calldata: encodeFunctionData({ abi: CONFIG_ABI, functionName: action, args: [bn('newQuorumPercentage')] }) };
    case 'updateProposalThreshold':           return { target: CONFIG_ADDRESS, calldata: encodeFunctionData({ abi: CONFIG_ABI, functionName: action, args: [bn('newProposalThreshold')] }) };
    case 'updateTimelockDelay':               return { target: CONFIG_ADDRESS, calldata: encodeFunctionData({ abi: CONFIG_ABI, functionName: action, args: [bn('newTimelockDelay')] }) };
    case 'updateDaoStakingAnnualRewardRate':  return { target: CONFIG_ADDRESS, calldata: encodeFunctionData({ abi: CONFIG_ABI, functionName: action, args: [bn('newRewardRate')] }) };
    case 'updateCreateRWAFeeRange':           return { target: CONFIG_ADDRESS, calldata: encodeFunctionData({ abi: CONFIG_ABI, functionName: action, args: [bn('newMin'), bn('newMax')] }) };
    case 'updateCreatePoolFeeRatioRange':     return { target: CONFIG_ADDRESS, calldata: encodeFunctionData({ abi: CONFIG_ABI, functionName: action, args: [bn('newMin'), bn('newMax')] }) };
    case 'updateEntryFeePercentRange':        return { target: CONFIG_ADDRESS, calldata: encodeFunctionData({ abi: CONFIG_ABI, functionName: action, args: [bn('newMin'), bn('newMax')] }) };
    case 'updateExitFeePercentRange':         return { target: CONFIG_ADDRESS, calldata: encodeFunctionData({ abi: CONFIG_ABI, functionName: action, args: [bn('newMin'), bn('newMax')] }) };
    case 'updateRewardPercentRange':          return { target: CONFIG_ADDRESS, calldata: encodeFunctionData({ abi: CONFIG_ABI, functionName: action, args: [bn('newMin'), bn('newMax')] }) };
    case 'updateExpectedHoldAmountRange':     return { target: CONFIG_ADDRESS, calldata: encodeFunctionData({ abi: CONFIG_ABI, functionName: action, args: [bn('newMin'), bn('newMax')] }) };
    case 'updateExpectedRwaAmountRange':      return { target: CONFIG_ADDRESS, calldata: encodeFunctionData({ abi: CONFIG_ABI, functionName: action, args: [bn('newMin'), bn('newMax')] }) };
    case 'updateEntryPeriodDurationRange':    return { target: CONFIG_ADDRESS, calldata: encodeFunctionData({ abi: CONFIG_ABI, functionName: action, args: [bn('newMin'), bn('newMax')] }) };
    case 'updateCompletionPeriodDurationRange': return { target: CONFIG_ADDRESS, calldata: encodeFunctionData({ abi: CONFIG_ABI, functionName: action, args: [bn('newMin'), bn('newMax')] }) };
    case 'updateEntryPeriodConfig':           return { target: CONFIG_ADDRESS, calldata: encodeFunctionData({ abi: CONFIG_ABI, functionName: action, args: [bn('newMaxPastOffset'), bn('newMaxFutureOffset')] }) };
    case 'updateOutgoingTranchesConfig':      return { target: CONFIG_ADDRESS, calldata: encodeFunctionData({ abi: CONFIG_ABI, functionName: action, args: [bn('newMinCount'), bn('newMaxCount'), bn('newMinPercent'), bn('newMaxPercent'), bn('newMinInterval')] }) };
    case 'updateIncomingTranchesConfig':      return { target: CONFIG_ADDRESS, calldata: encodeFunctionData({ abi: CONFIG_ABI, functionName: action, args: [bn('newMinCount'), bn('newMaxCount'), bn('newMinPercent'), bn('newMaxPercent'), bn('newMinInterval')] }) };
    case 'updateMinSignersRequired':          return { target: CONFIG_ADDRESS, calldata: encodeFunctionData({ abi: CONFIG_ABI, functionName: action, args: [bn('newMinSignersRequired')] }) };
    case 'updateHoldToken':                   return { target: CONFIG_ADDRESS, calldata: encodeFunctionData({ abi: CONFIG_ABI, functionName: action, args: [addr('newHoldToken')] }) };
    case 'updateBaseMetadataUri':             return { target: CONFIG_ADDRESS, calldata: encodeFunctionData({ abi: CONFIG_ABI, functionName: action, args: [v['newBaseMetadataUri']] }) };
    default: throw new Error(`Unknown Config action: ${action}`);
  }
};

const Dropdown: FC<{ placeholder: string; options: string[]; value: string; onChange: (v: string) => void }> = ({ placeholder, options, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handleBlur = () => setTimeout(() => setOpen(false), 150);

  return (
    <div className={'relative'} ref={ref} onBlur={handleBlur}>
      <button
        type={'button'}
        onClick={() => setOpen(o => !o)}
        className={clsx(
          'w-full flex items-center justify-between gap-2 px-2 py-3 border-2 rounded-md text-sm cursor-pointer tr-d text-left',
          open ? 'border-stroke-secondary' : 'border-stroke-secondary',
        )}
      >
        <span className={value ? 'text-black' : 'text-label-tertiary'}>
          {value || placeholder}
        </span>
        <Icon name={'tick'} className={clsx('size-3.5 shrink-0 tr-d-all text-grey-dark', open ? 'rotate-180' : '-rotate-90')} />
      </button>
      {open && (
        <div className={'absolute z-20 left-0 top-full mt-1 w-full max-h-[200px] overflow-y-auto bg-white border border-stroke-primary rounded-lg shadow-base py-2 scrollbar-hidden'}>
          {options.map(opt => (
            <button
              key={opt}
              type={'button'}
              className={clsx('w-full text-left px-3 py-2 text-sm tr-d cursor-pointer', opt === value ? 'bg-bg-tertiary text-black' : 'text-black hover:bg-bg-tertiary')}
              onMouseDown={() => { onChange(opt); setOpen(false); }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const Tooltip: FC<{ text: string }> = ({ text }) => {
  const [visible, setVisible] = useState(false);
  const { ref: tipRef, shift } = useKeepInViewport<HTMLDivElement>(visible);
  return (
    <span className={'relative inline-flex items-center'}>
      <button
        type={'button'}
        className={'cursor-pointer'}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
      >
        <Icon name={'info'} className={'size-3.5 text-grey-dark'} />
      </button>
      {visible && (
        <div
          ref={tipRef}
          className={'absolute bottom-full left-1/2 mb-2 w-[280px] bg-white border border-stroke-primary rounded-xl p-4 shadow-base z-30'}
          style={{ transform: `translateX(calc(-50% + ${shift}px))` }}
        >
          <p className={'text-sm leading-[1.2] text-grey-dark'}>{text}</p>
          <div
            className={'absolute top-full -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-stroke-primary'}
            style={{ left: `calc(50% - ${shift}px)` }}
          />
        </div>
      )}
    </span>
  );
};

const DaoFaqAccordion: FC = () => {
  const [openIndex, setOpenIndex] = useState(1);
  return (
    <div className={'flex flex-col gap-3'}>
      {FAQ_ITEMS.map((item, index) => (
        <div
          key={item.question}
          className={clsx('bg-bg-primary rounded-xl pl-4 pr-8 py-6', openIndex === index ? 'border-2 border-stroke-secondary' : 'border border-stroke-primary')}
        >
          <button className={'w-full flex items-center justify-between gap-4 cursor-pointer'} onClick={() => setOpenIndex(openIndex === index ? -1 : index)}>
            <span className={'text-xl font-semibold text-black text-left'}>{item.question}</span>
            <Icon name={'tick'} className={clsx('size-6 shrink-0 tr-d-all', openIndex === index ? 'rotate-180' : 'rotate-0')} />
          </button>
          {item.answer && (
            <div className={clsx('grid tr-d-all overflow-hidden', openIndex === index ? 'grid-rows-[1fr] mt-3' : 'grid-rows-[0fr]')}>
              <p className={'overflow-hidden text-base leading-[1.2] text-black max-w-[620px]'}>{item.answer}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const VotingPowerWidget: FC = () => {
  const [stakeTab, setStakeTab] = useState<StakeTab>('stake');
  const [amount, setAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  // The wallet can stay connected after the app session expires, so on-chain actions
  // also require a signed-in session — otherwise a signed-out user could still stake.
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const signedOut = !authLoading && !isAuthenticated;

  const { data: pltBalance, refetch: refetchPlt } = useReadContract({
    address: PLT_TOKEN_ADDRESS,
    abi: ERC20_APPROVE_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: staked, refetch: refetchStaked } = useReadContract({
    address: DAO_STAKING_ADDRESS,
    abi: DAO_STAKING_ABI,
    functionName: 'stakedAmount',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: votingPower, refetch: refetchVp } = useReadContract({
    address: DAO_STAKING_ADDRESS,
    abi: DAO_STAKING_ABI,
    functionName: 'getVotingPower',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const fmt = (v: unknown) =>
    v !== undefined ? Number(formatUnits(v as bigint, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';

  const displayBalance = stakeTab === 'stake' ? fmt(pltBalance) : fmt(staked);
  const vpDisplay = address ? fmt(votingPower) : '—';
  const insufficientPlt = address && stakeTab === 'stake' && (pltBalance as bigint | undefined) === BigInt(0);

  const handleAction = async () => {
    if (!address) { openConnectModal?.(); return; }
    if (authLoading) return;
    if (!isAuthenticated) { toast('Sign in to stake', 'warning'); return; }
    if (!amount || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const amountWei = parseUnits(amount, 18);
      if (stakeTab === 'stake') {
        // 2 txs: PLT.approve → DaoStaking.stake — no permit on this contract
        toast('Approving PLT…');
        const approveTx = await writeContractAsync({
          address: PLT_TOKEN_ADDRESS,
          abi: ERC20_APPROVE_ABI,
          functionName: 'approve',
          args: [DAO_STAKING_ADDRESS, amountWei],
        });
        await publicClient!.waitForTransactionReceipt({ hash: approveTx });
        const stakeTx = await writeContractAsync({
          address: DAO_STAKING_ADDRESS,
          abi: DAO_STAKING_ABI,
          functionName: 'stake',
          args: [amountWei],
        });
        await publicClient!.waitForTransactionReceipt({ hash: stakeTx });
        toast('Staked successfully!');
      } else {
        const unstakeTx = await writeContractAsync({
          address: DAO_STAKING_ADDRESS,
          abi: DAO_STAKING_ABI,
          functionName: 'unstake',
          args: [amountWei],
        });
        await publicClient!.waitForTransactionReceipt({ hash: unstakeTx });
        toast('Unstaked successfully!');
      }
      setAmount('');
      await Promise.all([refetchPlt(), refetchStaked(), refetchVp()]);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Transaction failed', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={'flex flex-col gap-6'}>
      <div className={'bg-bg-tertiary rounded-xl pb-4 flex flex-col gap-4'}>
        <div className={'pt-4 px-3 flex flex-col gap-3'}>
          <div className={'flex items-center gap-2 text-xl font-semibold text-black'}>
            <span>Voting power:</span><span>{vpDisplay} VP</span>
          </div>
          <p className={'text-base leading-[1.2] text-black max-w-[287px]'}>Lock your platform tokens to receive your voting power</p>
        </div>
        <div className={'px-3'}>
          <div className={'border border-stroke-primary rounded px-2 py-3 flex flex-col gap-2'}>
            <div className={'flex gap-2 text-sm text-grey-dark'}>
              <button className={clsx('cursor-pointer tr-d', stakeTab === 'stake' ? 'underline' : 'hover:text-black')} onClick={() => { setStakeTab('stake'); setAmount(''); }}>Stake</button>
              <button className={clsx('cursor-pointer tr-d', stakeTab === 'unstake' ? 'underline' : 'hover:text-black')} onClick={() => { setStakeTab('unstake'); setAmount(''); }}>Unstake</button>
            </div>
            <div className={'flex items-center justify-between'}>
              <span className={'text-lg font-semibold text-black'}>PLT TOKEN</span>
              <span className={'text-lg font-semibold text-black'}>{displayBalance}</span>
            </div>
            <input
              type={'number'}
              placeholder={'Amount'}
              value={amount}
              min={'0'}
              onChange={e => setAmount(e.target.value)}
              className={'w-full border border-stroke-primary rounded px-2 py-1.5 text-sm text-black placeholder:text-label-tertiary outline-none focus:border-stroke-secondary tr-d'}
            />
          </div>
        </div>
        {insufficientPlt && (
          <div className={'flex items-center justify-center gap-1.5'}>
            <span className={'text-sm text-red-bright'}>⚠ Insufficient platform tokens</span>
            <button className={'text-sm text-grey-dark underline cursor-pointer hover:text-black tr-d'}>Buy more</button>
          </div>
        )}
      </div>
      <div className={'px-4'}>
        <button
          onClick={handleAction}
          disabled={isSubmitting}
          className={clsx('w-full flex items-center justify-center bg-grey-dark text-white text-sm font-medium py-3 rounded-xl cursor-pointer hover:opacity-80 tr-d disabled:opacity-50', address && signedOut && 'opacity-50')}
        >
          {isSubmitting ? 'Processing…' : (address ? (stakeTab === 'stake' ? 'Stake' : 'Unstake') : 'Connect wallet')}
        </button>
      </div>
    </div>
  );
};

const ProposalCard: FC<{ proposal: Proposal }> = ({ proposal }) => {
  const { label, textClass } = STATUS_CONFIG[proposal.status];
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isEnded = proposal.status !== 'pending';

  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const apolloClient = useApolloClient();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const signedOut = !authLoading && !isAuthenticated;

  // skip for ended proposals — receipt doesn't change and saves an RPC call per card
  const { data: receipt, refetch: refetchReceipt } = useReadContract({
    address: GOVERNANCE_ADDRESS,
    abi: GOVERNANCE_ABI,
    functionName: 'getReceipt',
    args: address && proposal.proposalId ? [BigInt(proposal.proposalId), address] : undefined,
    query: { enabled: !!address && !!proposal.proposalId && !isEnded },
  });

  const receiptTyped = receipt as { hasVoted: boolean; support: boolean; votes: bigint } | undefined;
  const hasVoted = receiptTyped?.hasVoted ?? false;
  const userVote = hasVoted ? (receiptTyped?.support ? 'for' : 'against') : null;

  const handleVote = async (side: 'for' | 'against') => {
    if (isEnded || hasVoted || !address || isSubmitting || !proposal.proposalId) return;
    if (authLoading) return;
    if (!isAuthenticated) { toast('Sign in to vote', 'warning'); return; }
    setIsSubmitting(true);
    try {
      const tx = await writeContractAsync({
        address: GOVERNANCE_ADDRESS,
        abi: GOVERNANCE_ABI,
        functionName: 'vote',
        args: [BigInt(proposal.proposalId), side === 'for', ''],
      });
      await publicClient!.waitForTransactionReceipt({ hash: tx });
      toast('Vote submitted!');
      refetchReceipt(); // indexer usually catches up in <5s, worst case user sees stale % briefly
      // also ask the indexer-backed lists to refetch, so the aggregate for/against and voter
      // count (not just this user's own receipt) pick up the new vote without a manual reload
      apolloClient.refetchQueries({ include: ['GetProposals', 'GetVotes'] });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Vote failed', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // shift the bar immediately after user votes so it doesn't feel broken before indexer catches up
  const BUMP = 3;
  const forPct     = Math.min(100, Math.max(0, proposal.forPercent     + (userVote === 'for'     ? BUMP : userVote === 'against' ? -BUMP : 0)));
  const againstPct = 100 - forPct;

  return (
    <div className={'bg-bg-tertiary rounded-xl overflow-hidden pb-4 flex flex-col gap-4 h-full'}>
      <div className={'pt-4 px-3'}>
        <div className={'flex items-center gap-1.5 bg-bg-primary px-3 py-2 rounded-full w-fit'}>
          <span className={clsx('size-3 rounded-full border-2 shrink-0', textClass, 'border-current')} />
          <span className={clsx('text-sm', textClass)}>{label}</span>
        </div>
      </div>
      <div className={'px-3 flex flex-col gap-3'}>
        <p className={'text-xl font-semibold text-black'}>{proposal.title}</p>
        <p className={'text-base leading-[1.2] text-black'}>{proposal.description}</p>
      </div>
      <div className={'px-3 flex flex-col gap-2'}>
        <div className={'border border-stroke-primary rounded px-2 py-3 flex flex-col gap-2'}>
          <span className={'text-sm text-grey-dark'}>Voting ended:</span>
          <span className={'text-lg font-semibold text-black'}>{proposal.votingEnded}</span>
        </div>
        <div className={'border border-stroke-primary rounded px-2 py-3 flex flex-col gap-2'}>
          <span className={'text-sm text-grey-dark'}>Proposed by:</span>
          <span className={'text-lg font-semibold text-grey-dark'}>{proposal.proposedBy}</span>
        </div>
        <div className={'border border-stroke-primary rounded px-2 py-3 flex flex-col gap-1'}>
          <div className={'flex h-1.5 w-full rounded overflow-hidden'}>
            <div className={'bg-[#5c9557] h-full shrink-0 tr-d-all'} style={{ width: `${forPct}%` }} />
            <div className={'bg-[#d9d9d9] h-full flex-1'} />
          </div>
          <div className={'flex justify-between text-xs mt-0.5'}>
            <span className={'font-semibold text-[#5c9557] tr-d'}>For: {forPct}%</span>
            <span className={'font-medium text-[#a22c14] tr-d'}>Against: {againstPct}%</span>
          </div>
          {!isEnded && (
            <div className={'flex gap-2 mt-2'}>
              <button
                onClick={() => handleVote('for')}
                disabled={isSubmitting || hasVoted}
                className={clsx(
                  'flex-1 flex items-center justify-center border rounded-lg py-3 text-sm cursor-pointer tr-d disabled:opacity-50',
                  signedOut && 'opacity-50',
                  userVote === 'for'
                    ? 'border-[#5c9557] bg-[#5c9557]/10'
                    : 'border-stroke-primary hover:bg-bg-primary'
                )}
              >
                👍🏼
              </button>
              <button
                onClick={() => handleVote('against')}
                disabled={isSubmitting || hasVoted}
                className={clsx(
                  'flex-1 flex items-center justify-center border rounded-lg py-3 text-sm cursor-pointer tr-d disabled:opacity-50',
                  signedOut && 'opacity-50',
                  userVote === 'against'
                    ? 'border-[#a22c14] bg-[#a22c14]/10'
                    : 'border-stroke-primary hover:bg-bg-primary'
                )}
              >
                👎🏼
              </button>
            </div>
          )}
        </div>
      </div>
      <div className={'flex items-center justify-center'}>
        <span className={'text-sm text-blue'}>
          {proposal.voters + (hasVoted ? 0 : 0)} voters
          {hasVoted && <span className={'text-grey-dark'}> (you voted)</span>}
          {isSubmitting && <span className={'text-grey-dark'}> (submitting…)</span>}
        </span>
      </div>
    </div>
  );
};

/* Proposal confirm modal */

const ProposalConfirmModal: FC<{
  isOpen: boolean;
  onClose: () => void;
  data: ConfirmData;
  onConfirm: () => void;
  isSubmitting: boolean;
}> = ({ isOpen, onClose, data, onConfirm, isSubmitting }) => {
  const isPool = data.contract === 'Pool';
  const address = isPool
    ? (data.paramValues['poolAddress'] || '—')
    : (CONTRACT_ADDRESSES[data.contract] ?? '—');
  const allParams = data.action ? (PARAMS_BY_ACTION[data.action] ?? []) : [];
  const params = isPool ? allParams.filter(p => p.name !== 'poolAddress') : allParams;

  return (
    <Modal isOpened={isOpen} closeModal={onClose}>
      <div className={'flex flex-col'}>
        <div className={'px-4 pb-4'}>
          <h2 className={'text-xl font-semibold text-black'}>Proposal prepared</h2>
        </div>
        <div className={'border-b border-stroke-primary'} />
        <div className={'px-4'}>
          <div className={'flex items-start justify-between gap-4 py-4 border-b border-stroke-primary'}>
            <span className={'text-sm text-grey-dark shrink-0'}>Target</span>
            <span className={'text-sm text-blue text-right break-all'}>{address}</span>
          </div>
          {params.map(param => (
            <div key={param.name} className={'flex items-start justify-between gap-4 py-4 border-b border-stroke-primary'}>
              <span className={'text-sm text-grey-dark shrink-0'}>{param.name}</span>
              <span className={'text-sm text-blue text-right'}>{data.paramValues[param.name] || '—'}</span>
            </div>
          ))}
          <div className={'flex items-start justify-between gap-4 py-4 border-b border-stroke-primary'}>
            <span className={'text-sm text-grey-dark shrink-0'}>Description</span>
            <span className={'text-sm text-blue text-right max-w-[260px] break-words'}>{data.description || '—'}</span>
          </div>
          <div className={'flex items-start justify-between gap-4 py-4'}>
            <span className={'text-sm text-grey-dark shrink-0'}>Gas (est.)</span>
            <span className={'text-sm text-blue text-right'}>~0.0004 BNB</span>
          </div>
        </div>
        <div className={'px-4 flex flex-col gap-3'}>
          <button
            type={'button'}
            disabled={isSubmitting}
            className={'w-full flex items-center justify-center bg-blue text-white text-sm font-medium py-3 rounded-lg cursor-pointer hover:opacity-90 tr-d disabled:opacity-50'}
            onClick={onConfirm}
          >
            {isSubmitting ? 'Submitting…' : 'Create proposal'}
          </button>
          <div className={'flex items-center gap-1.5 justify-center'}>
            <Icon name={'info'} className={'size-4 text-[#5c79ee] shrink-0'} />
            <span className={'text-sm text-[#5c79ee]'}>You may cancel the proposal within 12 hours</span>
          </div>
        </div>
      </div>
    </Modal>
  );
};

const CreateProposalForm: FC = () => {
  const [contract, setContract]       = useState('');
  const [action, setAction]           = useState('');
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [description, setDescription] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showErrors, setShowErrors]   = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const apolloClient = useApolloClient();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const availableActions = contract ? (ACTIONS_BY_CONTRACT[contract] ?? []) : [];
  const params = action ? (PARAMS_BY_ACTION[action] ?? []) : [];

  const handleContractChange = (v: string) => { setContract(v); setAction(''); setParamValues({}); setShowErrors(false); };
  const handleActionChange   = (v: string) => { setAction(v);   setParamValues({});               setShowErrors(false); };

  const getError = (param: ActionParam): string | null => {
    const v = paramValues[param.name] ?? '';
    if (!v) return showErrors ? 'This field is required' : null;
    return param.validate?.(v, paramValues) ?? null;
  };

  const hasAnyError = () => params.some(p => {
    const v = paramValues[p.name] ?? '';
    if (!v) return true;
    return !!(p.validate?.(v, paramValues));
  });

  const handleCreateClick = () => {
    if (authLoading) return;
    if (!isAuthenticated) { toast('Sign in to create a proposal', 'warning'); return; }
    setShowErrors(true);
    if (!hasAnyError()) setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    if (isSubmitting) return;
    if (!isAuthenticated) { toast('Sign in to create a proposal', 'warning'); return; }
    setIsSubmitting(true);
    try {
      const { target, calldata } = buildProposalCalldata(contract, action, paramValues);
      const tx = await writeContractAsync({
        address: GOVERNANCE_ADDRESS,
        abi: GOVERNANCE_ABI,
        functionName: 'propose',
        args: [target, calldata, description],
      });
      await publicClient!.waitForTransactionReceipt({ hash: tx });
      toast('Proposal created!');
      // the proposals/votes lists are indexer-backed (not read from chain directly), so ask
      // them to refetch — otherwise the new proposal only shows up after a manual reload
      apolloClient.refetchQueries({ include: ['GetProposals', 'GetVotes'] });
      setConfirmOpen(false);
      setContract(''); setAction(''); setParamValues({}); setDescription(''); setShowErrors(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create proposal', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={'flex flex-col lg:flex-row gap-8 lg:gap-12'}>
      {/* Left: selects */}
      <div className={'flex flex-col gap-5 lg:w-[345px] shrink-0'}>
        <h2 className={'text-2xl font-semibold text-black'}>Choose what to change</h2>
        <div className={'flex flex-col gap-3'}>
          <Dropdown placeholder={'Select a contract'} options={CONTRACT_OPTIONS} value={contract} onChange={handleContractChange} />
          <Dropdown placeholder={'Select an action'} options={availableActions} value={action} onChange={handleActionChange} />
        </div>
      </div>

      {/* Right: parameters */}
      {action && (
        <div className={'flex-1 min-w-0 flex flex-col gap-7'}>
          <h2 className={'text-2xl font-semibold text-black'}>Parameters</h2>

          {params.map(param => {
            const error = getError(param);
            return (
              <div key={param.name} className={'flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3'}>
                <div className={'flex items-center gap-1.5 shrink-0 pt-0.5'}>
                  <span className={'text-sm font-medium text-black'}>{param.name}</span>
                  {param.tooltip && <Tooltip text={param.tooltip} />}
                </div>
                <div className={'w-full lg:w-[411px] flex flex-col gap-1'}>
                  <input
                    type={'text'}
                    placeholder={param.hint}
                    value={paramValues[param.name] ?? ''}
                    onChange={e => setParamValues(prev => ({ ...prev, [param.name]: e.target.value }))}
                    className={clsx(
                      'w-full border rounded-lg px-2 py-3 text-sm text-black placeholder:text-label-tertiary outline-none tr-d',
                      error ? 'border-red-bright' : 'border-stroke-primary focus:border-stroke-secondary'
                    )}
                  />
                  {error && <span className={'text-xs text-red-bright'}>{error}</span>}
                </div>
              </div>
            );
          })}

          <div className={'flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3'}>
            <span className={'text-sm font-medium text-black shrink-0'}>Description for community</span>
            <div className={'w-full lg:w-[411px] flex flex-col gap-3'}>
              <textarea
                placeholder={'Explain the rationale for this proposal to the community'}
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={6}
                className={'w-full border border-stroke-primary rounded-lg px-2 py-3 text-sm text-black placeholder:text-label-tertiary outline-none focus:border-stroke-secondary resize-none tr-d'}
              />
              <button
                type={'button'}
                className={'w-full flex items-center justify-center bg-blue text-white text-sm font-medium py-3 rounded-xl cursor-pointer hover:opacity-90 tr-d'}
                onClick={handleCreateClick}
              >
                Create proposal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!action && (
        <div className={'flex-1 flex items-center justify-center'}>
          <p className={'text-grey-dark text-sm'}>Select a contract and action to configure parameters</p>
        </div>
      )}

      <ProposalConfirmModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        data={{ contract, action, paramValues, description }}
        onConfirm={handleConfirm}
        isSubmitting={isSubmitting}
      />
    </div>
  );
};

const DaoPage: FC = () => {
  const [activeTab, setActiveTab] = useState<DaoTab>('proposals');
  const [showMine, setShowMine] = useState(false);
  const [page, setPage]         = useState(1);

  const { address } = useAccount();
  const walletAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : '—';

  // On-chain reads
  const { data: votingPowerRaw } = useReadContract({
    address: DAO_STAKING_ADDRESS,
    abi: DAO_STAKING_ABI,
    functionName: 'getVotingPower',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: thresholdRaw } = useReadContract({
    address: CONFIG_ADDRESS,
    abi: CONFIG_ABI,
    functionName: 'proposalThreshold',
  });

  const userVotingPower = votingPowerRaw ? Number(formatUnits(votingPowerRaw as bigint, 18)) : 0;
  // Infinity so canCreate stays false until the contract read lands (avoids flash of the form)
  const proposalThreshold = thresholdRaw ? Number(formatUnits(thresholdRaw as bigint, 18)) : Infinity;
  const canCreate = userVotingPower >= proposalThreshold;
  const isDev = process.env.NODE_ENV === 'development'; // bypass VP gate locally for testing

  const { data: proposalsData, loading: proposalsLoading } = useQuery<{ getProposals: GqlProposal[] }>(GET_PROPOSALS, {
    variables: { input: {} },
  });

  const { data: votesData } = useQuery<{ getVotes: GqlVote[] }>(GET_VOTES, {
    variables: { input: {} },
  });

  const proposals = useMemo((): Proposal[] => {
    const rawProposals = proposalsData?.getProposals ?? [];
    const rawVotes = votesData?.getVotes ?? [];

    return rawProposals.map(p => {
      const propVotes = rawVotes.filter(v => v.proposalId === p.proposalId);

      let forWeight = BigInt(0);
      let againstWeight = BigInt(0);
      for (const v of propVotes) {
        try {
          // weight is string wei from the indexer — BigInt() throws on empty/null
          if (v.support) forWeight += BigInt(v.weight);
          else againstWeight += BigInt(v.weight);
        } catch { /* skip malformed */ }
      }
      const totalWeight = forWeight + againstWeight;
      // multiply before dividing to keep bigint precision, then back to float for display
      const forPercent = totalWeight > BigInt(0)
        ? Math.round(Number((forWeight * BigInt(10000)) / totalWeight) / 100)
        : 50;

      const now = Date.now() / 1000;
      // endTime is the source of truth for active status; backend state can lag behind
      const isActive = p.endTime ? p.endTime > now : false;
      const state = (p.state ?? '').toLowerCase();
      const status: ProposalStatus =
        isActive ? 'pending' :
        (state === 'succeeded' || state === 'executed') ? 'succeeded' :
        'rejected';

      const endDate = p.endTime ? new Date(p.endTime * 1000) : null;
      const votingEnded = status === 'pending'
        ? (endDate ? endDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—')
        : 'ended';

      // description is freeform on-chain — first line as title, rest as body
      const lines = (p.description ?? '').split('\n').map(l => l.trim()).filter(Boolean);
      const title = lines[0]?.substring(0, 50) ?? `Proposal #${p.proposalId}`;
      const desc  = lines.slice(1).join(' ').trim() || lines[0] || '';

      return {
        id: p.id,
        proposalId: p.proposalId ?? '',
        status,
        title,
        description: desc,
        votingEnded,
        proposedBy: p.proposer ? `${p.proposer.slice(0, 6)}...${p.proposer.slice(-4)}` : '—',
        proposerAddress: p.proposer ?? '',
        forPercent,
        againstPercent: 100 - forPercent,
        voters: propVotes.length,
      };
    });
  }, [proposalsData, votesData]);

  const filteredProposals = showMine
    ? proposals.filter(p => address && p.proposerAddress.toLowerCase() === address.toLowerCase())
    : proposals;

  const PAGE_SIZE = 12;
  const totalPages = Math.max(1, Math.ceil(filteredProposals.length / PAGE_SIZE));
  const pagedProposals = filteredProposals.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const TABS: { id: DaoTab; label: string }[] = [
    { id: 'create',    label: 'Create proposal' },
    { id: 'proposals', label: 'Proposals table'  },
  ];

  return (
    <DashboardLayout>
      <Wrapper>
        {/* hero */}
        <div className={'flex flex-col gap-3 mb-8'}>
          <div className={'flex items-center gap-1.5 bg-bg-tertiary px-3 py-2 rounded-full w-fit'}>
            <Icon name={'person'} className={'size-4'} />
            <span className={'text-base text-grey-dark'}>{walletAddress}</span>
          </div>
          <div className={'flex flex-col gap-1.5'}>
            <h1 className={'text-4xl font-semibold leading-[1.2] text-[#1d1d1f]'}>DAO</h1>
            <p className={'text-base font-medium text-black'}>
              Stake PLT, vote on proposals and help control key Slices protocol decisions.
              <br />
              DAO governance manages platform parameters, treasury actions, staking settings and pool-level freeze proposals.
            </p>
          </div>
        </div>

        {/* desktop: faq + voting widget */}
        <div className={'hidden lg:flex bg-white border border-stroke-primary rounded-xl py-4 gap-12 items-start mb-8'}>
          <div className={'flex-1 min-w-0 flex flex-col gap-6 px-4'}>
            <h2 className={'text-2xl font-semibold text-black'}>FAQ</h2>
            <DaoFaqAccordion />
          </div>
          <div className={'w-[500px] shrink-0 flex flex-col gap-2 pt-3.5 pr-4'}>
            <VotingPowerWidget />
          </div>
        </div>

        {/* mobile: voting widget only */}
        <div className={'lg:hidden bg-white border border-stroke-primary rounded-xl py-4 px-4 mb-8'}>
          <VotingPowerWidget />
        </div>

        {/* tabs */}
        <div className={'border-b border-stroke-primary flex gap-4 items-center mb-8'}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={clsx(
                'flex items-center gap-1 pb-3 text-base font-medium cursor-pointer tr-d',
                activeTab === tab.id ? 'text-black border-b-2 border-blue -mb-px' : 'text-grey-dark hover:text-black',
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              <Icon name={'info'} className={'size-4'} />
            </button>
          ))}
        </div>

        {/* create proposal tab */}
        {activeTab === 'create' && (
          <section className={'mb-12'}>
            {!canCreate && !isDev && (
              <div className={'bg-white border border-stroke-primary rounded-xl p-5 flex gap-4 items-start mb-8'}>
                <div className={'size-10 shrink-0 flex items-center justify-center bg-[#FEF3F3] rounded-xl text-lg'}>
                  ⚠
                </div>
                <div className={'flex flex-col gap-2'}>
                  <p className={'text-base font-semibold text-black'}>Insufficient voting power</p>
                  <p className={'text-sm text-grey-dark leading-[1.4]'}>
                    You need at least{' '}
                    <span className={'text-black font-medium'}>{proposalThreshold.toLocaleString()} VP</span>{' '}
                    to create a proposal. Your current voting power:{' '}
                    <span className={'text-black font-medium'}>{userVotingPower.toLocaleString()} VP</span>.
                  </p>
                  <p className={'text-sm text-grey-dark'}>
                    Buy more PLT tokens and stake them to increase your voting power.
                  </p>
                  <button
                    className={'mt-1 w-fit text-blue text-sm font-medium underline cursor-pointer hover:opacity-80 tr-d'}
                    onClick={() => setActiveTab('proposals')}
                  >
                    Go to Stake →
                  </button>
                </div>
              </div>
            )}
            {(canCreate || isDev) && <CreateProposalForm />}
          </section>
        )}

        {/* proposals tab */}
        {activeTab === 'proposals' && (
          <>
            <section className={'mb-8'}>
              <div className={'flex items-center gap-4 mb-4 flex-wrap'}>
                <h2 className={'text-2xl font-semibold text-black shrink-0'}>Proposals:</h2>
                <label className={'flex items-center gap-2 cursor-pointer'}>
                  <input type={'checkbox'} checked={!showMine} onChange={e => { setShowMine(!e.target.checked); setPage(1); }} className={'size-4 accent-blue rounded cursor-pointer'} />
                  <span className={'text-sm text-black'}>All proposals</span>
                </label>
                <label className={'flex items-center gap-2 cursor-pointer'}>
                  <input type={'checkbox'} checked={showMine} onChange={e => { setShowMine(e.target.checked); setPage(1); }} className={'size-4 accent-blue rounded cursor-pointer'} />
                  <span className={'text-sm text-black'}>Created by me</span>
                </label>
              </div>

              {proposalsLoading ? (
                <div className={'grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4'}>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className={'bg-bg-tertiary rounded-xl overflow-hidden pb-4 flex flex-col gap-4 animate-pulse'}>
                      <div className={'pt-4 px-3'}><div className={'h-7 w-24 rounded-full bg-grey-light'} /></div>
                      <div className={'px-3 flex flex-col gap-3'}>
                        <div className={'h-5 w-3/4 bg-grey-light rounded'} />
                        <div className={'h-4 w-full bg-grey-light rounded'} />
                      </div>
                      <div className={'px-3 flex flex-col gap-2'}>
                        <div className={'h-14 bg-grey-light rounded'} />
                        <div className={'h-14 bg-grey-light rounded'} />
                        <div className={'h-20 bg-grey-light rounded'} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredProposals.length === 0 ? (
                <div className={'py-12 flex flex-col items-center gap-2'}>
                  <p className={'text-base font-medium text-black'}>No proposals found</p>
                  <p className={'text-sm text-grey-dark'}>
                    {showMine && !address
                      ? 'Connect your wallet to see your proposals'
                      : 'You have not created any proposals yet'}
                  </p>
                </div>
              ) : (
                <div className={'grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4'}>
                  {pagedProposals.map(proposal => (
                    <ProposalCard key={proposal.id} proposal={proposal} />
                  ))}
                </div>
              )}
            </section>

            {totalPages > 1 && (
              <section className={'mb-12'}>
                <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
              </section>
            )}
          </>
        )}

        {/* mobile: faq at bottom */}
        <section className={'lg:hidden mb-12'}>
          <h2 className={'text-2xl font-semibold text-black mb-6'}>FAQ</h2>
          <DaoFaqAccordion />
        </section>
      </Wrapper>
    </DashboardLayout>
  );
};

export default DaoPage;
