'use client';

import React, { FC, useState } from 'react';
import { useParams } from 'next/navigation';
import clsx from 'clsx';
import { useAuth } from '@/lib/auth/AuthContext';
import { useQuery } from '@apollo/client/react';
import { DashboardLayout, Wrapper } from '@/components/layout';
import { Breadcrumbs } from '@/components/dashboard';
import { NewsList } from '@/components/news';
import { GET_POOL_BY_ID, GET_RAW_PRICE_DATA } from '@/lib/pool/operations';
import { getCollectedHold } from '@/lib/pool/collected';
import { getPoolStatus, getPoolTradeState } from '@/lib/pool/status';
import { getPoolPrice } from '@/lib/pool/display';
import { GET_BUSINESS_WITH_RISK } from '@/lib/business/operations';
import { GET_COMPANY } from '@/lib/company/operations';
import { Button, Icon, Title } from '@/components/ui';
import { ShareMenu } from '@/components/common';
import { BuyTokenWidget, EditPoolModal, PriceChart, PoolTransactions } from '@/components/pool';

// ── Helpers ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPool = any;

function formatHoldAmount(raw: string | null | undefined): string {
  if (!raw) return '0';
  try {
    const val = Math.round(Number(BigInt(raw) / BigInt(10) ** BigInt(15)) / 1000);
    return val.toLocaleString('en-US').replace(/,/g, ' ');
  } catch {
    return '0';
  }
}

