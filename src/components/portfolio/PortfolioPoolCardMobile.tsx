import React, { FC } from 'react';
import Link from 'next/link';
import Icon from '@/components/ui/Icon';
import Tooltip from '@/components/ui/Tooltip';
import type { PortfolioPool } from './PortfolioPoolRow';
import { STATUS_LABELS, STATUS_TOOLTIPS, STATUS_BAR_COLORS } from './PortfolioPoolRow';

interface PortfolioPoolCardMobileProps {
  pool: PortfolioPool;
}

const PortfolioPoolCardMobile: FC<PortfolioPoolCardMobileProps> = ({ pool }) => {
  const fillPct = pool.goal > 0 ? Math.min((pool.collected / pool.goal) * 100, 100) : 0;
  const { track, fill } = STATUS_BAR_COLORS[pool.status];

  return (
    <div className="relative bg-bg-tertiary rounded-xl flex flex-col gap-2 items-start w-full overflow-hidden pb-4">
      <div className="flex flex-col gap-4 items-start py-4 w-full">
        <div className="flex items-center justify-between px-3 w-full">
          <div className="bg-white flex items-center gap-1.5 justify-center pl-2 pr-3 py-2 rounded-full">
            <Icon name="star" className="size-4 text-blue" />
            <span className="text-sm text-blue whitespace-nowrap">AI-Rating: {pool.aiRating.toFixed(2)}</span>
          </div>
        </div>

        <div className="flex flex-col gap-3 items-start px-3 py-2 w-full">
          <p className="text-xl font-semibold leading-none text-black whitespace-nowrap">
            {pool.amount.toLocaleString()} USDT
          </p>
          {/* The link's ::after covers the whole card, so a tap anywhere on it opens the pool */}
          <Link href={`/pool/${pool.id}`} className="text-base leading-[1.2] text-black w-full truncate hover:underline after:absolute after:inset-0">
            {pool.name}
          </Link>
        </div>

        <div className="flex flex-col items-start px-3 w-full">
          <div className="flex flex-col gap-3 items-start w-full">
            <div className="h-9 rounded-lg overflow-hidden relative w-full" style={{ background: track }}>
              <div className="absolute top-0 left-0 h-full rounded-lg" style={{ width: `${fillPct}%`, background: fill }} />
              <span className="absolute inset-0 flex items-center justify-center text-sm font-medium text-white whitespace-nowrap">
                {pool.collected.toLocaleString()} / {pool.goal.toLocaleString()}
              </span>
            </div>
            <div className="flex items-start justify-between w-full">
              <div className="flex items-center gap-1">
                <span className="text-sm text-grey-dark whitespace-nowrap">Status:</span>
                <div className="relative z-10 flex items-center gap-0.5">
                  <Tooltip content={STATUS_TOOLTIPS[pool.status]}>
                    <Icon name="info" className="size-3.5 text-grey shrink-0" />
                  </Tooltip>
                  <span className="text-sm text-grey-dark whitespace-nowrap">{STATUS_LABELS[pool.status]}</span>
                </div>
              </div>
              <span className="text-sm text-grey-dark whitespace-nowrap">Profit: {pool.profit}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 items-start justify-center px-3 w-full">
        <div className="border border-stroke-primary flex flex-col gap-2 items-start px-2 py-3 rounded w-full">
          <span className="text-sm text-grey-dark whitespace-nowrap">Current value (USDT)</span>
          <span className="text-lg font-semibold leading-none text-black">{pool.currentValue.toFixed(2)}</span>
        </div>
        <div className="border border-stroke-primary flex flex-col gap-2 items-start px-2 py-3 rounded w-full">
          <span className="text-sm text-grey-dark whitespace-nowrap">Pool share</span>
          <span className="text-lg font-semibold leading-none text-black">{pool.poolShare}</span>
        </div>
        <div className="border border-stroke-primary flex flex-col gap-2 items-start px-2 py-3 rounded w-full">
          <span className="text-sm text-grey-dark whitespace-nowrap">Returned (USDT)</span>
          <span className="text-lg font-semibold leading-none text-black">{pool.returned.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
};

export default PortfolioPoolCardMobile;
