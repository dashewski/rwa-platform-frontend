'use client';

import React, { FC, useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { CommonLayout, Wrapper } from '@/components/layout';
import { Button, Icon, Title } from '@/components/ui';
import { FAQ } from '@/components/common';
import { MarketplaceCard, MarketplaceFilters, MobileFiltersModal } from '@/components/marketplace';
import type { MarketplaceProject } from '@/components/marketplace';
import { RISK_SCORE_RANGES, POOL_STAGES, POOL_TYPES, type PoolStage, type PoolType } from '@/components/marketplace/MarketplaceFilters';
import type { FilterChip } from '@/components/marketplace/MobileFiltersModal';
import { GET_POOLS } from '@/lib/pool/operations';
import { getCollectedHold } from '@/lib/pool/collected';
import { getPoolPrice, formatPoolDate } from '@/lib/pool/display';
import { getPoolStatus } from '@/lib/pool/status';
import { GET_BUSINESSES } from '@/lib/business/operations';
import { formatTicker } from '@/lib/formatTicker';
import { getCountryByCode } from '@/lib/countries';

// ── Helpers ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPool = any;

function parseWeiToNum(raw: string | null | undefined): number {
  if (!raw) return 0;
  try {
    return Number(BigInt(raw) / BigInt(10) ** BigInt(15)) / 1000;
  } catch {
    return 0;
  }
}

function getMonthlyProfit(rewardPercent: number | null | undefined): string {
  if (rewardPercent == null) return '0';
  // stored as basis points (e.g. 600 → 6%) or as plain percent (e.g. 6)
  const pct = rewardPercent > 100 ? rewardPercent / 100 : rewardPercent;
  return pct % 1 === 0 ? String(pct) : pct.toFixed(1);
}

function poolToProject(pool: AnyPool): MarketplaceProject {
  const price = `${getPoolPrice(pool)} USDT`;
  const priceNum = parseFloat(price) || 0;
  return {
    id:            pool.id,
    name:          pool.name,
    tokenTicker:   formatTicker(pool.name),
    logoUrl:       pool.imageUrl ?? undefined,
    price,
    priceNum,
    monthlyProfit: getMonthlyProfit(pool.rewardPercent),
    collected:     parseWeiToNum(getCollectedHold(pool)),
    total:         parseWeiToNum(pool.expectedHoldAmount),
    dueDate:       formatPoolDate(pool.completionPeriodExpired ?? pool.entryPeriodExpired),
    closesDate: formatPoolDate(pool.entryPeriodExpired),
    status: getPoolStatus(pool),
    startsOn: pool.entryPeriodStart && Date.now() / 1000 < pool.entryPeriodStart ? formatPoolDate(pool.entryPeriodStart) : undefined,
    createdAt:     pool.createdAt ?? 0,
    riskScore:     pool.riskScore ?? 0,
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const VISIBLE_COUNT = 9;

const FAQ_LIST = [
  {
    question: 'How am I protected from fraud?',
    answer: (
      <>
        <p>We aim to create a safe and secure environment for all users by combining these measures:</p>
        <ul>
          <li>We use Know Your Client (KYC) protocols to verify every project</li>
          <li>Our platform uses audited smart contracts to ensure that transactions are secure and tamper-proof</li>
          <li>We provide resources to educate users on common scams and best practices for online security</li>
          <li>Our platform has a dispute resolution system in place to handle any issues that may arise during transactions</li>
        </ul>
      </>
    ),
  },
  {
    question: 'What are the legal implications of tokenizing my business assets?',
    answer: (
      <p>
        Tokenization of business assets involves legal considerations that vary by jurisdiction. Our team ensures all
        projects comply with applicable regulations, including securities law and AML requirements. Each project
        undergoes thorough legal review before being listed on the marketplace.
      </p>
    ),
  },
  {
    question: 'How can I ensure the security of my tokens?',
    answer: (
      <p>
        All tokens on Slices are backed by audited smart contracts on reputable blockchains. You retain full
        ownership of your private keys, and all transactions are transparent and verifiable on-chain. We also
        recommend using a hardware wallet for additional security.
      </p>
    ),
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

const Marketplace: FC = () => {
  const [showAll, setShowAll] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [sortBy, setSortBy] = useState('newest');
  const [selectedRanges, setSelectedRanges] = useState<number[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedStages, setSelectedStages] = useState<PoolStage[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<PoolType[]>([]);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);

  const activeChips: FilterChip[] = [
    ...selectedRanges.map(i => ({
      label: RISK_SCORE_RANGES[i].label,
      onRemove: () => setSelectedRanges(prev => prev.filter(r => r !== i)),
    })),
    ...selectedCategories.map(cat => ({
      label: cat,
      onRemove: () => setSelectedCategories(prev => prev.filter(c => c !== cat)),
    })),
    ...selectedStages.map(stage => ({
      label: POOL_STAGES.find(s => s.value === stage)!.label,
      onRemove: () => setSelectedStages(prev => prev.filter(s => s !== stage)),
    })),
    ...selectedTypes.map(type => ({
      label: POOL_TYPES.find(t => t.value === type)!.label,
      onRemove: () => setSelectedTypes(prev => prev.filter(t => t !== type)),
    })),
    ...selectedCountries.map(code => ({
      label: getCountryByCode(code)?.name ?? code,
      onRemove: () => setSelectedCountries(prev => prev.filter(c => c !== code)),
    })),
  ];

  const clearAllFilters = () => {
    setSelectedRanges([]);
    setSelectedCategories([]);
    setSelectedStages([]);
    setSelectedTypes([]);
    setSelectedCountries([]);
  };

  const { data, loading, error } = useQuery(GET_POOLS, {
    variables: { input: { filter: {} } },
  });

  const { data: businessesData } = useQuery(GET_BUSINESSES, {
    variables: { input: { filter: {} } },
  });

  console.log('[Marketplace] pools query →', { loading, error, data });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawPools: AnyPool[] = (data as any)?.getPools ?? [];
  const categories: string[] = Array.from(new Set<string>(rawPools.flatMap((p: AnyPool) => p.tags ?? []))).sort();

  const businessCountryMap: Record<string, string> = Object.fromEntries(
    (businessesData?.getBusinesses ?? [])
      .filter(b => !!b.country)
      .map(b => [b.id, b.country as string])
  );
  const countries: string[] = Array.from(new Set(Object.values(businessCountryMap))).sort();

  function getPoolStage(pool: AnyPool): PoolStage {
    if (getPoolStatus(pool) === 'Upcoming') return 'upcoming';
    if (pool.isFullyReturned) return 'paying_profit';
    if (pool.isTargetReached) return 'paying_debt';
    return 'collecting';
  }

  const allProjects: MarketplaceProject[] = rawPools
    .filter((pool: AnyPool) => !!pool.poolAddress)
    .filter((pool: AnyPool) => {
      if (selectedStages.length === 0) return true;
      return selectedStages.includes(getPoolStage(pool));
    })
    .filter((pool: AnyPool) => {
      if (selectedCategories.length === 0) return true;
      return selectedCategories.some(cat => (pool.tags ?? []).includes(cat));
    })
    .filter((pool: AnyPool) => {
      if (selectedTypes.length === 0) return true;
      const poolType: PoolType = pool.fixedSell ? 'fixed' : 'flexible';
      return selectedTypes.includes(poolType);
    })
    .filter((pool: AnyPool) => {
      if (selectedCountries.length === 0) return true;
      return selectedCountries.includes(businessCountryMap[pool.businessId]);
    })
    .map(poolToProject)
    .filter((p: MarketplaceProject) => {
      if (selectedRanges.length === 0) return true;
      return selectedRanges.some(i => {
        const range = RISK_SCORE_RANGES[i];
        return p.riskScore >= range.min && p.riskScore <= range.max;
      });
    })
    .sort((a: MarketplaceProject, b: MarketplaceProject) => {
      switch (sortBy) {
        case 'price_desc': return b.priceNum - a.priceNum;
        case 'price_asc':  return a.priceNum - b.priceNum;
        case 'goal_desc':  return b.total - a.total;
        case 'goal_asc':   return a.total - b.total;
        default:           return b.createdAt - a.createdAt; // newest first
      }
    });
  const visibleProjects = showAll ? allProjects : allProjects.slice(0, VISIBLE_COUNT);

  return (
    <CommonLayout>
      {/* Hero */}
      <section className={'relative pt-[96px] pb-25 md:pb-37.5 md:pt-[184px]'}>
        <div
          className={
            'absolute inset-x-0 top-0 -bottom-[360px] md:-bottom-[110px] ' +
            'bg-[url(/images/market-bg-m.png)] bg-top bg-cover bg-no-repeat ' +
            'md:bg-[url(/images/market-bg-d.png)] md:bg-size-[100%_660px] -z-10'
          }
        />
        <Wrapper>
          <div className={'relative flex flex-col items-center'}>
            <Title className={'text-white text-center mb-4 max-w-[860px]'} size={'xl'} level={1}>
              Choose from hundreds of promising projects
            </Title>
            <p className={'text-base/[1.4] text-center text-white max-w-[560px]'}>
              Select pools by price, rating, or industry — and start earning today
            </p>
          </div>
        </Wrapper>
      </section>

      {/* Marketplace content */}
      <section className={'relative z-10 mb-25 md:mb-50'}>
        <Wrapper>
          <div className={'flex gap-5 items-start'}>
            {/* Sidebar (desktop only) */}
            <div className={'hidden lg:block w-[272px] shrink-0 sticky top-24'}>
              <MarketplaceFilters sortBy={sortBy} onSortChange={setSortBy} selectedRanges={selectedRanges} onRangeChange={setSelectedRanges} categories={categories} selectedCategories={selectedCategories} onCategoryChange={setSelectedCategories} selectedStages={selectedStages} onStageChange={setSelectedStages} selectedTypes={selectedTypes} onTypeChange={setSelectedTypes} countries={countries} selectedCountries={selectedCountries} onCountryChange={setSelectedCountries} />
            </div>

            {/* Content column */}
            <div className={'flex-1 min-w-0'}>
              {/* Mobile: section title + filter trigger */}
              <div className={'lg:hidden flex flex-col gap-6 mb-10'}>
                <div className={'flex flex-col gap-3 text-center'}>
                  <p className={'text-[32px] font-semibold leading-none tracking-[-1.5px] text-black'}>
                    Choose from hundreds of promising projects
                  </p>
                  <p className={'text-base leading-[1.4] text-grey-dark'}>
                    Find assets that meet your goals
                  </p>
                </div>
                <button
                  onClick={() => setMobileFiltersOpen(true)}
                  className={'w-full flex items-center justify-between border border-grey rounded-xl h-[40px] px-5 tr-d-all'}
                >
                  <span className={'text-base leading-[1.4] text-grey-dark'}>Filters</span>
                  <Icon name={'tick'} className={'size-5 shrink-0 rotate-90 text-grey-dark'} />
                </button>
              </div>

              {/* Filter chips (desktop only) */}
              <div className={'hidden lg:flex flex-wrap gap-3 mb-9'}>
                {activeChips.map(chip => (
                  <button
                    key={chip.label}
                    onClick={chip.onRemove}
                    className={'shrink-0 flex items-center gap-4 bg-blue-dim text-black text-sm font-normal px-4 py-2 rounded-full tr-d-all hover:bg-blue-dim/70'}
                  >
                    {chip.label}
                    <span className={'size-2 mask-contain mask-[url(/icons/cross.svg)] bg-black'} />
                  </button>
                ))}
                {activeChips.length === 0 && (
                  <span className={'text-sm text-grey-dark py-2'}>No active filters</span>
                )}
                {activeChips.length > 0 && (
                  <button
                    onClick={clearAllFilters}
                    className={'shrink-0 flex items-center gap-2 text-black text-sm font-normal py-2 tr-d-all hover:text-grey-dark'}
                  >
                    <span className={'size-5 mask-contain mask-[url(/icons/cross.svg)] bg-black'} />
                    Clear all
                  </button>
                )}
              </div>

              {/* Cards */}
              {loading ? (
                <div className={'grid gap-3 sm:grid-cols-2 xl:grid-cols-3 mb-5'}>
                  {Array.from({ length: VISIBLE_COUNT }).map((_, i) => (
                    <div key={i} className={'bg-grey-light rounded-[2.5rem] h-[330px] animate-pulse'} />
                  ))}
                </div>
              ) : allProjects.length === 0 ? (
                error ? (
                  <p className={'text-grey-dark text-base py-12 text-center'}>{`Error: ${error.message}`}</p>
                ) : (
                  <div className={'flex flex-col gap-6 items-center text-center py-16'}>
                    <div className={'flex flex-col gap-3 items-center'}>
                      <p className={'text-2xl font-semibold text-black'}>Whoops! Nothing found</p>
                      <p className={'text-base leading-[1.4] text-grey-dark'}>
                        Try removing some filters or clear all of them
                      </p>
                    </div>
                    <Button visualType={'secondary'} onClick={clearAllFilters}>
                      Remove filters
                    </Button>
                  </div>
                )
              ) : (
                <>
                  <div className={'grid gap-3 sm:grid-cols-2 xl:grid-cols-3 mb-5'}>
                    {visibleProjects.map(project => (
                      <MarketplaceCard key={project.id} project={project} />
                    ))}
                  </div>
                  {!showAll && allProjects.length > VISIBLE_COUNT && (
                    <Button className={'w-full'} visualType={'secondary'} onClick={() => setShowAll(true)}>
                      Show more projects
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </Wrapper>
      </section>

      <FAQ title={'You might want to know'} faqList={FAQ_LIST} />

      {/* Mobile filters modal */}
      {mobileFiltersOpen && (
        <MobileFiltersModal
          activeChips={activeChips}
          onClearAll={clearAllFilters}
          onClose={() => setMobileFiltersOpen(false)}
          sortBy={sortBy}
          onSortChange={setSortBy}
          selectedRanges={selectedRanges}
          onRangeChange={setSelectedRanges}
          categories={categories}
          selectedCategories={selectedCategories}
          onCategoryChange={setSelectedCategories}
          selectedStages={selectedStages}
          onStageChange={setSelectedStages}
          selectedTypes={selectedTypes}
          onTypeChange={setSelectedTypes}
          countries={countries}
          selectedCountries={selectedCountries}
          onCountryChange={setSelectedCountries}
        />
      )}
    </CommonLayout>
  );
};

export default Marketplace;
