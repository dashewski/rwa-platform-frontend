'use client';

import React, { FC, useEffect, useRef, useState } from 'react';
import { useApolloClient, useMutation, useQuery } from '@apollo/client/react';
import { useAccount, useWaitForTransactionReceipt, usePublicClient, useWriteContract } from 'wagmi';
import { Button, toast } from '@/components/ui';
import { FACTORY_ABI, FACTORY_ADDRESS, HOLD_TOKEN_ADDRESS } from '@/lib/contracts';
import { ensureMaxAllowance } from '@/lib/web3/allowance';
import { isAlreadyDeployedError } from '@/lib/web3/errors';
import {
  GET_POOL_DEPLOY_INFO,
  REJECT_POOL_APPROVAL_SIGNATURES,
  REQUEST_POOL_APPROVAL_SIGNATURES,
} from '@/lib/pool/operations';
import {
  CREATE_POOL_FEE_RATIO,
  buildDeployPoolArgs,
  decideSignatureAction,
  pollSignatureTask,
  type PoolDeployRecord,
} from '@/lib/pool/deploy';

type DeployStatus =
  | 'idle'
  | 'requesting-signatures'
  | 'waiting-signatures'
  | 'approving-hold'
  | 'sending-tx'
  | 'waiting-confirmation'
  | 'waiting-indexing';

const STATUS_LABELS: Record<DeployStatus, string> = {
  idle: '',
  'requesting-signatures': 'Requesting approval signatures…',
  'waiting-signatures': 'Waiting for backend signatures…',
  'approving-hold': 'Approving HOLD token spend…',
  'sending-tx': 'Sending transaction…',
  'waiting-confirmation': 'Waiting for confirmation…',
  'waiting-indexing': 'Waiting for the backend to register the pool…',
};

interface PoolDeployButtonProps {
  poolId: string;
  // Called once the backend reports the pool's on-chain address, so the page can reload the pool
  onDeployed?: () => void;
}