function formatDate(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function getProgressPercent(pool: AnyPool): number {
  try {
    const current = Number(BigInt(getCollectedHold(pool)));
    const target = pool.expectedHoldAmount ? Number(BigInt(pool.expectedHoldAmount)) : 0;
    if (!target) return 0;
    return Math.min(100, (current / target) * 100);
  } catch {
    return 0;
  }
}

function getTrancheDay(expiredAt: number, entryPeriodExpired: number): string {
  const days = Math.round((expiredAt - entryPeriodExpired) / 86400);
  return `${days} days`;
}

function getTrancheUsdt(amount: string): string {
  try {
    const val = Math.round(Number(BigInt(amount) / BigInt(10) ** BigInt(15)) / 1000);
    return val.toLocaleString('en-US').replace(/,/g, ' ');
  } catch {
    return '0';
  }
}

function getTranchePercent(amount: string, totalWei: bigint): string {
  try {
    const amt = BigInt(amount);
    if (totalWei === BigInt(0)) return '0';
    return ((Number(amt) / Number(totalWei)) * 100).toFixed(0);
  } catch {
    return '0';
  }
}

function parseWeiToNum(raw: string): number {
  try {
    return Number(BigInt(raw) / BigInt(10) ** BigInt(15)) / 1000;
  } catch {
    return 0;
  }
}

// ── Icons ──────────────────────────────────────────────────────────────────────
const ClockIcon: FC = () => (
  <svg width='24' height='24' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
    <path
      opacity='0.4'
      d='M22 12C22 17.524 17.523 22 12 22C6.477 22 2 17.524 2 12C2 6.478 6.477 2 12 2C17.523 2 22 6.478 22 12Z'
      fill='#103183'
    />
    <path
      d='M15.5739 15.8143C15.4429 15.8143 15.3109 15.7803 15.1899 15.7093L11.2639 13.3673C11.0379 13.2313 10.8989 12.9863 10.8989 12.7223V7.67529C10.8989 7.26129 11.2349 6.92529 11.6489 6.92529C12.0629 6.92529 12.3989 7.26129 12.3989 7.67529V12.2963L15.9589 14.4193C16.3139 14.6323 16.4309 15.0923 16.2189 15.4483C16.0779 15.6833 15.8289 15.8143 15.5739 15.8143Z'
      fill='#103183'
    />
  </svg>
);

const CheckIcon: FC = () => (
  <svg width='20' height='20' viewBox='0 0 20 20' fill='none'>
    <circle cx='10' cy='10' r='8.5' stroke='#4CAF50' strokeWidth='1.2' />
    <path d='M6.5 10l2.5 2.5 4.5-4.5' stroke='#4CAF50' strokeWidth='1.2' strokeLinecap='round' strokeLinejoin='round' />
  </svg>
);

const ChevronIcon: FC<{ open: boolean }> = ({ open }) => (
  <Icon className={clsx('transition-transform duration-200 shrink-0 rotate-90', open && '!-rotate-90')} name={'tick'} />
);

// ── Empty chart placeholder ────────────────────────────────────────────────────

const EmptyChart: FC = () => (
  <div className='flex flex-col items-center justify-center flex-1 py-12'>
    <div className={'mb-4'}>
      <svg width='64' height='64' viewBox='0 0 64 64' fill='none' xmlns='http://www.w3.org/2000/svg'>
        <path
          fillRule='evenodd'
          clipRule='evenodd'
          d='M40.6474 12.6333C40.6474 18.556 45.4557 23.3572 51.387 23.3572C52.0401 23.354 52.6916 23.2913 53.3333 23.1699V44.4304C53.3333 53.3748 48.0572 58.6665 39.0997 58.6665H19.5902C10.6093 58.6665 5.33325 53.3748 5.33325 44.4304V24.9494C5.33325 16.005 10.6093 10.6665 19.5902 10.6665H40.835C40.7089 11.3145 40.6461 11.9732 40.6474 12.6333ZM35.0665 39.7241L42.6874 29.8899V29.8431C43.3398 28.9664 43.1734 27.7302 42.3122 27.0567C41.8954 26.735 41.3658 26.5957 40.8443 26.6707C40.3229 26.7457 39.8542 27.0286 39.5453 27.4548L33.1203 35.7202L25.8042 29.9602C25.3865 29.6348 24.8551 29.4911 24.3301 29.5616C23.805 29.6321 23.3305 29.9108 23.0138 30.3348L15.1349 40.4967C14.858 40.8419 14.7089 41.272 14.7128 41.7143C14.6671 42.6082 15.2316 43.4202 16.0863 43.69C16.9409 43.9598 17.8703 43.6193 18.3474 42.8616L24.9366 34.3387L32.2526 40.0753C32.6688 40.4108 33.2036 40.5629 33.7343 40.4966C34.265 40.4304 34.7459 40.1515 35.0665 39.7241Z'
          fill='#4A5363'
        />
        <circle opacity='0.4' cx='51.9999' cy='12.0002' r='6.66667' fill='#4A5363' />
      </svg>
    </div>
    <div className='text-center'>
      <p className='text-xl font-semibold text-label-tertiary mb-2'>No data yet</p>
      <p className='text-sm text-label-tertiary'>The chart will appear after the first investment</p>
    </div>
  </div>
);

const CANDLE_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w'] as const;

// ── Pool page ──────────────────────────────────────────────────────────────────

const PoolPage: FC = () => {
  const params = useParams();
  const poolId = params.poolId as string;
  const { user } = useAuth();

  const [candleInterval, setCandleInterval] = useState<string>('5m');
  const [scheduleOpen, setScheduleOpen] = useState(true);
  const [priceChartOpen, setPriceChartOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const { data: poolData } = useQuery(GET_POOL_BY_ID, {
    variables: { id: poolId },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pool: AnyPool = (poolData as any)?.getPool ?? null;
  const projectId: string | undefined = pool?.businessId;

  const { data: businessData } = useQuery(GET_BUSINESS_WITH_RISK, {
    variables: { id: projectId },
    skip: !projectId,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const business = (businessData as any)?.getBusiness;

  const companyId: string | undefined =
    business?.ownerType === 'company' ? business?.ownerId : undefined;

  const { data: companyData } = useQuery(GET_COMPANY, {
    variables: { id: companyId ?? '' },
    skip: !companyId,
  });

  const company = companyData?.getCompany;

  const canEditPool = user != null && pool != null && (
    pool.ownerType === 'company'
      ? company != null && (
          company.ownerId === user.userId ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (company.users as any[])?.some((u: any) => u.userId === user.userId)
        )
      : pool.ownerId === user.userId
  );

  const [now, setNow] = React.useState(() => Math.floor(Date.now() / 1000));
  React.useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15000);
    return () => clearInterval(id);
  }, []);
  const { data: priceHistoryData } = useQuery(GET_RAW_PRICE_DATA, {
    variables: { input: { poolAddress: pool?.poolAddress ?? '', startTime: now - 86400, endTime: now, sort: { timestamp: 'asc' }, limit: 1000 } },
    skip: !pool?.poolAddress,
    fetchPolicy: 'cache-and-network',
    pollInterval: 15000,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pricePoints: { price: string }[] = (priceHistoryData as any)?.getRawPriceData ?? [];

  const currentPrice = pricePoints.length > 0 ? parseWeiToNum(pricePoints[pricePoints.length - 1].price) : 0;
  const price24hAgo = pricePoints.length > 0 ? parseWeiToNum(pricePoints[0].price) : 0;

  const priceDiff = currentPrice && price24hAgo ? currentPrice - price24hAgo : 0;
  const priceDiffPct = price24hAgo ? (priceDiff / price24hAgo) * 100 : 0;
  const priceUp = priceDiff >= 0;

  const reservePrice = getPoolPrice(pool);
  const livePrice = currentPrice ? currentPrice.toFixed(4) : reservePrice === '—' ? '0.0000' : reservePrice;

  const [priceInt, priceDec] = livePrice.split('.');
  const progress = pool ? getProgressPercent(pool) : 0;
  const status = pool ? getPoolStatus(pool, now) : '—';
  const isFlexible = pool ? !pool.fixedSell : false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tranches: AnyPool[] = pool?.incomingTranches ?? [];
  const goalWei = (() => {
    try {
      return pool?.expectedHoldAmount ? BigInt(pool.expectedHoldAmount) : BigInt(0);
    } catch {
      return BigInt(0);
    }
  })();

  return (
    <DashboardLayout>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <section className='mb-8'>
        <Wrapper>
          <Breadcrumbs
            items={[
              { name: company?.name ?? '...', url: `/company/${companyId}` },
              { name: business?.name ?? '...', url: `/project/${projectId}` },
            ]}
            currentItem={pool?.name ?? '...'}
          />

          <div className='flex flex-col gap-5 pb-6 border-b border-stroke-primary md:flex-row md:items-start md:justify-between'>
            {/* Left: risk score, title, description, tags */}
            <div className='flex-1 min-w-0'>
              {/* AI risk score */}
              {business?.riskScore != null && (
                <div className='flex items-center gap-2 mb-3'>
                  <span className='text-base font-bold text-blue'>{business.riskScore}</span>
                  <span className='flex items-center gap-1 text-sm text-label-tertiary'>
                    <Icon name={'info'} />
                    AI risk score
                  </span>
                </div>
              )}

              {/* Pool name */}
              <Title className={'mb-6'} size={'md'}>
                {pool?.name ?? '...'}
              </Title>

              {/* Business description */}
              {business?.description && (
                <p className='text-base max-w-xl mb-3 leading-relaxed'>{business.description}</p>
              )}

              {/* Tags */}
              {pool?.tags?.length > 0 && (
                <div className='flex flex-wrap gap-2'>
                  {pool.tags.map((tag: string) => (
                    <span
                      key={tag}
                      className={'text-base/[100%] text-blue font-medium bg-[#D9E4FF] rounded-full px-3 py-2'}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Right: Edit / Share buttons */}
            <div className='flex gap-2 md:mt-2 md:shrink-0'>
              {canEditPool && (
                <Button visualType={'quinary'} onClick={() => setEditOpen(true)}>
                  <Icon name={'edit'} />
                  Edit
                </Button>
              )}
              <ShareMenu />
            </div>
          </div>
        </Wrapper>
      </section>

      {/* ── Main: chart + pool progress ──────────────────────────────────────── */}
      <section className='mb-10'>
        <Wrapper>
          <div className='flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8'>
            {/* ── Price / chart panel ──────────────────────────────────────── */}
            <div className='flex-1 min-w-0'>
              {/* Mobile: price card (always visible) */}
              <div className={'bg-bg-tertiary px-4 py-6 lg:hidden mb-3'}>
                <p className='text-sm text-label-tertiary mb-2'>
                  {priceDiff >= 0 ? '+' : ''}
                  {priceDiff.toFixed(4)} USDT{' '}
                  <span className={priceUp ? 'text-green-500' : 'text-red-500'}>
                    <Icon className={`inline size-4 ${priceUp ? '' : 'rotate-180'}`} name={'triangle'} />
                    {Math.abs(priceDiffPct).toFixed(2)}%
                  </span>{' '}
                  · 24h
                </p>
                <p className='flex items-center gap-1.5 text-3xl font-bold text-[#1D1D1F]'>
                  USDT
                  <span>
                    <Icon className={'size-8'} name={'usdt'} />
                  </span>
                  <span>
                    {priceInt}.<span className='text-2xl font-semibold'>{priceDec}</span>
                  </span>
                </p>

                {/* Mobile: toggle chart */}
                <button
                  type='button'
                  className='text-grey-dark flex gap-1 items-center lg:hidden'
                  onClick={() => setPriceChartOpen(o => !o)}
                >
                  <span>Token price chart</span>
                  <ChevronIcon open={priceChartOpen} />
                </button>
              </div>

              {/* Desktop: price + time filter row */}
              <div className='hidden lg:flex items-center justify-between mb-4'>
                <div>
                  <p className='flex items-center gap-1.5 text-4xl font-bold text-[#1D1D1F] mb-2'>
                    USDT
                    <span>
                      <Icon className={'size-8'} name={'usdt'} />
                    </span>
                    <span>
                      {priceInt}.<span className='text-2xl font-semibold'>{priceDec}</span>
                    </span>
                  </p>
                  <p className='text-base text-label-tertiary'>
                    {priceDiff >= 0 ? '+' : ''}
                    {priceDiff.toFixed(4)} USDT{' '}
                    <span className={priceUp ? 'text-green-500' : 'text-red-500'}>
                      <Icon className={'inline size-4 ' + (priceUp ? '' : 'rotate-180')} name={'triangle'} />
                      {Math.abs(priceDiffPct).toFixed(2)}%
                    </span>{' '}
                    · 24h
                  </p>
                </div>
                <div className='flex items-center gap-0.5 bg-bg-tertiary rounded-full p-0.5 flex-wrap'>
                  {CANDLE_INTERVALS.map(f => (
                    <button
                      key={f}
                      type='button'
                      onClick={() => setCandleInterval(f)}
                      className={clsx(
                        'px-3 py-1.5 rounded-full text-sm font-medium cursor-pointer tr-d-all',
                        candleInterval === f ? 'bg-[#D9E4FF] text-black' : 'text-grey-dark hover:text-blue-dark'
                      )}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* Chart area — desktop always, mobile collapsible */}
              <div className={clsx(!priceChartOpen && 'hidden lg:block')}>
                {pool?.poolAddress ? (
                  <PriceChart
                    poolAddress={pool.poolAddress}
                    interval={candleInterval}
                    fallback={
                      <div className='flex flex-col min-h-116'>
                        <EmptyChart />
                      </div>
                    }
                  />
                ) : (
                  <div className='flex flex-col min-h-116'>
                    <EmptyChart />
                  </div>
                )}
              </div>

              {/* Transactions — under chart, left of Pool progress */}
              {pool?.poolAddress && (
                <div className={clsx('mt-4', !priceChartOpen && 'hidden lg:block')}>
                  <PoolTransactions poolAddress={pool.poolAddress} />
                </div>
              )}
            </div>

            {/* ── Pool progress panel ───────────────────────────────────────── */}
            <div className='lg:w-110 shrink-0 flex flex-col gap-4'>
              <div className='border border-stroke-primary bg-bg-tertiary rounded-2xl overflow-hidden'>
                {/* Header */}
                <div className='flex items-center justify-between p-4 bg-white'>
                  <span className='text-base font-semibold'>Pool progress</span>
                  <span className={'text-base/[100%] text-blue font-medium bg-[#D9E4FF] rounded-full px-3 py-2'}>
                    {isFlexible ? 'Flexible pool' : 'Fixed pool'}
                  </span>
                </div>

                {/* Progress bar */}
                <div className='px-5 pt-4 pb-4 bg-white rounded-b-2xl'>
                  <div className='relative h-9 rounded-lg bg-stroke-secondary overflow-hidden flex items-center justify-center mb-2'>
                    {progress > 0 && (
                      <div
                        className='absolute top-0 left-0 h-full bg-blue rounded-xl'
                        style={{ width: `${progress}%` }}
                      />
                    )}
                    <span className='relative z-10 text-sm text-white'>
                      {formatHoldAmount(getCollectedHold(pool))} / {formatHoldAmount(pool?.expectedHoldAmount)}
                    </span>
                  </div>
                  <div className='flex items-center justify-between text-sm text-grey-dark'>
                    <span>Status: {status}</span>
                    <span>Closes: {formatDate(pool?.entryPeriodExpired)}</span>
                  </div>
                </div>

                {/* Debt paying schedule */}
                <div className=''>
                  <button
                    type='button'
                    className='w-full flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-grey-light/40 tr-d-all'
                    onClick={() => setScheduleOpen(o => !o)}
                  >
                    <span className='text-base font-semibold'>
                      <span className='lg:hidden'>Repayment schedule</span>
                      <span className='hidden lg:inline'>Debt paying schedule</span>
                    </span>
                    <ChevronIcon open={scheduleOpen} />
                  </button>

                  {scheduleOpen && (
                    <>
                      {tranches.length === 0 ? (
                        <p className='px-5 pb-4 text-sm text-grey-dark'>No repayment schedule set</p>
                      ) : (
                        <div className='max-h-72 overflow-y-auto'>
                          {/* Table header */}
                          <div
                            className='grid p-4 text-xs text-grey-dark border-b border-stroke-primary'
                            style={{ gridTemplateColumns: '36px 1fr 1fr 36px' }}
                          >
                            <span>№</span>
                            <span className='flex items-center gap-1'>Tranche timing</span>
                            <span>Amount</span>
                            <span />
                          </div>

                          {/* Rows */}
                          <div className='divide-y divide-stroke-primary'>
                            {tranches.map((t: AnyPool, i: number) => {
                              const isReturned = t.returnedAmount && t.returnedAmount !== '0';
                              return (
                                <div
                                  key={i}
                                  className='grid p-4 text-sm items-center'
                                  style={{ gridTemplateColumns: '36px 1fr 1fr 36px' }}
                                >
                                  <span className='text-grey-dark'>{i + 1}</span>
                                  <span>{pool ? getTrancheDay(t.expiredAt, pool.entryPeriodExpired) : '—'}</span>
                                  <span>
                                    <span>{getTrancheUsdt(t.amount)} USDT</span>
                                    <span className='text-[#9B9BA5] ml-1'>
                                      ({getTranchePercent(t.amount, goalWei)}%)
                                    </span>
                                  </span>
                                  <div className='flex justify-end'>{isReturned ? <CheckIcon /> : <ClockIcon />}</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* ── Buy / Sell widget ─────────────────────────────────────── */}
              {(() => {
                if (!pool) return <BuyTokenWidget pool={pool} />;
                const start = pool.entryPeriodStart;
                const { buyDisabledReason, sellDisabledReason } = getPoolTradeState(pool, now);
                if (start && now < start) {
                  return (
                    <div className='bg-white border border-stroke-primary rounded-2xl p-5 flex flex-col gap-2'>
                      <span className='text-base font-bold text-[#1D1D1F]'>Not open yet</span>
                      <span className='text-sm text-grey-dark'>
                        Collecting starts on {formatDate(start)}.
                      </span>
                    </div>
                  );
                }
                if (buyDisabledReason && sellDisabledReason) {
                  return (
                    <div className='bg-white border border-stroke-primary rounded-2xl p-5 flex flex-col gap-2'>
                      <span className='text-base font-bold text-[#1D1D1F]'>Trading unavailable</span>
                      <span className='text-sm text-grey-dark'>{buyDisabledReason}.</span>
                    </div>
                  );
                }
                return (
                  <BuyTokenWidget
                    pool={pool}
                    buyDisabledReason={buyDisabledReason}
                    sellDisabledReason={sellDisabledReason}
                  />
                );
              })()}
            </div>
          </div>
        </Wrapper>
      </section>

      {/* ── News ─────────────────────────────────────────────────────────────── */}
      <section className='mb-12'>
        <Wrapper>
          {projectId && <NewsList projectId={projectId} companyId={companyId} canEdit={canEditPool} />}
        </Wrapper>
      </section>
      <EditPoolModal pool={pool} isOpen={editOpen} onClose={() => setEditOpen(false)} />
    </DashboardLayout>
  );
};

export default PoolPage;