import React, { FC } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui';

// collecting / failed: the pool hasn't reached its goal, so there is no repayment to make (yet)
export type DebtRepaymentStatus = 'overdue' | 'upcoming' | 'successful' | 'collecting' | 'failed';

export interface DebtRepaymentPool {
  id: string;
  poolAddress: string;
  name: string;
  companyName: string;
  projectName: string;
  status: DebtRepaymentStatus;
  nextPaymentDate: number | null; // unix seconds; null when fully repaid
  completedTranches: number;
  totalTranches: number;
  paymentAmount: number | null; // null when fully repaid
  payable: boolean; // whether there's an outstanding tranche to pay
}

export const STATUS_LABELS: Record<DebtRepaymentStatus, string> = {
  overdue: 'Overdue',
  upcoming: 'Upcoming',
  successful: 'Successful',
  collecting: 'Collecting',
  failed: 'Failed',
};

const STATUS_ICON: Record<DebtRepaymentStatus, 'failed' | 'time' | 'completed'> = {
  overdue: 'failed',
  upcoming: 'time',
  successful: 'completed',
  collecting: 'time',
  failed: 'failed',
};

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `${mm}.${dd}.${yy}`;
}

interface DebtRepaymentRowProps {
  pool: DebtRepaymentPool;
  onPay: (pool: DebtRepaymentPool) => void;
}

const DebtRepaymentRow: FC<DebtRepaymentRowProps> = ({ pool, onPay }) => {
  return (
    <div className="bg-bg-primary border border-stroke-primary h-[52px] flex items-center px-3 gap-2">
      <Link href={`/pool/${pool.id}`} className="text-sm text-black w-[200px] shrink-0 truncate hover:underline">
        {pool.name}
      </Link>

      <span className="text-sm text-blue flex-1 text-right whitespace-nowrap">
        {pool.nextPaymentDate !== null ? formatDate(pool.nextPaymentDate) : '—'}
      </span>

      <span className="text-sm text-black flex-1 text-right">
        {pool.paymentAmount !== null ? pool.paymentAmount.toLocaleString('en-US', { maximumFractionDigits: 0 }) : ''}
      </span>

      <span className="flex-1 flex items-center justify-end gap-1.5 text-sm text-black whitespace-nowrap">
        <Icon name={STATUS_ICON[pool.status]} className="size-4 shrink-0" />
        {STATUS_LABELS[pool.status]}
      </span>

      <span className="text-sm text-black flex-1 text-right whitespace-nowrap">
        {pool.completedTranches} of {pool.totalTranches}
      </span>

      <div className="w-[110px] shrink-0 flex justify-end">
        {pool.payable && (
          <button
            type="button"
            onClick={() => onPay(pool)}
            className="bg-bg-tertiary border-[0.75px] border-stroke-primary rounded-lg px-3 py-2 text-sm font-medium text-grey-dark cursor-pointer"
          >
            Pay
          </button>
        )}
      </div>
    </div>
  );
};

export default DebtRepaymentRow;
