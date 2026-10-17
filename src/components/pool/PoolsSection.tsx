'use client';

import React, { FC } from 'react';
import Image from 'next/image';
import { useQuery } from '@apollo/client/react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button, ButtonBorderDash, Card, Title } from '@/components/ui';
import { GET_POOLS } from '@/lib/pool/operations';
import { getCollectedHold } from '@/lib/pool/collected';
import { getPoolStatus } from '@/lib/pool/status';
import { getPoolPrice } from '@/lib/pool/display';
import { formatTicker } from '@/lib/formatTicker';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pool = any;

function formatAmount(raw: string | null | undefined): string {
  if (!raw) return '0';
  try {
    const val = Math.round(Number(BigInt(raw) / BigInt(10) ** BigInt(15)) / 1000);
    return val.toLocaleString('en-US').replace(/,/g, ' ');
  } catch {
    return '0';
  }
}

function formatPercent(raw: string | null | undefined): string {
  if (!raw) return '0';
  try {
    return (Number(raw) / 100).toFixed(2);
  } catch {
    return '0';
  }
}

function formatDate(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function getProgressPercent(pool: Pool): number {
  try {
    const current = Number(BigInt(getCollectedHold(pool)));
    const target = pool.expectedHoldAmount ? Number(BigInt(pool.expectedHoldAmount)) : 0;
    if (!target) return 0;
    return Math.min(100, (current / target) * 100);
  } catch {
    return 0;
  }
}

const CHAIN_NAMES: Record<string, string> = {
  '97': 'BSC Testnet',
  '56': 'BSC',
};

function getNetworkName(chainId: string | null | undefined): string {
  if (!chainId) return 'BSC Testnet';
  return CHAIN_NAMES[chainId] ?? `Chain ${chainId}`;
}

const PoolCard: FC<{ pool: Pool; projectId: string }> = ({ pool, projectId }) => {
  const isPending = !pool.poolAddress;
  const status = getPoolStatus(pool);
  const progress = getProgressPercent(pool);
  const price = getPoolPrice(pool);
  const token = getNetworkName(pool.chainId);

  return (
    <Link href={`/pool/${pool.id}`} className="block">
    <Card size={'sm'} color={'greyLight'} className={isPending ? 'opacity-50' : undefined}>
      <div className={'mb-4 flex items-center gap-3'}>
        <div className={'relative w-12 h-12 rounded-full overflow-hidden shrink-0'}>
          {pool.image ? (
            <Image
              src={pool.imageUrl}
              alt={pool.name}
              fill
              className={'object-cover'}
            />
          ) : (
            <div
              className={'w-full h-full'}
              style={{
                backgroundImage: 'repeating-conic-gradient(#e5e7eb 0% 25%, #fff 0% 50%)',
                backgroundSize: '12px 12px',
              }}
            />
          )}
        </div>
        <div className={'font-bold text-base truncate'}>{pool.name}</div>
      </div>

      <div className={'mb-2'}>
        <div className={'relative overflow-hidden rounded-lg bg-stroke-secondary h-9 flex items-center justify-center'}>
          {progress > 0 && (
            <div
              className={'absolute top-0 left-0 h-full bg-blue rounded-xl'}
              style={{ width: `${progress}%` }}
            />
          )}
          <span className={'relative z-10 text-sm text-white'}>
            {formatAmount(getCollectedHold(pool))} / {formatAmount(pool.expectedHoldAmount)}
          </span>
        </div>
      </div>

      <div className={'flex items-center justify-between text-sm text-grey-dark mb-4'}>
        <span>Status: {status}</span>
        <span>Closes: {formatDate(pool.entryPeriodExpired)}</span>
      </div>

      <div className={'border-t border-grey/40 pt-4'}>
        <div className={'flex items-start justify-between gap-2'}>
          <div>
            <div className={'text-black text-xl font-bold mb-1'}>
              {price} HOLD{' '}
              <span className={'text-grey-dark text-base font-normal'}>/ 1 {formatTicker(pool.name)}</span>
            </div>
            <div className={'py-1 px-3 rounded-[20px] bg-blue-dim w-fit text-sm'}>
              ~{formatPercent(pool.rewardPercent)}% monthly profit
            </div>
          </div>
          <div className={'py-1 px-3 rounded-[20px] bg-blue-dim text-blue text-sm font-medium shrink-0'}>
            {token}
          </div>
        </div>
      </div>
    </Card>
    </Link>
  );
};

interface PoolsSectionProps {
  projectId: string;
  // Only members of the project's company may add pools; everyone else doesn't see "Add pool" at all.
  canAddPool: boolean;
  // When set, "Add pool" is inactive and this text explains why (project not deployed on-chain yet).
  addPoolDisabledReason?: string;
}

const PoolsSection: FC<PoolsSectionProps> = ({ projectId, canAddPool, addPoolDisabledReason }) => {
  const params = useParams();

  const { data } = useQuery(GET_POOLS, {
    variables: { input: { filter: { businessId: projectId } } },
    skip: !projectId,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pools: Pool[] = (data as any)?.getPools ?? [];

  return (
    <>
      <div className={'flex items-center justify-between mb-6'}>
        <Title size={'xs'} level={2}>Pools</Title>
        {canAddPool && pools.length > 0 &&
          (addPoolDisabledReason ? (
            <Button visualType={'quaternary'} disabled className={'opacity-50 cursor-not-allowed'}>
              + Add pool
            </Button>
          ) : (
            <Button visualType={'quaternary'} href={`/add-pool?businessId=${projectId}`}>
              + Add pool
            </Button>
          ))}
      </div>
      {canAddPool && addPoolDisabledReason && <p className={'text-sm text-label-tertiary mb-4'}>{addPoolDisabledReason}</p>}

      {pools.length === 0 ? (
        <div className={'max-w-110'}>
          {!canAddPool ? (
            <p className={'text-base text-label-tertiary'}>No pools yet.</p>
          ) : addPoolDisabledReason ? (
            <ButtonBorderDash disabled className={'min-h-74.5 opacity-50 cursor-not-allowed'}>
              Add pool
            </ButtonBorderDash>
          ) : (
            <ButtonBorderDash href={`/add-pool?businessId=${projectId}`} className={'min-h-74.5'}>
              Add pool
            </ButtonBorderDash>
          )}
        </div>
      ) : (
        <div className={'grid grid-cols-2 gap-4'}>
          {pools.map((pool: Pool) => (
            <PoolCard key={pool.id} pool={pool} projectId={projectId} />
          ))}
        </div>
      )}
    </>
  );
};

export default PoolsSection;