// Deploys an already created pool (draft). Creating the record and deploying it are separate
// steps on purpose: this button always knows its pool id and can never create another pool.
const PoolDeployButton: FC<PoolDeployButtonProps> = ({ poolId, onDeployed }) => {
  const { address: walletAddress } = useAccount();
  const publicClient = usePublicClient();
  const apolloClient = useApolloClient();
  const { writeContractAsync } = useWriteContract();

  const [status, setStatus] = useState<DeployStatus>('idle');
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  // Set synchronously on the first click; released only when the attempt fails or the tx reverts
  const busyRef = useRef(false);

  const { data: infoData, refetch: refetchInfo } = useQuery(GET_POOL_DEPLOY_INFO, {
    variables: { id: poolId },
    fetchPolicy: 'network-only',
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pool = (infoData as any)?.getPool as (PoolDeployRecord & {
    poolAddress?: string | null;
    approvalSignaturesTaskId?: string | null;
    approvalSignaturesTaskExpired?: number | null;
  }) | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [requestSignatures] = useMutation<any>(REQUEST_POOL_APPROVAL_SIGNATURES);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rejectSignatures] = useMutation<any>(REJECT_POOL_APPROVAL_SIGNATURES);

  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash });

  const finish = (nextStatus: DeployStatus = 'idle') => {
    setStatus(nextStatus);
    busyRef.current = nextStatus !== 'idle';
  };

  // Tx mined → wait for the indexer (it sets poolAddress after Pool_Deployed)
  useEffect(() => {
    if (!receipt || status !== 'waiting-confirmation') return;
    if (receipt.status === 'success') setStatus('waiting-indexing');
    else {
      toast('Pool deployment transaction failed', 'error');
      setTxHash(undefined);
      finish('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt, status]);

  useEffect(() => {
    if (status !== 'waiting-indexing') return;
    if (pool?.poolAddress) {
      setTxHash(undefined);
      finish('idle');
      toast('Pool successfully deployed!');
      onDeployed?.();
      return;
    }
    const startedAt = Date.now();
    const id = setInterval(() => {
      if (Date.now() - startedAt > 120_000) {
        clearInterval(id);
        setTxHash(undefined);
        finish('idle');
        toast('Transaction confirmed, but the pool is not registered yet. Reload the page in a minute.', 'warning');
        return;
      }
      refetchInfo();
    }, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, pool?.poolAddress]);

  const handleDeploy = async () => {
    if (busyRef.current) return;
    if (!walletAddress) {
      toast('Connect your wallet first', 'error');
      return;
    }
    if (!pool) return;
    busyRef.current = true;
    try {
      // Always work from the freshest state: the task may have been requested or expired meanwhile
      const fresh = (await refetchInfo()).data as unknown as { getPool?: typeof pool } | undefined;
      const current = fresh?.getPool ?? pool;
      if (current.poolAddress) {
        toast('This pool is already deployed.', 'warning');
        finish('idle');
        onDeployed?.();
        return;
      }

      const action = decideSignatureAction(
        { id: current.approvalSignaturesTaskId, expired: current.approvalSignaturesTaskExpired },
        Math.floor(Date.now() / 1000)
      );
      let taskId: string;

      if (action.type === 'reuse') {
        taskId = action.taskId;
      } else {
        setStatus('requesting-signatures');
        if (action.type === 'wait') {
          const waitUntil = new Date(action.retryAt * 1000).toLocaleTimeString();
          throw new Error(`Previous signature request has not expired yet. Try again after ${waitUntil}.`);
        }
        if (action.type === 'reject-and-request') {
          await rejectSignatures({ variables: { id: poolId } });
          await refetchInfo();
        }
        const res = await requestSignatures({
          variables: {
            input: {
              id: poolId,
              ownerWallet: walletAddress,
              deployerWallet: walletAddress,
              createPoolFeeRatio: CREATE_POOL_FEE_RATIO,
            },
          },
        });
        if (res.error) throw new Error(res.error.message);
        const newTaskId = res.data?.requestPoolApprovalSignatures?.taskId as string | undefined;
        if (!newTaskId) throw new Error('Failed to get approval task ID');
        taskId = newTaskId;
      }

      setStatus('waiting-signatures');
      const task = await pollSignatureTask(apolloClient, taskId);
      const sig = {
        signers: task.signatures.map(s => s.signer as `0x${string}`),
        signatures: task.signatures.map(s => s.signature as `0x${string}`),
        expired: BigInt(Math.floor(task.expired)),
      };

      if (!publicClient) throw new Error('No public client available');
      setStatus('approving-hold');
      await ensureMaxAllowance({
        publicClient,
        writeContractAsync,
        token: HOLD_TOKEN_ADDRESS,
        owner: walletAddress,
        spender: FACTORY_ADDRESS,
      });

      setStatus('sending-tx');
      const hash = await writeContractAsync({
        address: FACTORY_ADDRESS,
        abi: FACTORY_ABI,
        functionName: 'deployPool',
        args: buildDeployPoolArgs(current, sig),
        gas: BigInt(2_000_000),
      });
      setTxHash(hash);
      setStatus('waiting-confirmation');
    } catch (err) {
      if (isAlreadyDeployedError(err)) {
        // Not a failure: the pool is already on-chain. Wait for the backend to report its address.
        toast('This pool is already deployed.', 'warning');
        finish('waiting-indexing');
        return;
      }
      toast(err instanceof Error ? err.message : 'Deploy failed', 'error');
      finish('idle');
    }
  };

  const isBusy = status !== 'idle';

  return (
    <div className={'flex items-center gap-3 max-md:w-full max-md:flex-wrap'}>
      <Button
        className={'max-md:w-full'}
        visualType={'quaternary'}
        type={'button'}
        disabled={isBusy || !pool}
        onClick={handleDeploy}
      >
        {isBusy ? 'Deploying…' : 'Deploy pool'}
      </Button>
      {isBusy && <span className={'text-sm text-label-tertiary'}>{STATUS_LABELS[status]}</span>}
    </div>
  );
};

export default PoolDeployButton;
