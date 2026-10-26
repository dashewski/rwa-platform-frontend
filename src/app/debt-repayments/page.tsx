'use client';

import React, { FC, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { formatUnits } from 'viem';
import { useQuery } from '@apollo/client/react';
import { DashboardLayout, Wrapper } from '@/components/layout';
import { Button, Icon, Pagination, Tooltip } from '@/components/ui';
import {
  DebtRepaymentRow,
  DebtRepaymentCardMobile,
  DebtRepaymentDrawer,
  STATUS_LABELS,
} from '@/components/debt-repayments';
import type { DebtRepaymentPool, DebtRepaymentStatus } from '@/components/debt-repayments';
import { WithdrawalFilterModal, TransactionHistoryTable, TX_STATUS_LABELS } from '@/components/withdrawals';
import type { FilterCategory, PeriodRange, WithdrawalTx } from '@/components/withdrawals';
import { useAuth } from '@/lib/auth/AuthContext';
import { GET_COMPANIES } from '@/lib/company/operations';
import {
  GET_POOLS_FOR_DEBT_REPAYMENTS,
  GET_BUSINESSES_FOR_DEBT_REPAYMENTS,
  GET_COMPANIES_FOR_DEBT_REPAYMENTS,
  GET_DEBT_REPAYMENT_TRANSACTIONS,
} from '@/lib/debt-repayments/operations';
import { getPoolStatus } from '@/lib/pool/status';
import type { Pool, Business, Company, Transaction } from '@/gql/graphql';

// ── Constants ─────────────────────────────────────────────────────────────────

type TabKey = 'schedule' | 'history';

const ROWS_PER_PAGE = 11;
const HOLD_DECIMALS = 18;

// ── Helpers ───────────────────────────────────────────────────────────────────

function holdToNum(v: string | null | undefined): number {
  if (!v) return 0;
  try {
    return Number(formatUnits(BigInt(v), HOLD_DECIMALS));
  } catch {
    return 0;
  }
}

function tranchePayable(tranche: Pool['incomingTranches'][number]): number {
  const amount = holdToNum(tranche.amount);
  const returned = holdToNum(tranche.returnedAmount);
  return Math.max(amount - returned, 0);
}

function deriveDebtRepaymentRow(
  pool: Pool,
  companyName: string,
  projectName: string
): { row: DebtRepaymentPool; amountDueWei: bigint; percentOfDebt: number } {
  const now = Date.now() / 1000;
  const incoming = pool.incomingTranches;
  const completed = pool.lastCompletedIncomingTranche ?? 0;
  const total = incoming.length;
  const nextTranche = completed < total ? incoming[completed] : undefined;

  // Repayments only exist once the pool has reached its goal; before that (or if it never does)
  // there is nothing to pay, whatever the tranche dates say
  const funded = pool.isTargetReached;
  const status: DebtRepaymentStatus = !funded
    ? getPoolStatus(pool, now) === 'Failed'
      ? 'failed'
      : 'collecting'
    : !nextTranche
      ? 'successful'
      : nextTranche.expiredAt < now
        ? 'overdue'
        : 'upcoming';

  const amountDueWei = nextTranche
    ? BigInt(nextTranche.amount) - BigInt(nextTranche.returnedAmount || '0')
    : BigInt(0);

  const totalDebtWei = incoming.reduce((sum, t) => sum + BigInt(t.amount), BigInt(0));
  const percentOfDebt =
    nextTranche && totalDebtWei > BigInt(0) ? (Number(BigInt(nextTranche.amount)) / Number(totalDebtWei)) * 100 : 0;

  const row: DebtRepaymentPool = {
    id: pool.id,
    poolAddress: pool.poolAddress ?? '',
    name: pool.name,
    companyName,
    projectName,
    status,
    nextPaymentDate: nextTranche ? nextTranche.expiredAt : null,
    completedTranches: completed,
    totalTranches: total,
    paymentAmount: nextTranche ? tranchePayable(nextTranche) : null,
    payable: funded && !!nextTranche,
  };

  return { row, amountDueWei, percentOfDebt };
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

const SkeletonRow: FC = () => (
  <div className={'bg-bg-primary border border-stroke-primary h-[52px] animate-pulse bg-bg-tertiary/40'} />
);

// ── Component ─────────────────────────────────────────────────────────────────

const DebtRepaymentsPage: FC = () => {
  const { user } = useAuth();
  const userId = user?.userId ?? '';

  const [activeTab, setActiveTab] = useState<TabKey>('schedule');
  const [page, setPage] = useState(1);
  const [filterOpen, setFilterOpen] = useState(false);
  const [activeFilterCategory, setActiveFilterCategory] = useState<FilterCategory>('Status');
  const [filterSelections, setFilterSelections] = useState<Record<string, string[]>>({});
  const [periodRange, setPeriodRange] = useState<PeriodRange | null>(null);
  const [mobileVisibleCount, setMobileVisibleCount] = useState(ROWS_PER_PAGE);
  const [payTarget, setPayTarget] = useState<
    (DebtRepaymentPool & { amountDueWei: bigint; percentOfDebt: number }) | null
  >(null);

  const [historyPage, setHistoryPage] = useState(1);
  const [historyMobileVisibleCount, setHistoryMobileVisibleCount] = useState(ROWS_PER_PAGE);
  const [historyFilterOpen, setHistoryFilterOpen] = useState(false);
  const [historyActiveFilterCategory, setHistoryActiveFilterCategory] = useState<FilterCategory>('Status');
  const [historyFilterSelections, setHistoryFilterSelections] = useState<Record<string, string[]>>({});
  const [historyPeriodRange, setHistoryPeriodRange] = useState<PeriodRange | null>(null);

  // Query 1: companies owned directly by the current user
  const { data: companiesOwnedData } = useQuery(GET_COMPANIES, {
    variables: { input: { filter: { ownerId: userId } } },
    skip: !userId,
  });
  const ownedCompanyIds: string[] = (companiesOwnedData?.getCompanies ?? []).map(c => c.id);

  // Query 2: pools owned by the user directly or via their companies
  const { data: poolsData, loading: poolsLoading } = useQuery(GET_POOLS_FOR_DEBT_REPAYMENTS, {
    variables: { input: { filter: { ownerId: { $in: [userId, ...ownedCompanyIds] } } } },
    skip: !userId,
  });
  const pools: Pool[] = (poolsData as { getPools?: Pool[] })?.getPools ?? [];

  const businessIds = useMemo(() => [...new Set(pools.map(p => p.businessId).filter(Boolean))], [pools]);

  // Query 3: businesses ("Project" column) for those pools
  const { data: businessesData } = useQuery(GET_BUSINESSES_FOR_DEBT_REPAYMENTS, {
    variables: { input: { filter: { _id: { $in: businessIds } } } },
    skip: businessIds.length === 0,
  });
  const businesses: Business[] = (businessesData as { getBusinesses?: Business[] })?.getBusinesses ?? [];

  const companyIds = useMemo(
    () => [...new Set(businesses.filter(b => b.ownerType === 'company').map(b => b.ownerId).filter(Boolean))],
    [businesses]
  );

  // Query 4: companies ("Company" column) owning those businesses
  const { data: companiesData } = useQuery(GET_COMPANIES_FOR_DEBT_REPAYMENTS, {
    variables: { input: { filter: { _id: { $in: companyIds } } } },
    skip: companyIds.length === 0,
  });
  const companies: Company[] = (companiesData as { getCompanies?: Company[] })?.getCompanies ?? [];

  const poolAddresses = useMemo(() => pools.map(p => p.poolAddress).filter(Boolean) as string[], [pools]);

  // Query 5: repayment transactions — HOLD transfers *to* one of the user's own pools
  const { data: txData, loading: txLoading } = useQuery(GET_DEBT_REPAYMENT_TRANSACTIONS, {
    variables: { input: { filter: { to: { $in: poolAddresses } } } },
    skip: poolAddresses.length === 0,
  });
  const rawTxs: Transaction[] = (txData as { getTransactions?: Transaction[] })?.getTransactions ?? [];

  const isLoading = poolsLoading;

  const businessById = useMemo(() => new Map(businesses.map(b => [b.id, b])), [businesses]);
  const companyById = useMemo(() => new Map(companies.map(c => [c.id, c])), [companies]);

  const derivedRows = useMemo(() => {
    return pools
      .filter(pool => !!pool.poolAddress) // a pool that isn't deployed yet has no repayment schedule
      .map(pool => {
        const business = pool.businessId ? businessById.get(pool.businessId) : undefined;
        const companyName =
          business?.ownerType === 'company' ? companyById.get(business.ownerId)?.name ?? '—' : '—';
        const projectName = business?.name ?? '—';
        const { row, amountDueWei, percentOfDebt } = deriveDebtRepaymentRow(pool, companyName, projectName);
        return { row, amountDueWei, percentOfDebt };
      })
      .sort((a, b) => {
        if (a.row.nextPaymentDate === null) return 1;
        if (b.row.nextPaymentDate === null) return -1;
        return a.row.nextPaymentDate - b.row.nextPaymentDate;
      });
  }, [pools, businessById, companyById]);

  const totalDueUsdt = useMemo(
    () => derivedRows.reduce((sum, { row }) => sum + (row.payable ? row.paymentAmount ?? 0 : 0), 0),
    [derivedRows]
  );

  const categoryOptions = useMemo<Partial<Record<FilterCategory, string[]>>>(
    () => ({
      Status: Object.values(STATUS_LABELS),
      Pool: [...new Set(derivedRows.map(r => r.row.name))],
    }),
    [derivedRows]
  );

  const activeFilterCount = useMemo(
    () => Object.values(filterSelections).filter(v => v.length > 0).length + (periodRange ? 1 : 0),
    [filterSelections, periodRange]
  );

  const handleToggle = (category: FilterCategory, value: string) => {
    if (value === '__all__') {
      setFilterSelections(prev => ({ ...prev, [category]: [] }));
      return;
    }
    setFilterSelections(prev => {
      const current = prev[category] ?? [];
      const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
      return { ...prev, [category]: next };
    });
  };

  const filteredRows = useMemo(() => {
    let rows = derivedRows;

    const statusSel = filterSelections['Status'] ?? [];
    if (statusSel.length > 0) {
      rows = rows.filter(r => statusSel.includes(STATUS_LABELS[r.row.status]));
    }

    const poolSel = filterSelections['Pool'] ?? [];
    if (poolSel.length > 0) {
      rows = rows.filter(r => poolSel.includes(r.row.name));
    }

    if (periodRange) {
      const fromTs = new Date(periodRange.from).getTime() / 1000;
      const toTs = new Date(periodRange.to).getTime() / 1000 + 86400; // inclusive of the whole "to" day
      rows = rows.filter(r => r.row.nextPaymentDate !== null && r.row.nextPaymentDate >= fromTs && r.row.nextPaymentDate < toTs);
    }

    return rows;
  }, [derivedRows, filterSelections, periodRange]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / ROWS_PER_PAGE));
  const paginatedRows = filteredRows.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE);
  const mobileRows = filteredRows.slice(0, mobileVisibleCount);

  useEffect(() => {
    setMobileVisibleCount(ROWS_PER_PAGE);
    setPage(1);
  }, [filterSelections, periodRange]);

  const historyTxs: WithdrawalTx[] = useMemo(() => {
    const poolByAddress = new Map(pools.map(p => [(p.poolAddress ?? '').toLowerCase(), p]));
    return rawTxs
      .map(tx => ({
        id: tx.id,
        poolName: poolByAddress.get(tx.poolAddress.toLowerCase())?.name ?? '—',
        date: tx.createdAt,
        amountRwa: tx.amount,
        status: 'completed' as const,
        txHash: tx.transactionHash,
      }))
      .sort((a, b) => b.date - a.date);
  }, [rawTxs, pools]);

  const historyCategoryOptions = useMemo<Partial<Record<FilterCategory, string[]>>>(
    () => ({
      Status: Object.values(TX_STATUS_LABELS),
      Pool: [...new Set(historyTxs.map(tx => tx.poolName))],
    }),
    [historyTxs]
  );

  const historyActiveFilterCount = useMemo(
    () => Object.values(historyFilterSelections).filter(v => v.length > 0).length + (historyPeriodRange ? 1 : 0),
    [historyFilterSelections, historyPeriodRange]
  );

  const handleHistoryToggle = (category: FilterCategory, value: string) => {
    if (value === '__all__') {
      setHistoryFilterSelections(prev => ({ ...prev, [category]: [] }));
      return;
    }
    setHistoryFilterSelections(prev => {
      const current = prev[category] ?? [];
      const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
      return { ...prev, [category]: next };
    });
  };

  const filteredHistoryTxs = useMemo(() => {
    let rows = historyTxs;

    const statusSel = historyFilterSelections['Status'] ?? [];
    if (statusSel.length > 0) {
      rows = rows.filter(tx => statusSel.includes(TX_STATUS_LABELS[tx.status]));
    }

    const poolSel = historyFilterSelections['Pool'] ?? [];
    if (poolSel.length > 0) {
      rows = rows.filter(tx => poolSel.includes(tx.poolName));
    }

    if (historyPeriodRange) {
      const fromTs = new Date(historyPeriodRange.from).getTime() / 1000;
      const toTs = new Date(historyPeriodRange.to).getTime() / 1000 + 86400; // inclusive of the whole "to" day
      rows = rows.filter(tx => tx.date >= fromTs && tx.date < toTs);
    }

    return rows;
  }, [historyTxs, historyFilterSelections, historyPeriodRange]);

  const historyTotalPages = Math.max(1, Math.ceil(filteredHistoryTxs.length / ROWS_PER_PAGE));
  const paginatedHistory = filteredHistoryTxs.slice((historyPage - 1) * ROWS_PER_PAGE, historyPage * ROWS_PER_PAGE);
  const mobileHistory = filteredHistoryTxs.slice(0, historyMobileVisibleCount);

  useEffect(() => {
    setHistoryMobileVisibleCount(ROWS_PER_PAGE);
    setHistoryPage(1);
  }, [historyFilterSelections, historyPeriodRange]);

  const handlePay = (row: DebtRepaymentPool) => {
    const derived = derivedRows.find(r => r.row.id === row.id);
    if (!derived) return;
    setPayTarget({ ...row, amountDueWei: derived.amountDueWei, percentOfDebt: derived.percentOfDebt });
  };

  const handlePaid = () => {
    // Real balances only reflect on-chain after the tx is indexed — same
    // caveat as Withdrawals' handleWithdrawn.
  };

  return (
    <DashboardLayout>
      <section className={'py-8 md:py-12'}>
        <Wrapper>
          {user?.wallet && (
            <div
              className={
                'flex items-center gap-2 bg-bg-tertiary rounded-full px-3 py-2 w-fit mb-4 text-sm text-grey-dark'
              }
            >
              {user.wallet.slice(0, 6)}...{user.wallet.slice(-6)}
            </div>
          )}

          <p className={'flex items-center gap-1.5 text-3xl lg:text-4xl font-bold text-[#1D1D1F] mb-8'}>
            USDT
            <Icon className={'size-6 lg:size-8'} name={'usdt'} />
            {totalDueUsdt.toLocaleString('en-US', { maximumFractionDigits: 2 })}
          </p>

          <div className={'flex gap-4 border-b border-stroke-primary mb-6'}>
            {(
              [
                { key: 'schedule', label: 'Tranche schedule' },
                { key: 'history', label: 'Transaction history' },
              ] as const
            ).map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={clsx(
                  'flex flex-col gap-3 pb-0 text-base font-medium tr-d-all',
                  activeTab === tab.key ? 'text-black' : 'text-label-tertiary'
                )}
              >
                <span className={'flex items-center gap-1'}>
                  {tab.label}
                  <Tooltip
                    content={
                      tab.key === 'schedule'
                        ? 'Track scheduled tranches, including amounts, dates, and statuses'
                        : 'View all repayment transactions'
                    }
                  />
                </span>
                <span
                  className={clsx(
                    'h-0.5 rounded-full w-full transition-all',
                    activeTab === tab.key ? 'bg-blue' : 'bg-transparent'
                  )}
                />
              </button>
            ))}
          </div>

          {activeTab === 'schedule' ? (
            <div className={'flex flex-col gap-4'}>
              <div className={'max-lg:hidden'}>
                <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
              </div>

              <div className={'flex flex-col'}>
                <div
                  className={
                    'bg-bg-primary border border-stroke-primary rounded-t-lg flex justify-start px-3 py-4 relative z-10 ' +
                    'max-lg:bg-transparent max-lg:border-0 max-lg:rounded-none max-lg:px-0 max-lg:py-0'
                  }
                >
                  <Button visualType={'quinary'} onClick={() => setFilterOpen(prev => !prev)}>
                    <Icon name={'plus'} className={'size-3.5'} />
                    Filter
                    {activeFilterCount > 0 && (
                      <span
                        className={
                          'bg-blue text-white rounded-full w-4 h-4 text-[10px] flex items-center justify-center leading-none'
                        }
                      >
                        {activeFilterCount}
                      </span>
                    )}
                  </Button>
                  <WithdrawalFilterModal
                    open={filterOpen}
                    onClose={() => setFilterOpen(false)}
                    categories={['Status', 'Period', 'Pool']}
                    activeCategory={activeFilterCategory}
                    onCategoryChange={setActiveFilterCategory}
                    selections={filterSelections}
                    onToggle={handleToggle}
                    categoryOptions={categoryOptions}
                    periodRange={periodRange}
                    onPeriodRangeChange={setPeriodRange}
                  />
                </div>

                {/* Desktop table — no overflow-hidden: it would clip the status tooltip on hover */}
                <div className={'max-lg:hidden rounded-b-lg'}>
                  <div
                    className={
                      'bg-bg-primary border-x border-b border-stroke-primary h-[52px] flex items-center px-3 gap-2'
                    }
                  >
                    <span className={'text-sm font-medium text-grey-dark w-[200px] shrink-0'}>Pool</span>
                    <span className={'text-sm font-medium text-grey-dark flex-1 text-right'}>Payout date</span>
                    <span className={'text-sm font-medium text-grey-dark flex-1 text-right'}>Amount (USDT)</span>
                    <span className={'text-sm font-medium text-grey-dark flex-1 text-right'}>Status</span>
                    <span className={'text-sm font-medium text-grey-dark flex-1 text-right'}>Payment number</span>
                    <span className={'text-sm font-medium text-grey-dark w-[110px] shrink-0 text-right'}>Action</span>
                  </div>

                  <div className={'flex flex-col'}>
                    {isLoading ? (
                      Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className={'-mt-px'}>
                          <SkeletonRow />
                        </div>
                      ))
                    ) : !userId ? (
                      <div
                        className={
                          'py-12 text-center text-sm text-label-tertiary border-x border-b border-stroke-primary'
                        }
                      >
                        Log in to see your pools.
                      </div>
                    ) : paginatedRows.length === 0 ? (
                      <div
                        className={
                          'py-12 text-center text-sm text-label-tertiary border-x border-b border-stroke-primary'
                        }
                      >
                        No pools found.
                      </div>
                    ) : (
                      paginatedRows.map(({ row }) => (
                        <div key={row.id} className={'-mt-px'}>
                          <DebtRepaymentRow pool={row} onPay={handlePay} />
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Mobile cards */}
                <div className={'lg:hidden flex flex-col gap-3'}>
                  {isLoading ? (
                    Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)
                  ) : !userId ? (
                    <div className={'py-12 text-center text-sm text-label-tertiary'}>Log in to see your pools.</div>
                  ) : mobileRows.length === 0 ? (
                    <div className={'py-12 text-center text-sm text-label-tertiary'}>No pools found.</div>
                  ) : (
                    <>
                      {mobileRows.map(({ row }) => (
                        <DebtRepaymentCardMobile key={row.id} pool={row} onPay={handlePay} />
                      ))}
                      {mobileVisibleCount < filteredRows.length && (
                        <Button
                          visualType={'quinary'}
                          className={'w-full justify-center'}
                          onClick={() => setMobileVisibleCount(c => c + ROWS_PER_PAGE)}
                        >
                          Show more
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className={'max-lg:hidden'}>
                <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
              </div>
            </div>
          ) : (
            <div className={'flex flex-col gap-4'}>
              <div className={'max-lg:hidden'}>
                <Pagination page={historyPage} totalPages={historyTotalPages} onPageChange={setHistoryPage} />
              </div>

              <div className={'flex flex-col'}>
                <div
                  className={
                    'bg-bg-primary border border-stroke-primary rounded-t-lg flex justify-start px-3 py-4 relative z-10 ' +
                    'max-lg:bg-transparent max-lg:border-0 max-lg:rounded-none max-lg:px-0 max-lg:py-0'
                  }
                >
                  <Button visualType={'quinary'} onClick={() => setHistoryFilterOpen(prev => !prev)}>
                    <Icon name={'plus'} className={'size-3.5'} />
                    Filter
                    {historyActiveFilterCount > 0 && (
                      <span
                        className={
                          'bg-blue text-white rounded-full w-4 h-4 text-[10px] flex items-center justify-center leading-none'
                        }
                      >
                        {historyActiveFilterCount}
                      </span>
                    )}
                  </Button>
                  <WithdrawalFilterModal
                    open={historyFilterOpen}
                    onClose={() => setHistoryFilterOpen(false)}
                    categories={['Status', 'Period', 'Pool']}
                    activeCategory={historyActiveFilterCategory}
                    onCategoryChange={setHistoryActiveFilterCategory}
                    selections={historyFilterSelections}
                    onToggle={handleHistoryToggle}
                    categoryOptions={historyCategoryOptions}
                    periodRange={historyPeriodRange}
                    onPeriodRangeChange={setHistoryPeriodRange}
                  />
                </div>

                <div className={'max-lg:hidden'}>
                  <TransactionHistoryTable txs={paginatedHistory} isLoading={txLoading} />
                </div>
                <div className={'lg:hidden flex flex-col gap-3'}>
                  <TransactionHistoryTable txs={mobileHistory} isLoading={txLoading} />
                  {historyMobileVisibleCount < filteredHistoryTxs.length && (
                    <Button
                      visualType={'quinary'}
                      className={'w-full justify-center'}
                      onClick={() => setHistoryMobileVisibleCount(c => c + ROWS_PER_PAGE)}
                    >
                      Show more
                    </Button>
                  )}
                </div>
              </div>

              <div className={'max-lg:hidden'}>
                <Pagination page={historyPage} totalPages={historyTotalPages} onPageChange={setHistoryPage} />
              </div>
            </div>
          )}
        </Wrapper>
      </section>

      <DebtRepaymentDrawer pool={payTarget} onClose={() => setPayTarget(null)} onPaid={handlePaid} />
    </DashboardLayout>
  );
};

export default DebtRepaymentsPage;
