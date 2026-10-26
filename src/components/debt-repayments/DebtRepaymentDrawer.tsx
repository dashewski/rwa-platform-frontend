'use client';

import React, { FC, useEffect, useState } from 'react';
import clsx from 'clsx';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import { BaseError, formatUnits, maxUint256 } from 'viem';
import { useQuery } from '@apollo/client/react';
import { Icon, Button, toast } from '@/components/ui';
import { ERC20_APPROVE_ABI, POOL_ABI, HOLD_TOKEN_ADDRESS } from '@/lib/contracts';
import { GET_POOL_RECIPIENTS } from '@/lib/debt-repayments/operations';
import { STATUS_LABELS, type DebtRepaymentPool } from './DebtRepaymentRow';

const ZERO = BigInt(0);
const HOLD_DECIMALS = 18;

// USDT/HOLD amounts use 18 decimals — same formatting convention as BuyTokenWidget.
function formatUsdtAmount(wei: bigint | undefined): string {
  if (!wei || wei === ZERO) return '0';
  const [whole, frac] = formatUnits(wei, HOLD_DECIMALS).split('.');
  const wholeStr = BigInt(whole).toLocaleString('en-US');
  if (!frac) return wholeStr;
  const fracStr = frac.slice(0, 4);
  return fracStr ? `${wholeStr}.${fracStr}` : wholeStr;
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}.${mm}.${yy}`;
}

const STATUS_ICON: Record<DebtRepaymentPool['status'], 'failed' | 'time' | 'completed'> = {
  overdue: 'failed',
  upcoming: 'time',
  successful: 'completed',
  collecting: 'time',
  failed: 'failed',
};

const STATUS_BANNER_BG: Record<DebtRepaymentPool['status'], string> = {
  overdue: 'bg-[#f7eef5]',
  upcoming: 'bg-[#fdf3e0]',
  successful: 'bg-[#eaf7ea]',
  collecting: 'bg-[#fdf3e0]',
  failed: 'bg-[#f7eef5]',
};

const STATUS_DESCRIPTION: Record<DebtRepaymentPool['status'], string> = {
  overdue:
    "The scheduled date has passed and you haven't sent funds back to investors. Delays affect your project's rating. Paying now will remove the overdue flag on the pool page and improve your credibility with investors",
  upcoming: "This payment isn't due yet. Paying it early builds trust with your investors ahead of the payout date.",
  successful: 'This tranche has been fully repaid. No further action is needed.',
  collecting: "The pool hasn't reached its funding goal yet. Repayments open once the goal is reached.",
  failed: "The pool didn't reach its funding goal, so there is nothing to repay.",
};

interface DebtRepaymentDrawerProps {
  pool: (DebtRepaymentPool & { amountDueWei: bigint; percentOfDebt: number }) | null;
  onClose: () => void;
  onPaid: () => void;
}

const DebtRepaymentDrawer: FC<DebtRepaymentDrawerProps> = ({ pool, onClose, onPaid }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  useEffect(() => {
    if (pool) document.body.classList.add('locked');
    else document.body.classList.remove('locked');
    return () => document.body.classList.remove('locked');
  }, [pool]);

  const { data: recipientsData } = useQuery(GET_POOL_RECIPIENTS, {
    variables: { input: { filter: { poolAddress: pool?.poolAddress, balance: { $gt: '0' } } } },
    skip: !pool?.poolAddress,
  });
  const recipients = (recipientsData as { getBalances?: { owner: string }[] })?.getBalances ?? [];
  const recipientsCount = new Set(recipients.map(b => b.owner.toLowerCase())).size;

  if (!pool) return null;

  const poolAddress = pool.poolAddress as `0x${string}`;
  const amountDueWei = pool.amountDueWei;

  const canSubmit = !!address && pool.payable && amountDueWei > ZERO && !isSubmitting;

  const handlePay = async () => {
    if (!address || !publicClient || amountDueWei === ZERO) return;
    setIsSubmitting(true);
    try {
      const allowance = (await publicClient.readContract({
        address: HOLD_TOKEN_ADDRESS,
        abi: ERC20_APPROVE_ABI,
        functionName: 'allowance',
        args: [address, poolAddress],
      })) as bigint;

      if (allowance < amountDueWei) {
        toast('Approving USDT…');
        const approveTx = await writeContractAsync({
          address: HOLD_TOKEN_ADDRESS,
          abi: ERC20_APPROVE_ABI,
          functionName: 'approve',
          args: [poolAddress, maxUint256],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
      }

      try {
        await publicClient.simulateContract({
          address: poolAddress,
          abi: POOL_ABI,
          functionName: 'returnIncomingTranche',
          args: [amountDueWei],
          account: address,
        });
      } catch (simErr) {
        console.error('returnIncomingTranche simulation reverted', simErr);
        const reason = simErr instanceof BaseError ? simErr.shortMessage : 'Transaction would fail';
        toast(reason, 'error');
        return;
      }

      toast('Sending repayment transaction…');
      await writeContractAsync({
        address: poolAddress,
        abi: POOL_ABI,
        functionName: 'returnIncomingTranche',
        args: [amountDueWei],
      });

      toast('Repayment successful!');
      onPaid();
      onClose();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Repayment failed', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section
      className="z-20 fixed top-0 right-0 bottom-0 left-0 bg-[#494A53]/60"
      onClick={evt => evt.currentTarget === evt.target && onClose()}
    >
      <div className="absolute top-0 right-0 bottom-0 w-full max-w-[490px] bg-white flex flex-col">
        <button className="absolute top-6 right-6 size-6 cursor-pointer" onClick={onClose}>
          <Icon name="plus" className="size-6 rotate-45 text-grey-dark" />
        </button>

        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
          <h3 className="text-xl font-semibold text-black">{pool.name} pool</h3>

          <div className={clsx('rounded-lg p-4 flex flex-col gap-2', STATUS_BANNER_BG[pool.status])}>
            <div className="flex items-center gap-1.5">
              <Icon name={STATUS_ICON[pool.status]} className="size-4 shrink-0" />
              <span className="text-base font-medium text-black">{STATUS_LABELS[pool.status]}</span>
            </div>
            <p className="text-sm text-grey-dark leading-[1.2]">{STATUS_DESCRIPTION[pool.status]}</p>
          </div>

          <div className="text-sm">
            <div className="flex items-center justify-between py-4 border-b border-stroke-primary">
              <span className="font-medium text-grey-dark">Company</span>
              <span className="text-blue text-right">{pool.companyName}</span>
            </div>
            <div className="flex items-center justify-between py-4 border-b border-stroke-primary">
              <span className="font-medium text-grey-dark">Project</span>
              <span className="text-blue text-right">{pool.projectName}</span>
            </div>
            <div className="flex items-center justify-between py-4 border-b border-stroke-primary">
              <span className="font-medium text-grey-dark">Payment number</span>
              <span className="text-black text-right">
                {pool.completedTranches} of {pool.totalTranches}
              </span>
            </div>
            <div className="flex items-center justify-between py-4 border-b border-stroke-primary">
              <span className="font-medium text-grey-dark">Payout date</span>
              <span className="text-black text-right">
                {pool.nextPaymentDate !== null ? formatDate(pool.nextPaymentDate) : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between py-4 border-b border-stroke-primary">
              <span className="font-medium text-grey-dark">% of Debt</span>
              <span className="text-black text-right">{pool.percentOfDebt.toFixed(0)}</span>
            </div>
            <div className="flex items-center justify-between py-4 border-b border-stroke-primary">
              <span className="font-medium text-grey-dark">Recipients</span>
              <span className="text-black text-right">{recipientsCount}</span>
            </div>
            <div className="flex items-center justify-between py-4">
              <span className="font-medium text-grey-dark">Total amount to be paid</span>
              <span className="text-black text-right">{formatUsdtAmount(amountDueWei)} USDT</span>
            </div>
          </div>
        </div>

        {pool.payable && (
          <div className="p-6 border-t border-stroke-primary">
            <Button visualType="quaternary" className="w-full justify-center" disabled={!canSubmit} onClick={handlePay}>
              {isSubmitting ? 'Processing…' : `Pay ${formatUsdtAmount(amountDueWei)} USDT`}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
};

export default DebtRepaymentDrawer;
