import type { ContractFunctionArgs } from 'viem';
import type { ApolloClient } from '@apollo/client';
import { FACTORY_ABI } from '@/lib/contracts';
import { GET_SIGNATURE_TASK } from '@/lib/pool/operations';

// 3% in basis points — part of the signed message, so it must match what is sent on-chain
export const CREATE_POOL_FEE_RATIO = '300';

// The pool fields the backend signed (see rwa-service generatePoolMessageHash). deployPool has
// to be called with exactly these stored values, so everything is read from the saved record.
export interface PoolDeployRecord {
  id: string;
  rwaAddress: string;
  expectedHoldAmount: string;
  expectedRwaAmount: string;
  priceImpactPercent: string;
  rewardPercent: string;
  entryPeriodStart: number;
  entryPeriodExpired: number;
  completionPeriodExpired: number;
  entryFeePercent: string;
  exitFeePercent: string;
  fixedSell: boolean;
  allowEntryBurn: boolean;
  awaitCompletionExpired: boolean;
  floatingOutTranchesTimestamps: boolean;
  outgoingTranches: { amount: string; timestamp: number }[];
  incomingTranches: { amount: string; expiredAt: number }[];
}

export interface DeploySignatures {
  signers: `0x${string}`[];
  signatures: `0x${string}`[];
  expired: bigint;
}

// What to do with the pool's signature task before deploying. The backend rejects a new request
// while any task is recorded on the pool, and only lets an expired one be dropped 60s after expiry.
export type SignatureAction =
  | { type: 'request' } // no task yet
  | { type: 'reuse'; taskId: string } // a valid task exists (e.g. an earlier attempt failed after signing)
  | { type: 'reject-and-request' } // expired long enough ago to be dropped, then request again
  | { type: 'wait'; retryAt: number }; // expired, but the backend won't drop it before retryAt

export function decideSignatureAction(
  task: { id?: string | null; expired?: number | null },
  now: number
): SignatureAction {
  if (!task.id) return { type: 'request' };
  if (task.expired && task.expired > now) return { type: 'reuse', taskId: task.id };
  // the backend refuses while now <= expired + 60, so the boundary second still has to wait
  if (task.expired && task.expired + 60 >= now) return { type: 'wait', retryAt: task.expired + 60 };
  return { type: 'reject-and-request' };
}

export type DeployPoolArgs = ContractFunctionArgs<typeof FACTORY_ABI, 'nonpayable', 'deployPool'>;

export function buildDeployPoolArgs(pool: PoolDeployRecord, sig: DeploySignatures): DeployPoolArgs {
  return [
    BigInt(CREATE_POOL_FEE_RATIO),
    pool.id,
    pool.rwaAddress as `0x${string}`,
    BigInt(pool.expectedHoldAmount),
    BigInt(pool.expectedRwaAmount),
    BigInt(pool.priceImpactPercent),
    BigInt(pool.rewardPercent),
    BigInt(pool.entryPeriodStart),
    BigInt(pool.entryPeriodExpired),
    BigInt(pool.completionPeriodExpired),
    BigInt(pool.entryFeePercent),
    BigInt(pool.exitFeePercent),
    pool.fixedSell,
    pool.allowEntryBurn,
    pool.awaitCompletionExpired,
    pool.floatingOutTranchesTimestamps,
    pool.outgoingTranches.map(t => BigInt(t.amount)),
    pool.outgoingTranches.map(t => BigInt(t.timestamp)),
    pool.incomingTranches.map(t => BigInt(t.amount)),
    pool.incomingTranches.map(t => BigInt(t.expiredAt)),
    sig.signers,
    sig.signatures,
    sig.expired,
  ];
}

// Polls the signers' task until it is completed (always 3 signatures or none). Time to completion
// ranges from seconds to many minutes, so network hiccups are retried rather than failing the deploy.
export async function pollSignatureTask(
  client: Pick<ApolloClient, 'query'>,
  taskId: string,
  timeoutMs = 300_000,
  intervalMs = 3000
): Promise<{ signatures: { signer: string; signature: string }[]; expired: number }> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    if (attempt > 0) await new Promise(r => setTimeout(r, intervalMs));
    attempt++;
    try {
      const { data } = await client.query({
        query: GET_SIGNATURE_TASK,
        variables: { input: { taskId } },
        fetchPolicy: 'network-only',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const task = (data as any)?.getSignatureTask;
      if (task?.completed && task.signatures?.length) {
        return task as { signatures: { signer: string; signature: string }[]; expired: number };
      }
    } catch {
      // keep polling
    }
  }
  throw new Error('Signature task timed out after 5 minutes. The backend signers may be unavailable.');
}
