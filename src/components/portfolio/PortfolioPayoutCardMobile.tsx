import React, { FC } from 'react';
import Link from 'next/link';
import { Icon, Button } from '@/components/ui';
import type { PortfolioPayoutPool } from './PortfolioPayoutRow';

export interface PayoutTranche {
  amount: number; // this investor's share of the tranche
  date: number; // unix seconds
  completed: boolean;
}

interface PortfolioPayoutCardMobileProps {
  pool: PortfolioPayoutPool;
  onClaim: (pool: PortfolioPayoutPool) => void;
  onOpenDetail: (pool: PortfolioPayoutPool) => void;
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `${mm}.${dd}.${yy}`;
}

const PortfolioPayoutCardMobile: FC<PortfolioPayoutCardMobileProps> = ({ pool, onClaim, onOpenDetail }) => {
  return (
    <div className="relative bg-bg-tertiary rounded-xl flex flex-col gap-4 items-start w-full pt-4 pb-4">
      <div className="flex items-center justify-between px-3 w-full">
        <div className="bg-white flex items-center gap-1.5 justify-center pl-2 pr-3 py-2 rounded-full">
          <Icon name="star" className="size-4 text-blue" />
          <span className="text-sm text-blue whitespace-nowrap">AI-Rating: {pool.aiRating.toFixed(2)}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2 items-start px-3 w-full">
        <p className="text-xl font-semibold leading-none text-black whitespace-nowrap">
          {pool.totalAvailable.toLocaleString('en-US', { maximumFractionDigits: 0 })} USDT
        </p>
        {/* The link's ::after covers the whole card; Claim and the button below sit above it (z-10) */}
        <Link href={`/pool/${pool.id}`} className="text-base leading-[1.2] text-black w-full truncate hover:underline after:absolute after:inset-0">
          {pool.name}
        </Link>
      </div>

      {pool.claimable && (
        <div className="relative z-10 px-3 w-full">
          <Button visualType="quaternary" className="w-full justify-center" onClick={() => onClaim(pool)}>
            Claim
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2 items-start px-3 w-full">
        <div className="border border-stroke-primary flex flex-col gap-2 items-start px-2 py-3 rounded w-full">
          <span className="text-sm text-grey-dark whitespace-nowrap">Next payment</span>
          <span className="flex items-center gap-1 text-lg font-semibold leading-none text-black">
            {pool.nextPaymentIsOverdue && <Icon name="failed" className="size-3.5 shrink-0" />}
            {pool.nextPaymentDate === null
              ? 'Fully repaid'
              : `${formatDate(pool.nextPaymentDate)} (${pool.completedTranches}/${pool.totalTranches})`}
          </span>
        </div>

        {pool.paymentAmount !== null && (
          <div className="border border-stroke-primary flex flex-col gap-2 items-start px-2 py-3 rounded w-full">
            <span className="text-sm text-grey-dark whitespace-nowrap">Payment amount (USDT)</span>
            <span className="text-lg font-semibold leading-none text-black">
              {pool.paymentAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </span>
          </div>
        )}

        <div className="border border-stroke-primary flex flex-col gap-2 items-start px-2 py-3 rounded w-full">
          <span className="text-sm text-grey-dark whitespace-nowrap">Profit</span>
          <span className="text-lg font-semibold leading-none text-black">{pool.profitPct}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onOpenDetail(pool)}
        className="relative z-10 flex items-center justify-center gap-1 px-3 pt-1 w-full text-sm text-blue cursor-pointer"
      >
        All pool payouts
        <Icon name="arrowUp" className="size-4 rotate-90" />
      </button>
    </div>
  );
};

export default PortfolioPayoutCardMobile;
