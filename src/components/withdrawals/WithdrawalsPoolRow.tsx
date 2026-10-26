import React, { FC } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { Button, Icon, Tooltip } from '@/components/ui';

export type WithdrawalStatus = 'collecting' | 'ready_to_withdraw' | 'already_withdrawn' | 'failed' | 'withdrawal_declined';

export interface WithdrawalPool {
  id: string;
  poolAddress: string;
  name: string;
  companyId?: string;
  companyName: string;
  projectName: string;
  collected: number;
  goal: number;
  status: WithdrawalStatus;
}

export const STATUS_LABELS: Record<WithdrawalStatus, string> = {
  collecting: 'Collecting',
  ready_to_withdraw: 'Ready to withdraw',
  already_withdrawn: 'Repayment due',
  failed: 'Failed',
  withdrawal_declined: 'Withdrawal declined',
};

const STATUS_TEXT_COLOR: Record<WithdrawalStatus, string> = {
  collecting: 'text-black',
  ready_to_withdraw: 'text-black',
  already_withdrawn: 'text-black',
  failed: 'text-red-bright',
  withdrawal_declined: 'text-red-bright',
};

const STATUS_TOOLTIPS: Record<WithdrawalStatus, string> = {
  collecting: 'Withdrawal will be available once the fundraising goal is reached',
  ready_to_withdraw: 'We have collected the entire amount, you can withdraw the money',
  already_withdrawn: 'Go to the Debt Repayments section to view the repayment schedule',
  failed: 'This is a fairly lengthy example of the error text in the tooltip and a couple more letters',
  withdrawal_declined:
    'Investors declined withdrawing funds from this pool. Go to pool page to see details. Write to hello@slices.finance for support',
};

const STATUS_BAR_COLORS: Record<WithdrawalStatus, { track: string; fill: string }> = {
  collecting: { track: '#9DBDF9', fill: '#1D58E9' },
  ready_to_withdraw: { track: '#9DBDF9', fill: '#1D58E9' },
  already_withdrawn: { track: '#9DBDF9', fill: '#1D58E9' },
  failed: { track: '#FBD1D1', fill: '#F97066' },
  withdrawal_declined: { track: '#9DBDF9', fill: '#1D58E9' },
};

interface WithdrawalsPoolRowProps {
  pool: WithdrawalPool;
  showCompany: boolean;
  showProject: boolean;
  onWithdraw: (pool: WithdrawalPool) => void;
}

const WithdrawalsPoolRow: FC<WithdrawalsPoolRowProps> = ({ pool, showCompany, showProject, onWithdraw }) => {
  const fillPct = pool.goal > 0 ? Math.min((pool.collected / pool.goal) * 100, 100) : 0;
  const { track, fill } = STATUS_BAR_COLORS[pool.status];

  return (
    <>
      {/* Desktop row */}
      <div className={'max-lg:hidden bg-bg-primary border border-stroke-primary min-h-[62px] flex items-center px-3 gap-2'}>
        <span className={'text-sm text-black w-[200px] shrink-0'}>{showCompany ? pool.companyName : ''}</span>
        <span className={'text-sm text-black w-[200px] shrink-0'}>{showProject ? pool.projectName : ''}</span>
        <Link href={`/pool/${pool.id}`} className={'text-sm text-black flex-1 truncate hover:underline'}>
          {pool.name}
        </Link>

        <div className={'h-[38px] rounded-lg overflow-hidden relative w-[180px] shrink-0'} style={{ background: track }}>
          <div className={'absolute top-0 left-0 h-full rounded-lg'} style={{ width: `${fillPct}%`, background: fill }} />
          <span className={'absolute inset-0 flex items-center justify-center text-sm font-medium text-white whitespace-nowrap'}>
            {pool.collected.toLocaleString()} / {pool.goal.toLocaleString()}
          </span>
        </div>

        <div className={'flex items-center gap-1.5 w-[170px] shrink-0'}>
          <span className={clsx('text-sm whitespace-nowrap', STATUS_TEXT_COLOR[pool.status])}>
            {STATUS_LABELS[pool.status]}
          </span>
          <Tooltip content={STATUS_TOOLTIPS[pool.status]} />
        </div>

        <div className={'w-[110px] shrink-0 flex justify-end'}>
          {pool.status === 'ready_to_withdraw' && (
            <Button visualType={'quinary'} className={'!py-2 !px-3 text-xs'} onClick={() => onWithdraw(pool)}>
              Withdraw
            </Button>
          )}
          {pool.status === 'already_withdrawn' && (
            <span className={'flex items-center gap-1 text-xs text-label-tertiary'}>
              <Icon name={'check'} className={'size-3.5'} />
              Withdrawn
            </span>
          )}
        </div>
      </div>

      {/* Mobile card */}
      <div className={'lg:hidden flex flex-col'}>
        {showCompany && <p className={'text-base font-semibold text-black px-1 pt-3'}>{pool.companyName}</p>}
        {showProject && <p className={'text-xs text-label-tertiary uppercase px-1 pb-2'}>{pool.projectName}</p>}

        {/* The link's ::after covers the whole card; Withdraw and the status tooltip sit above it (z-10) */}
        <div className={'relative bg-bg-tertiary rounded-2xl p-4 flex flex-col gap-3'}>
          <Link href={`/pool/${pool.id}`} className={'text-base font-bold text-black flex items-center gap-1.5 hover:underline after:absolute after:inset-0'}>
            {pool.status === 'already_withdrawn' && <Icon name={'check'} className={'size-3.5 shrink-0'} />}
            {pool.name}
          </Link>

          <div className={'h-1.5 rounded-full overflow-hidden relative w-full'} style={{ background: track }}>
            <div className={'absolute top-0 left-0 h-full rounded-full'} style={{ width: `${fillPct}%`, background: fill }} />
          </div>

          <div className={'flex items-center justify-between'}>
            <span className={clsx('text-sm', pool.status === 'failed' ? 'text-red-bright' : 'text-grey-dark')}>
              {pool.collected.toLocaleString()} / {pool.goal.toLocaleString()}
            </span>
            <span className={clsx('relative z-10 flex items-center gap-1 text-sm whitespace-nowrap', STATUS_TEXT_COLOR[pool.status])}>
              {STATUS_LABELS[pool.status]}
              <Tooltip content={STATUS_TOOLTIPS[pool.status]} />
            </span>
          </div>

          {pool.status === 'ready_to_withdraw' && (
            <Button visualType={'quaternary'} className={'relative z-10 w-full justify-center'} onClick={() => onWithdraw(pool)}>
              Withdraw
            </Button>
          )}
        </div>
      </div>
    </>
  );
};

export default WithdrawalsPoolRow;
