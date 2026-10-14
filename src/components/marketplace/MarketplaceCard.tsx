import React, { FC, HTMLAttributes } from 'react';
import clsx from 'clsx';
import Link from 'next/link';
import Image from 'next/image';

export interface MarketplaceProject {
  id: string;
  name: string;
  tokenTicker: string;
  logoUrl?: string;
  iconBg?: string;
  price: string;
  priceNum: number;
  monthlyProfit: string;
  collected: number;
  total: number;
  dueDate: string;
  // End of the collecting period (same value the pool page shows as "Closes")
  closesDate?: string;
  // getPoolStatus() label: Upcoming / Collecting / Funded / Failed / Paused / Completed
  status?: string;
  // Set only while the pool hasn't opened yet
  startsOn?: string;
  createdAt: number;
  riskScore: number;
}

interface MarketplaceCardProps extends HTMLAttributes<HTMLAnchorElement> {
  project: MarketplaceProject;
}

const MarketplaceCard: FC<MarketplaceCardProps> = ({ project, className, ...props }) => {
  const { id, name, tokenTicker, logoUrl, iconBg, price, monthlyProfit, collected, total, dueDate, closesDate, status, startsOn } = project;

  const progressPercent = Math.min(100, Math.round((collected / total) * 100));

  const collectedFormatted = collected.toLocaleString('en-US').replace(/,/g, ' ');
  const totalFormatted = total.toLocaleString('en-US').replace(/,/g, ' ');

  return (
    <Link
      href={`/pool/${id}`}
      className={clsx('bg-grey-light rounded-[2.5rem] p-6 flex flex-col justify-between gap-7 tr-d-all', className)}
      {...(props as HTMLAttributes<HTMLAnchorElement>)}
    >
      {/* Top section */}
      <div className={'flex flex-col gap-7'}>
        {/* Logo row */}
        <div className={'flex items-center justify-between'}>
          <div className={'flex items-center gap-3'}>
            <div
              className={
                'size-11 rounded-full shrink-0 overflow-hidden flex items-center justify-center text-white text-base font-bold'
              }
              style={{ background: logoUrl ? 'transparent' : '#202E46' }}
            >
              {logoUrl ? (
                <Image
                  src={logoUrl}
                  alt={name}
                  width={44}
                  height={44}
                  className={'object-cover size-full'}
                />
              ) : (
                name.charAt(0)
              )}
            </div>
            <span className={'text-base font-normal text-black'}>{name}</span>
          </div>
          <div className={'bg-blue-dim px-2.5 py-[3px] rounded-[20px] shrink-0'}>
            <span className={'text-blue text-base font-bold leading-[1.2]'}>{tokenTicker}</span>
          </div>
        </div>

        {/* Price + profit */}
        <div className={'flex flex-col gap-4'}>
          <div className={'flex items-baseline gap-2'}>
            <span className={'text-2xl font-bold leading-[1.2] tracking-tight text-black'}>{price}</span>
            <span className={'text-base font-normal text-grey-dark leading-[1.2]'}>/ 1 {tokenTicker}</span>
          </div>
          <div className={'inline-flex self-start items-center gap-1 bg-blue-dim px-3 py-1.5 rounded-[20px]'}>
            <span className={'text-base text-black'}>~{monthlyProfit}%</span>
            <span className={'text-base text-black'}>monthly profit</span>
          </div>
        </div>
      </div>

      {/* Bottom section */}
      <div className={'flex flex-col gap-5'}>
        <div className={'h-px bg-grey-dark/40'} />

        <div className={'flex flex-col gap-2'}>
          <div className={'flex items-center justify-between gap-2 text-sm leading-[1.4]'}>
            <span className={'text-grey-dark'}>Status: <span className={'text-black font-medium'}>{status ?? 'Collecting'}</span></span>
            {startsOn && <span className={'text-blue font-bold'}>Starts {startsOn}</span>}
          </div>

          {/* Progress bar */}
          <div className={'relative h-8 bg-blue-dim rounded-lg overflow-hidden'}>
            <div
              className={'absolute left-0 top-0 h-full bg-blue-accent rounded-lg tr-d-all'}
              style={{ width: `${progressPercent}%` }}
            />
            <span
              className={'absolute inset-0 flex items-center justify-center text-sm font-bold text-black leading-none'}
            >
              {collectedFormatted} /{totalFormatted}
            </span>
          </div>

          {/* Due date */}
          {closesDate && (
            <div className={'flex items-center gap-2 text-sm leading-[1.4]'}>
              <span className={'text-grey-dark font-normal'}>Closes:</span>
              <span className={'text-blue font-bold'}>{closesDate}</span>
            </div>
          )}
          <div className={'flex items-center gap-2 text-sm leading-[1.4]'}>
            <span className={'text-grey-dark font-normal'}>Pool due:</span>
            <span className={'text-blue font-bold'}>{dueDate}</span>
          </div>
        </div>
      </div>
    </Link>
  );
};

export default MarketplaceCard;