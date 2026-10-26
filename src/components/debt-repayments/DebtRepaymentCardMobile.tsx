import React, { FC } from 'react';
import Link from 'next/link';
import { Icon, Button } from '@/components/ui';
import { STATUS_LABELS, type DebtRepaymentPool } from './DebtRepaymentRow';

const STATUS_ICON: Record<DebtRepaymentPool['status'], 'failed' | 'time' | 'completed'> = {
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

interface DebtRepaymentCardMobileProps {
  pool: DebtRepaymentPool;
  onPay: (pool: DebtRepaymentPool) => void;
}

const DebtRepaymentCardMobile: FC<DebtRepaymentCardMobileProps> = ({ pool, onPay }) => {
  return (
    <div className="bg-bg-tertiary rounded-xl flex flex-col gap-4 items-start w-full pt-4 pb-4">
      <div className="flex items-center justify-between px-3 w-full">
        <div className="bg-white flex items-center gap-1.5 justify-center pl-2 pr-3 py-2 rounded-full">
          <Icon name={STATUS_ICON[pool.status]} className="size-4" />
          <span className="text-sm whitespace-nowrap">{STATUS_LABELS[pool.status]}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2 items-start px-3 w-full">
        <p className="text-xl font-semibold leading-none text-black whitespace-nowrap">
          {pool.paymentAmount !== null ? pool.paymentAmount.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}{' '}
          USDT
        </p>
        <Link href={`/pool/${pool.id}`} className="text-base leading-[1.2] text-black w-full truncate hover:underline">
          {pool.name}
        </Link>
      </div>

      {pool.payable && (
        <div className="px-3 w-full">
          <Button visualType="quaternary" className="w-full justify-center" onClick={() => onPay(pool)}>
            Pay
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2 items-start px-3 w-full">
        <div className="border border-stroke-primary flex flex-col gap-2 items-start px-2 py-3 rounded w-full">
          <span className="text-sm text-grey-dark whitespace-nowrap">Payout date</span>
          <span className="text-lg font-semibold leading-none text-black">
            {pool.nextPaymentDate !== null ? formatDate(pool.nextPaymentDate) : '—'}
          </span>
        </div>

        <div className="border border-stroke-primary flex flex-col gap-2 items-start px-2 py-3 rounded w-full">
          <span className="text-sm text-grey-dark whitespace-nowrap">Payment number</span>
          <span className="text-lg font-semibold leading-none text-black">
            {pool.completedTranches} of {pool.totalTranches}
          </span>
        </div>
      </div>

      <Link
        href={`/pool/${pool.id}`}
        className="flex items-center justify-center gap-1 px-3 pt-1 w-full text-sm text-blue"
      >
        To payment page
        <Icon name="arrowUp" className="size-4 rotate-90" />
      </Link>
    </div>
  );
};

export default DebtRepaymentCardMobile;
