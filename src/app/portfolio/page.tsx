'use client';

import React, { FC, ReactNode, useMemo, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { formatUnits } from 'viem';
import { useAccount, useReadContracts } from 'wagmi';
import { useQuery } from '@apollo/client/react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { FreeMode } from 'swiper/modules';
import { DashboardLayout, Wrapper } from '@/components/layout';
import { Icon, Button, Pagination, Tooltip, toast } from '@/components/ui';
import {
  PortfolioDonutChart,
  PortfolioStatCard,
  PortfolioPoolRow,
  PortfolioPoolCardMobile,
  PortfolioFilterModal,
  PortfolioPayoutRow,
  PortfolioPayoutCardMobile,
  PortfolioPayoutDrawer,
} from '@/components/portfolio';
import type { PortfolioPool, DonutSegment, FilterCategory, PortfolioPayoutPool, PayoutTranche } from '@/components/portfolio';
import { WithdrawModal } from '@/components/withdrawals';
import {
  GET_BALANCES,
  GET_POOLS_FOR_PORTFOLIO,
  GET_POOL_TRANSACTIONS_FOR_PORTFOLIO,
  GET_BUSINESSES_FOR_PORTFOLIO,
  GET_COMPANIES_FOR_PORTFOLIO,
} from '@/lib/portfolio/operations';
import { getCollectedHold } from '@/lib/pool/collected';
import { POOL_ABI } from '@/lib/contracts';
import { sumClaimableIncome } from '@/lib/portfolio/claimable';
import type { TokenBalance, Pool, PoolTransaction, IncomingTranche } from '@/gql/graphql';

import 'swiper/css';
import 'swiper/css/free-mode';

type BusinessForPortfolio = {
  id: string;
  name: string;
  ownerId: string;
  ownerType: string;
  tags?: string[] | null;
  businessType?: string | null;
  country?: string | null;
  description?: string | null;
};

type CompanyForPortfolio = {
  id: string;
  name: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

type TabKey = 'all' | 'payouts';
type SortKey = 'pool' | 'rating' | 'amount' | 'share' | 'returned' | 'value' | 'profit' | 'status';
type PayoutSortKey = 'rating' | 'nextPayment' | 'profit' | 'paymentAmount' | 'totalAvailable';

const ROWS_PER_PAGE = 11;
const MOBILE_PAGE_SIZE = 3;

const STATUS_SORT_PRIORITY: Record<PortfolioPool['status'], number> = {
  collecting: 0,
  paying_out: 1,
  completed: 2,
  failed: 3,
};

const TABLE_COLS: { key: SortKey; label: string; width: string }[] = [
  { key: 'pool', label: 'Pool', width: 'w-[200px]' },
  { key: 'rating', label: 'AI Rating', width: 'flex-1' },
  { key: 'amount', label: 'Amount (USDT)', width: 'flex-1' },
  { key: 'share', label: 'Pool share', width: 'flex-1' },
  { key: 'returned', label: 'Returned (USDT)', width: 'flex-1' },
  { key: 'value', label: 'Current value (USDT)', width: 'flex-1' },
  { key: 'profit', label: 'Profit', width: 'flex-1' },
];

const PAYOUT_TABLE_COLS: { key: PayoutSortKey; label: string }[] = [
  { key: 'rating', label: 'AI Rating' },
  { key: 'nextPayment', label: 'Next payment' },
  { key: 'profit', label: 'Profit' },
  { key: 'paymentAmount', label: 'Payment amount (USDT)' },
  { key: 'totalAvailable', label: 'Total available (USDT)' },
];

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'All pools' },
  { key: 'payouts', label: 'Payouts' },
];

const TAB_TOOLTIPS: Partial<Record<TabKey, string>> = {
  all: 'Overview of all your projects and pools. Track pools progress, and see how much you’ve contributed and earned with each project.',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeFloat(v: string | null | undefined): number {
  if (!v) return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// HOLD (USDT) amounts are indexed as raw 18-decimal wei strings, unlike RWA
// amounts which are plain integers — see BuyTokenWidget/pool pages for the
// same convention.
function holdToNum(v: string | null | undefined): number {
  if (!v) return 0;
  try {
    return Number(formatUnits(BigInt(v), 18));
  } catch {
    return 0;
  }
}

function deriveStatus(pool: Pool): PortfolioPool['status'] {
  const now = Date.now() / 1000;
  if (pool.isFullyReturned) return 'completed';
  if (pool.isTargetReached) return 'paying_out';
  if (pool.entryPeriodExpired && now > pool.entryPeriodExpired) return 'failed';
  return 'collecting';
}

function fmtRewardPct(v: string | null | undefined): string {
  if (!v) return '';
  const n = parseFloat(v);
  if (isNaN(n)) return '';
  const pct = n > 100 ? n / 100 : n;
  return `${pct.toFixed(0)}%`;
}

function fmtStat(n: number, decimals = 2): string {
  if (!isFinite(n) || n === 0) return '0';
  const sign = n > 0 ? '+' : '';
  return sign + n.toLocaleString('en-US', { maximumFractionDigits: decimals });
}

// ── Derivation ────────────────────────────────────────────────────────────────

interface PoolDerivedData {
  pool: PortfolioPool;
  currentValue: number;
  realizedPNL: number;
  unrealizedPNL: number;
  totalInvested: number;
  status: PortfolioPool['status'];
  industry: string;
  poolType: 'Fixed' | 'Flexible';
  // country: string; // not available yet
  rewardPct: string;
  poolAddress: string;
  rwaAddress: string;
  virtualHoldReserve?: string | null;
  realHoldReserve?: string | null;
  virtualRwaReserve?: string | null;
  exitFeePercent?: string | null;
  incomingTranches: IncomingTranche[];
  lastCompletedIncomingTranche: number;
  businessDescription?: string | null;
  companyName: string;
  projectName: string;
}

function derivePortfolioData(
  balances: TokenBalance[],
  pools: Pool[],
  txns: PoolTransaction[],
  businesses: BusinessForPortfolio[],
  companies: CompanyForPortfolio[],
): {
  poolRows: PoolDerivedData[];
  industrySegments: DonutSegment[];
  projectSegments: DonutSegment[];
  totalContributed: number;
  realizedPNL: number;
  unrealizedPNL: number;
  avgROI: number;
  tradingEarnings: number;
  poolStats: { active: number; completed: number; failed: number };
} {
  const poolByAddress = new Map<string, Pool>();
  for (const p of pools) {
    if (p.poolAddress) poolByAddress.set(p.poolAddress.toLowerCase(), p);
  }

  const businessById = new Map<string, BusinessForPortfolio>();
  for (const b of businesses) {
    businessById.set(b.id, b);
  }

  const companyById = new Map<string, CompanyForPortfolio>();
  for (const c of companies) {
    companyById.set(c.id, c);
  }

  const txnsByPool = new Map<string, PoolTransaction[]>();
  for (const tx of txns) {
    const key = tx.poolAddress.toLowerCase();
    if (!txnsByPool.has(key)) txnsByPool.set(key, []);
    txnsByPool.get(key)!.push(tx);
  }

  let totalContributed = 0;
  let totalRealizedPNL = 0;
  let totalUnrealizedPNL = 0;
  let totalInvestedAll = 0;
  let tradingEarnings = 0;

  const industryMap = new Map<string, { value: number; count: number }>();
  const projectMap = new Map<string, { value: number; count: number }>();
  const poolStats = { active: 0, completed: 0, failed: 0 };

  const poolRows: PoolDerivedData[] = [];

  for (const tx of txns) {
    tradingEarnings += holdToNum(tx.bonusAmount);
  }

  for (const bal of balances) {
    const pool = poolByAddress.get(bal.poolAddress.toLowerCase());
    if (!pool) continue;

    const vHold = holdToNum(pool.virtualHoldReserve);
    const vRwa = safeFloat(pool.virtualRwaReserve);
    const price = vRwa > 0 ? vHold / vRwa : 0;
    const currentValue = bal.balance * price;

    const awaitingRwa = safeFloat(pool.awaitingRwaAmount);
    const poolSharePct = awaitingRwa > 0 ? (bal.balance / awaitingRwa) * 100 : 0;

    const poolTxns = txnsByPool.get(bal.poolAddress.toLowerCase()) ?? [];
    const mintTxns = poolTxns.filter(t => t.transactionType === 'MINT');
    const burnTxns = poolTxns.filter(t => t.transactionType === 'BURN');

    const totalBuyHold = mintTxns.reduce((s, t) => s + holdToNum(t.holdAmount), 0);
    const totalSellHold = burnTxns.reduce((s, t) => s + holdToNum(t.holdAmount), 0);
    const totalBuyRwa = mintTxns.reduce((s, t) => s + safeFloat(t.rwaAmount), 0);
    const avgBuyPrice = totalBuyRwa > 0 ? totalBuyHold / totalBuyRwa : price;

    const realizedPNL = totalSellHold - burnTxns.reduce((s, t) => s + safeFloat(t.rwaAmount), 0) * avgBuyPrice;
    const unrealizedPNL = currentValue - bal.balance * avgBuyPrice;

    const profitNum = totalBuyHold > 0
      ? ((currentValue + totalSellHold - totalBuyHold) / totalBuyHold) * 100
      : 0;
    const profitStr = totalBuyHold > 0 ? `${profitNum >= 0 ? '+' : ''}${profitNum.toFixed(1)}%` : '—';

    const status = deriveStatus(pool);
    const collected = holdToNum(getCollectedHold(pool));
    const goal = holdToNum(pool.expectedHoldAmount);

    const business = pool.businessId ? businessById.get(pool.businessId) : undefined;
    const industry = pool.tags?.[0] ?? business?.tags?.[0] ?? 'Other';

    poolRows.push({
      pool: {
        id: pool.id,
        name: pool.name,
        aiRating: pool.riskScore ?? 0,
        amount: totalBuyHold,
        poolShare: `${poolSharePct.toFixed(1)}%`,
        returned: totalSellHold,
        currentValue,
        profit: profitStr,
        status,
        collected,
        goal,
      },
      currentValue,
      realizedPNL,
      unrealizedPNL,
      totalInvested: totalBuyHold,
      status,
      industry,
      poolType: pool.fixedSell ? 'Fixed' : 'Flexible',
      // country: business?.country ?? '', // not available yet
      rewardPct: fmtRewardPct(pool.rewardPercent),
      poolAddress: pool.poolAddress ?? '',
      rwaAddress: pool.rwaAddress,
      virtualHoldReserve: pool.virtualHoldReserve,
      realHoldReserve: pool.realHoldReserve,
      virtualRwaReserve: pool.virtualRwaReserve,
      exitFeePercent: pool.exitFeePercent,
      incomingTranches: pool.incomingTranches ?? [],
      lastCompletedIncomingTranche: pool.lastCompletedIncomingTranche ?? 0,
      businessDescription: business?.description,
      companyName: business?.ownerType === 'company' ? companyById.get(business.ownerId)?.name ?? '—' : '—',
      projectName: business?.name ?? '—',
    });

    totalContributed += currentValue;
    totalRealizedPNL += realizedPNL;
    totalUnrealizedPNL += unrealizedPNL;
    totalInvestedAll += totalBuyHold;

    if (status === 'completed') poolStats.completed++;
    else if (status === 'failed') poolStats.failed++;
    else poolStats.active++;

    // Donut — industry
    const ind = industryMap.get(industry) ?? { value: 0, count: 0 };
    industryMap.set(industry, { value: ind.value + currentValue, count: ind.count + 1 });

    // Donut — project
    const proj = projectMap.get(pool.name) ?? { value: 0, count: 0 };
    projectMap.set(pool.name, { value: proj.value + currentValue, count: proj.count + 1 });
  }

  const avgROI = totalInvestedAll > 0
    ? ((totalRealizedPNL + totalUnrealizedPNL) / totalInvestedAll) * 100
    : 0;

  const industrySegments: DonutSegment[] = Array.from(industryMap.entries()).map(([label, d]) => ({
    label,
    value: Math.round(d.value),
    poolCount: d.count,
  }));

  const projectSegments: DonutSegment[] = Array.from(projectMap.entries()).map(([label, d]) => ({
    label,
    value: Math.round(d.value),
    poolCount: d.count,
  }));

  return {
    poolRows,
    industrySegments,
    projectSegments,
    totalContributed,
    realizedPNL: totalRealizedPNL,
    unrealizedPNL: totalUnrealizedPNL,
    avgROI,
    tradingEarnings,
    poolStats,
  };
}

// Shared by both tabs — the same rating/type/pool/industry/ROI filters apply
// regardless of which columns are on screen.
function applyRowFilters(rows: PoolDerivedData[], filterSelections: Record<string, string[]>): PoolDerivedData[] {
  let result = rows;

  const statusSel = filterSelections['Status'] ?? [];
  if (statusSel.length > 0) {
    const statusMap: Record<string, string> = {
      'Collecting': 'collecting',
      'Pays out': 'paying_out',
      'Completed': 'completed',
      'Failed': 'failed',
    };
    result = result.filter(r => statusSel.some(s => statusMap[s] === r.status));
  }

  const ratingSel = filterSelections['AI-Rating'] ?? [];
  if (ratingSel.length > 0) {
    result = result.filter(r => ratingSel.some(s => {
      const score = r.pool.aiRating;
      if (s === '80 — 100') return score >= 80;
      if (s === '40 — 79') return score >= 40 && score < 80;
      return score < 40; // '0 — 39'
    }));
  }

  const typeSel = filterSelections['Type'] ?? [];
  if (typeSel.length > 0) {
    result = result.filter(r => typeSel.includes(r.poolType));
  }

  const poolsSel = filterSelections['Pools'] ?? [];
  if (poolsSel.length > 0) {
    result = result.filter(r => poolsSel.includes(r.pool.name));
  }

  const industrySel = filterSelections['Industry'] ?? [];
  if (industrySel.length > 0) {
    result = result.filter(r => industrySel.includes(r.industry));
  }

  const roiSel = filterSelections['Planned ROI'] ?? [];
  if (roiSel.length > 0) {
    result = result.filter(r => roiSel.includes(r.rewardPct));
  }

  return result;
}

// Per-user share of a pool's tranche payments — same "contribution ÷ goal"
// convention already used for poolSharePct in derivePortfolioData.
function derivePayoutRow(row: PoolDerivedData): { pool: PortfolioPayoutPool; tranches: PayoutTranche[] } {
  const now = Date.now() / 1000;
  const incoming = row.incomingTranches;
  const completed = row.lastCompletedIncomingTranche;
  const total = incoming.length;
  const nextTranche = completed < total ? incoming[completed] : undefined;
  const sharePct = row.pool.goal > 0 ? row.totalInvested / row.pool.goal : 0;

  const tranches: PayoutTranche[] = incoming.map((t, i) => ({
    amount: holdToNum(t.amount) * sharePct,
    date: t.expiredAt,
    completed: i < completed,
  }));

  const pool: PortfolioPayoutPool = {
    id: row.pool.id,
    poolAddress: row.poolAddress,
    rwaAddress: row.rwaAddress,
    name: row.pool.name,
    aiRating: row.pool.aiRating,
    nextPaymentDate: nextTranche ? nextTranche.expiredAt : null,
    nextPaymentIsOverdue: !!nextTranche && nextTranche.expiredAt < now,
    completedTranches: completed,
    totalTranches: total,
    profitPct: row.rewardPct || '—',
    paymentAmount: nextTranche ? holdToNum(nextTranche.amount) * sharePct : null,
    totalAvailable: row.currentValue,
    claimable: row.currentValue > 0,
    description: row.businessDescription,
    companyName: row.companyName,
    projectName: row.projectName,
    virtualHoldReserve: row.virtualHoldReserve,
    realHoldReserve: row.realHoldReserve,
    virtualRwaReserve: row.virtualRwaReserve,
    exitFeePercent: row.exitFeePercent,
  };

  return { pool, tranches };
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

const SkeletonRow = () => (
  <div className="bg-bg-primary border border-stroke-primary h-[52px] animate-pulse bg-bg-tertiary/40" />
);

// ── Component ─────────────────────────────────────────────────────────────────

const Portfolio: FC = () => {
  const { address } = useAccount();

  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [chartFilter, setChartFilter] = useState<'industry' | 'projects' | 'countries'>('industry');
  const [sortKey, setSortKey] = useState<SortKey | null>('status');
  const [sortAsc, setSortAsc] = useState(true);
  const [payoutSortKey, setPayoutSortKey] = useState<PayoutSortKey | null>(null);
  const [payoutSortAsc, setPayoutSortAsc] = useState(true);
  const [claimTarget, setClaimTarget] = useState<PortfolioPayoutPool | null>(null);
  const [payoutDetailId, setPayoutDetailId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [mobileVisibleCount, setMobileVisibleCount] = useState(MOBILE_PAGE_SIZE);
  // Desktop and mobile each mount their own trigger + <PortfolioFilterModal>
  // (CSS hidden/md:flex only toggles visibility, it doesn't unmount the other
  // one) — so open/active-category state must stay separate per instance, or
  // the hidden instance's outside-click listener closes the visible one via
  // the shared setter. Selections stay shared; only the two are independent.
  const [filterOpen, setFilterOpen] = useState(false);
  const [activeFilterCategory, setActiveFilterCategory] = useState<FilterCategory>('AI-Rating');
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [mobileActiveFilterCategory, setMobileActiveFilterCategory] = useState<FilterCategory>('AI-Rating');
  const [filterSelections, setFilterSelections] = useState<Record<string, string[]>>({});

  // owner/userAddress are stored checksummed on the backend (straight from
  // decoded blockchain events) — do not lowercase, or the exact-matchс filter
  // silently returns nothing.
  const wallet = address ?? '';

  // Query 1: user's token balances
  const { data: balancesData, loading: balancesLoading } = useQuery(GET_BALANCES, {
    variables: { input: { filter: { owner: wallet } } },
    skip: !wallet,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const balances: TokenBalance[] = (balancesData as any)?.getBalances ?? [];
  const poolAddresses = useMemo(() => balances.map(b => b.poolAddress), [balances]);

  // Query 2: pool metadata for those addresses (fires after balances resolve)
  const { data: poolsData, loading: poolsLoading } = useQuery(GET_POOLS_FOR_PORTFOLIO, {
    variables: { input: { filter: { poolAddress: { $in: poolAddresses } } } },
    skip: !wallet || poolAddresses.length === 0,
  });

  // Query 3: user's trading transactions (parallel with query 1)
  const { data: txnsData, loading: txnsLoading } = useQuery(GET_POOL_TRANSACTIONS_FOR_PORTFOLIO, {
    variables: { input: { filter: { userAddress: wallet } } },
    skip: !wallet,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pools: Pool[] = (poolsData as any)?.getPools ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const txns: PoolTransaction[] = (txnsData as any)?.getPoolTransactions ?? [];

  const businessIds = useMemo(() => [...new Set(pools.map(p => p.businessId).filter(Boolean))], [pools]);

  // Query 4: business metadata for category fallback (fires after pools resolve)
  const { data: businessesData } = useQuery(GET_BUSINESSES_FOR_PORTFOLIO, {
    variables: { input: { filter: { _id: { $in: businessIds } } } },
    skip: businessIds.length === 0,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const businesses: BusinessForPortfolio[] = (businessesData as any)?.getBusinesses ?? [];

  const companyIds = useMemo(
    () => [...new Set(businesses.filter(b => b.ownerType === 'company').map(b => b.ownerId).filter(Boolean))],
    [businesses]
  );

  // Query 5: company metadata for pools owned via a company (fires after businesses resolve)
  const { data: companiesData } = useQuery(GET_COMPANIES_FOR_PORTFOLIO, {
    variables: { input: { filter: { _id: { $in: companyIds } } } },
    skip: companyIds.length === 0,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const companies: CompanyForPortfolio[] = (companiesData as any)?.getCompanies ?? [];

  console.log('[Portfolio] wallet:', wallet);
  console.log('[Portfolio] balancesData:', balancesData, '| loading:', balancesLoading);
  console.log('[Portfolio] poolAddresses:', poolAddresses);
  console.log('[Portfolio] poolsData:', poolsData, '| loading:', poolsLoading);
  console.log('[Portfolio] txnsData:', txnsData, '| loading:', txnsLoading);

  const isLoading = balancesLoading || poolsLoading || txnsLoading;

  // Derive everything
  const derived = useMemo(
    () => derivePortfolioData(balances, pools, txns, businesses, companies),
    [balances, pools, txns, businesses, companies],
  );

  // Claimable amount = the income the pools would pay out for the user's positions right now (net of fees),
  // read from the contracts — not the value of the invested funds
  const burnQuoteCalls = useMemo(
    () =>
      balances
        .filter(b => b.poolAddress && Number.isFinite(b.balance) && b.balance >= 1)
        .map(b => ({
          address: b.poolAddress as `0x${string}`,
          abi: POOL_ABI,
          functionName: 'estimateBurn' as const,
          args: [BigInt(Math.floor(b.balance))] as const,
        })),
    [balances],
  );
  const { data: burnQuotes } = useReadContracts({
    contracts: burnQuoteCalls,
    query: { enabled: burnQuoteCalls.length > 0 },
  });
  const claimableIncome = useMemo(() => sumClaimableIncome(burnQuotes), [burnQuotes]);

  const categoryOptions = useMemo<Partial<Record<FilterCategory, string[]>>>(() => ({
    'AI-Rating': ['80 — 100', '40 — 79', '0 — 39'],
    'Type': ['Fixed', 'Flexible'],
    'Status': ['Collecting', 'Pays out', 'Completed', 'Failed'],
    'Pools': [...new Set(derived.poolRows.map(r => r.pool.name))],
    'Industry': derived.industrySegments.map(s => s.label).filter(l => l !== 'Other'),
    // 'Country': [...new Set(derived.poolRows.map(r => r.country).filter(Boolean))], // not available yet
    'Planned ROI': [...new Set(derived.poolRows.map(r => r.rewardPct).filter(Boolean))].sort(),
  }), [derived.poolRows]);

  const activeFilterCount = useMemo(
    () => Object.values(filterSelections).filter(v => v.length > 0).length,
    [filterSelections],
  );

  const handleToggle = (category: FilterCategory, value: string) => {
    if (value === '__all__') {
      setFilterSelections(prev => ({ ...prev, [category]: [] }));
      return;
    }
    setFilterSelections(prev => {
      const current = prev[category] ?? [];
      const next = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value];
      return { ...prev, [category]: next };
    });
  };

  // Tab + modal filter
  const tabFiltered = useMemo(() => {
    const rows = activeTab === 'payouts'
      ? derived.poolRows.filter(r => r.status === 'paying_out')
      : derived.poolRows;
    return applyRowFilters(rows, filterSelections);
  }, [derived.poolRows, activeTab, filterSelections]);

  // Payouts tab — same eligible pools as tabFiltered, mapped to schedule/claim data
  const payoutRows = useMemo(() => {
    const eligible = applyRowFilters(derived.poolRows.filter(r => r.status === 'paying_out'), filterSelections);
    return eligible.map(derivePayoutRow);
  }, [derived.poolRows, filterSelections]);

  const payoutDetail = useMemo(
    () => payoutRows.find(r => r.pool.id === payoutDetailId) ?? null,
    [payoutRows, payoutDetailId]
  );

  const payoutSorted = useMemo(() => {
    if (!payoutSortKey) return payoutRows;
    const rows = [...payoutRows];
    rows.sort((a, b) => {
      let av = 0, bv = 0;
      switch (payoutSortKey) {
        case 'rating':        av = a.pool.aiRating; bv = b.pool.aiRating; break;
        case 'nextPayment':   av = a.pool.nextPaymentDate ?? Infinity; bv = b.pool.nextPaymentDate ?? Infinity; break;
        case 'profit':        av = parseFloat(a.pool.profitPct) || 0; bv = parseFloat(b.pool.profitPct) || 0; break;
        case 'paymentAmount': av = a.pool.paymentAmount ?? 0; bv = b.pool.paymentAmount ?? 0; break;
        case 'totalAvailable':av = a.pool.totalAvailable; bv = b.pool.totalAvailable; break;
      }
      return payoutSortAsc ? av - bv : bv - av;
    });
    return rows;
  }, [payoutRows, payoutSortKey, payoutSortAsc]);

  // Sort
  const sorted = useMemo(() => {
    if (!sortKey) {
      return [...tabFiltered].sort(
        (a, b) => STATUS_SORT_PRIORITY[a.status] - STATUS_SORT_PRIORITY[b.status]
      );
    }
    const rows = [...tabFiltered];
    rows.sort((a, b) => {
      let av = 0, bv = 0;
      switch (sortKey) {
        case 'pool':     av = a.pool.name.localeCompare(b.pool.name); return sortAsc ? av : -av;
        case 'rating':   av = a.pool.aiRating; bv = b.pool.aiRating; break;
        case 'amount':   av = a.pool.amount; bv = b.pool.amount; break;
        case 'share':    av = parseFloat(a.pool.poolShare); bv = parseFloat(b.pool.poolShare); break;
        case 'returned': av = a.pool.returned; bv = b.pool.returned; break;
        case 'value':    av = a.currentValue; bv = b.currentValue; break;
        case 'profit':   av = a.pool.amount > 0 ? (a.currentValue + a.pool.returned - a.pool.amount) / a.pool.amount : 0;
                         bv = b.pool.amount > 0 ? (b.currentValue + b.pool.returned - b.pool.amount) / b.pool.amount : 0; break;
        case 'status':   av = STATUS_SORT_PRIORITY[a.status]; bv = STATUS_SORT_PRIORITY[b.status]; break;
      }
      return sortAsc ? av - bv : bv - av;
    });
    return rows;
  }, [tabFiltered, sortKey, sortAsc]);

  const activeRowCount = activeTab === 'payouts' ? payoutSorted.length : sorted.length;
  const totalPages = Math.max(1, Math.ceil(activeRowCount / ROWS_PER_PAGE));
  const paginated = sorted.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE);
  const mobilePaginated = sorted.slice(0, mobileVisibleCount);
  const paginatedPayouts = payoutSorted.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE);
  const mobilePayouts = payoutSorted.slice(0, mobileVisibleCount);

  const chartView = useMemo(() => {
    const filter = chartFilter as 'industry' | 'projects';
    const segments = filter === 'projects' ? derived.projectSegments : derived.industrySegments;
    const total = segments.reduce((s, seg) => s + seg.value, 0);
    const uniqueLabels = segments.length;
    const label = filter === 'projects' ? 'projects' : 'industries';
    return {
      totalUsdt: Math.round(total).toLocaleString('en-US'),
      subtitle: `${uniqueLabels} ${label} · ${derived.poolRows.length} pools`,
      segments,
    };
  }, [chartFilter, derived]);

  const statCards: { value: string; sublabel?: string; label: string; tooltip: string; icon: ReactNode }[] = [
    {
      value: fmtStat(derived.realizedPNL),
      sublabel: 'REALIZED',
      label: 'PNL, USDT',
      tooltip: 'The current profit or loss from positions you hold.',
      icon: <Icon name="tickSquared" className="size-5 text-black" />,
    },
    {
      value: fmtStat(derived.unrealizedPNL),
      sublabel: 'UNREALIZED',
      label: 'PNL, USDT',
      tooltip: 'The current profit or loss from positions you hold.',
      icon: <Icon name="chartSquared" className="size-5 text-black" />,
    },
    {
      value: `${fmtStat(derived.avgROI, 1)}%`,
      label: 'AVERAGE ROI',
      tooltip: 'Projected return based on target pool profitability, assuming full repayment.',
      icon: <Icon name="percent" className="size-5 text-black" />,
    },
    {
      value: '—',
      label: 'AIRDROP POINTS',
      tooltip: 'Get points for selling, staking PLTs and sharing a referral link. Get one governance token (GOV) for each point.',
      icon: <Icon name="gift" className="size-5 text-black" />,
    },
    {
      value: fmtStat(derived.tradingEarnings),
      label: 'TRADING EARNINGS, USDT',
      tooltip: 'Your earnings from fees when other users buy or sell tokens in the pools you’ve invested in.',
      icon: <Icon name="flash" className="size-5 text-black" />,
    },
    {
      value: fmtStat(claimableIncome),
      label: 'CLAIMABLE AMOUNT, USDT',
      tooltip: 'The income from repayments that you can claim right now, after fees. The funds you invested are not included.',
      icon: <Icon name="wallet" className="size-5 text-black" />,
    },
  ];

  const handleSort = (key: SortKey) => {
    if (sortKey !== key) { setSortKey(key); setSortAsc(true); }
    else if (sortAsc) setSortAsc(false);
    else setSortKey(null);
    setPage(1);
    setMobileVisibleCount(MOBILE_PAGE_SIZE);
  };

  const handlePayoutSort = (key: PayoutSortKey) => {
    if (payoutSortKey !== key) { setPayoutSortKey(key); setPayoutSortAsc(true); }
    else if (payoutSortAsc) setPayoutSortAsc(false);
    else setPayoutSortKey(null);
    setPage(1);
    setMobileVisibleCount(MOBILE_PAGE_SIZE);
  };

  const handleClaimed = () => {
    toast('Refresh the page to see your updated balance.');
  };

  const claimModalPool = claimTarget ? {
    id: claimTarget.id,
    poolAddress: claimTarget.poolAddress,
    rwaAddress: claimTarget.rwaAddress,
    name: claimTarget.name,
    companyName: claimTarget.companyName,
    projectName: claimTarget.projectName,
    collected: 0,
    goal: 0,
    status: 'ready_to_withdraw' as const,
    virtualHoldReserve: claimTarget.virtualHoldReserve,
    realHoldReserve: claimTarget.realHoldReserve,
    virtualRwaReserve: claimTarget.virtualRwaReserve,
    exitFeePercent: claimTarget.exitFeePercent,
  } : null;

  return (
    <DashboardLayout>
      <section className="py-8 md:py-12">
        <Wrapper>
          {/* ── Page title ── */}
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-2xl md:text-[36px] font-semibold leading-[1.2] text-black">Portfolio</h1>
            <Link href="/marketplace" className="hidden md:block">
              <Button visualType="quaternary" className="flex items-center gap-2 h-[46px] rounded-xl">
                <Icon name="plus" className="size-3.5" />
                New investment
              </Button>
            </Link>
          </div>

          {/* ── Tabs ── */}
          <div className="flex gap-4 border-b border-stroke-primary mb-6">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => { setActiveTab(tab.key); setPage(1); setMobileVisibleCount(MOBILE_PAGE_SIZE); }}
                className={clsx(
                  'flex flex-col gap-3 pb-0 text-base font-medium tr-d-all',
                  activeTab === tab.key ? 'text-black' : 'text-label-tertiary'
                )}
              >
                <span className="flex items-center gap-1">
                  {tab.label}
                  {TAB_TOOLTIPS[tab.key] && (
                    <Tooltip content={TAB_TOOLTIPS[tab.key]!}>
                      <Icon name="info" className="size-4 text-grey" />
                    </Tooltip>
                  )}
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

          {/* ── Main two-column layout (All pools tab only) ── */}
          {activeTab === 'all' && (
            <div className="flex flex-col md:flex-row gap-2.5 mb-6">
              {/* Left – Donut chart */}
              <div className="w-full md:flex-[1_0_0] min-w-0">
                <PortfolioDonutChart
                  key={chartFilter}
                  totalUsdt={chartView.totalUsdt}
                  subtitle={chartView.subtitle}
                  segments={chartView.segments}
                  activeFilter={chartFilter}
                  onFilterChange={setChartFilter}
                  poolStats={derived.poolStats}
                />
              </div>

              {/* Right – Stats: swiper on mobile, 2-col grid on desktop */}
              <div className="w-full md:flex-[1_0_0] min-w-0">
                <Swiper
                  className="md:!hidden !overflow-visible"
                  modules={[FreeMode]}
                  freeMode
                  spaceBetween={10}
                  slidesPerView="auto"
                >
                  {statCards.map((card, i) => (
                    <SwiperSlide key={i} className="!w-[250px]">
                      <PortfolioStatCard {...card} />
                    </SwiperSlide>
                  ))}
                </Swiper>

                <div className="hidden md:grid md:grid-cols-2 md:gap-2.5">
                  {statCards.map((card, i) => (
                    <PortfolioStatCard key={i} {...card} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Table section (desktop) ── */}
          <div className="hidden md:flex flex-col gap-4">
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />

            <div className="flex flex-col">
              {/* Filter row — outside overflow-hidden so dropdown can escape */}
              <div className="bg-bg-primary border border-stroke-primary rounded-t-lg flex justify-start px-3 py-4 relative z-10">
                <Button
                  visualType="quinary"
                  onClick={() => setFilterOpen(prev => !prev)}
                >
                  <Icon name="plus" className="size-3.5" />
                  Filter
                  {activeFilterCount > 0 && (
                    <span className="bg-blue text-white rounded-full w-4 h-4 text-[10px] flex items-center justify-center leading-none">
                      {activeFilterCount}
                    </span>
                  )}
                </Button>
                <PortfolioFilterModal
                  open={filterOpen}
                  onClose={() => setFilterOpen(false)}
                  activeCategory={activeFilterCategory}
                  onCategoryChange={setActiveFilterCategory}
                  selections={filterSelections}
                  onToggle={handleToggle}
                  categoryOptions={categoryOptions}
                />
              </div>

              <div className="overflow-hidden rounded-b-lg">
              {activeTab === 'payouts' ? (
                <>
                  {/* Header */}
                  <div className="bg-bg-primary border-x border-b border-stroke-primary h-[52px] flex items-center px-3 gap-2">
                    <div className="w-[200px] shrink-0 text-sm font-medium text-grey-dark">Pool</div>
                    {PAYOUT_TABLE_COLS.map(col => (
                      <button
                        key={col.key}
                        onClick={() => handlePayoutSort(col.key)}
                        className="flex items-center justify-end gap-1 flex-1 text-sm font-medium text-grey-dark tr-d-all hover:text-black whitespace-nowrap"
                      >
                        {col.label}
                        <span className="flex items-center shrink-0">
                          <Icon
                            name="arrowUp"
                            className={clsx('size-3.5', payoutSortKey === col.key && payoutSortAsc ? 'text-blue' : 'text-grey')}
                          />
                          <Icon
                            name="arrowDown"
                            className={clsx('size-3.5 -ml-1.5', payoutSortKey === col.key && !payoutSortAsc ? 'text-blue' : 'text-grey')}
                          />
                        </span>
                      </button>
                    ))}
                    <div className="w-[110px] shrink-0 text-sm font-medium text-grey-dark text-right">Action</div>
                  </div>

                  {/* Rows */}
                  <div className="flex flex-col">
                    {isLoading ? (
                      Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="-mt-px"><SkeletonRow /></div>
                      ))
                    ) : paginatedPayouts.length === 0 ? (
                      <div className="flex flex-col items-center justify-center gap-4 py-24 px-4 border-x border-b border-stroke-primary text-center">
                        <Icon name="document" className="size-16" />
                        <div className="flex flex-col items-center gap-2 max-w-[311px]">
                          <p className="text-xl font-semibold text-grey-dark">Nothing here yet</p>
                          <p className="text-sm font-medium leading-[1.2] text-grey-dark">
                            No pools are currently paying out. Once one starts repaying, it&rsquo;ll show up here.
                          </p>
                        </div>
                      </div>
                    ) : (
                      paginatedPayouts.map(({ pool }) => (
                        <div key={pool.id} className="-mt-px">
                          <PortfolioPayoutRow pool={pool} onClaim={setClaimTarget} onOpenDetail={p => setPayoutDetailId(p.id)} />
                        </div>
                      ))
                    )}
                  </div>
                </>
              ) : (
                <>
                  {/* Header */}
                  <div className="bg-bg-primary border-x border-b border-stroke-primary h-[52px] flex items-center px-3 gap-2">
                    {TABLE_COLS.map(col => (
                      <button
                        key={col.key}
                        onClick={() => handleSort(col.key)}
                        className={clsx(
                          'flex items-center gap-1 text-sm font-medium text-grey-dark tr-d-all hover:text-black whitespace-nowrap',
                          col.width,
                          col.key === 'pool' ? 'shrink-0 justify-start' : 'justify-end'
                        )}
                      >
                        {col.label}
                        <span className="flex items-center shrink-0">
                          <Icon
                            name="arrowUp"
                            className={clsx(
                              'size-3.5',
                              sortKey === col.key && sortAsc ? 'text-blue' : 'text-grey'
                            )}
                          />
                          <Icon
                            name="arrowDown"
                            className={clsx(
                              'size-3.5 -ml-1.5',
                              sortKey === col.key && !sortAsc ? 'text-blue' : 'text-grey'
                            )}
                          />
                        </span>
                      </button>
                    ))}
                    <button
                      onClick={() => handleSort('status')}
                      className="flex items-center justify-end gap-1 w-[110px] shrink-0 text-sm font-medium text-grey-dark tr-d-all hover:text-black"
                    >
                      Status
                      <span className="flex items-center shrink-0">
                        <Icon
                          name="arrowUp"
                          className={clsx(
                            'size-3.5',
                            sortKey === 'status' && sortAsc ? 'text-blue' : 'text-grey'
                          )}
                        />
                        <Icon
                          name="arrowDown"
                          className={clsx(
                            'size-3.5 -ml-1.5',
                            sortKey === 'status' && !sortAsc ? 'text-blue' : 'text-grey'
                          )}
                        />
                      </span>
                    </button>
                    <div className="w-[213px] shrink-0 text-sm font-medium text-grey-dark text-right">Collected</div>
                  </div>

                  {/* Rows */}
                  <div className="flex flex-col">
                    {isLoading ? (
                      Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="-mt-px"><SkeletonRow /></div>
                      ))
                    ) : paginated.length === 0 && derived.poolRows.length === 0 ? (
                      <div className="flex flex-col items-center justify-center gap-4 py-24 px-4 border-x border-b border-stroke-primary text-center">
                        <Icon name="document" className="size-16" />
                        <div className="flex flex-col items-center gap-2 max-w-[311px]">
                          <p className="text-xl font-semibold text-grey-dark">Nothing here yet</p>
                          <p className="text-sm font-medium leading-[1.2] text-grey-dark">
                            You haven&rsquo;t bought any tokens yet. Head to the marketplace and choose a project you like
                          </p>
                        </div>
                        <Link href="/marketplace">
                          <Button visualType="quaternary" className="rounded-lg">
                            Go to Marketplace
                          </Button>
                        </Link>
                      </div>
                    ) : paginated.length === 0 ? (
                      <div className="py-12 text-center text-sm text-label-tertiary border-x border-b border-stroke-primary">
                        No pools found.
                      </div>
                    ) : (
                      paginated.map(({ pool }) => (
                        <div key={pool.id} className="-mt-px">
                          <PortfolioPoolRow pool={pool} />
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
              </div>{/* end overflow-hidden */}
            </div>

            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>

          {/* ── Pools section (mobile) ── */}
          <div className="flex md:hidden flex-col gap-6">
            <div className="flex flex-col gap-4">
              <p className="text-2xl font-semibold leading-none text-black">Invested pools</p>
              <div className="flex gap-1">
                <button
                  onClick={() => handleSort(sortKey ?? 'status')}
                  className="flex items-center justify-center gap-2 p-3 rounded-lg border border-stroke-primary tr-d-all hover:bg-bg-tertiary"
                >
                  <span className="flex items-center shrink-0">
                    <Icon
                      name="arrowUp"
                      className={clsx('size-3.5', sortAsc ? 'text-blue' : 'text-grey')}
                    />
                    <Icon
                      name="arrowDown"
                      className={clsx('size-3.5 -ml-1.5', !sortAsc ? 'text-blue' : 'text-grey')}
                    />
                  </span>
                </button>
                <div className="relative">
                  <Button visualType="quinary" onClick={() => setMobileFilterOpen(prev => !prev)}>
                    <Icon name="plus" className="size-3.5" />
                    Filter
                    {activeFilterCount > 0 && (
                      <span className="bg-blue text-white rounded-full w-4 h-4 text-[10px] flex items-center justify-center leading-none">
                        {activeFilterCount}
                      </span>
                    )}
                  </Button>
                  <PortfolioFilterModal
                    open={mobileFilterOpen}
                    onClose={() => setMobileFilterOpen(false)}
                    activeCategory={mobileActiveFilterCategory}
                    onCategoryChange={setMobileActiveFilterCategory}
                    selections={filterSelections}
                    onToggle={handleToggle}
                    categoryOptions={categoryOptions}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              {isLoading ? (
                Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="h-[280px] rounded-xl animate-pulse bg-bg-tertiary/40" />
                ))
              ) : activeTab === 'payouts' ? (
                mobilePayouts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-4 py-16 px-4 text-center">
                    <Icon name="document" className="size-16" />
                    <div className="flex flex-col items-center gap-2 max-w-[311px]">
                      <p className="text-xl font-semibold text-grey-dark">Nothing here yet</p>
                      <p className="text-sm font-medium leading-[1.2] text-grey-dark">
                        No pools are currently paying out. Once one starts repaying, it&rsquo;ll show up here.
                      </p>
                    </div>
                  </div>
                ) : (
                  mobilePayouts.map(({ pool }) => (
                    <PortfolioPayoutCardMobile
                      key={pool.id}
                      pool={pool}
                      onClaim={setClaimTarget}
                      onOpenDetail={p => setPayoutDetailId(p.id)}
                    />
                  ))
                )
              ) : mobilePaginated.length === 0 && derived.poolRows.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-4 py-16 px-4 text-center">
                  <Icon name="document" className="size-16" />
                  <div className="flex flex-col items-center gap-2 max-w-[311px]">
                    <p className="text-xl font-semibold text-grey-dark">Nothing here yet</p>
                    <p className="text-sm font-medium leading-[1.2] text-grey-dark">
                      You haven&rsquo;t bought any tokens yet. Head to the marketplace and choose a project you like
                    </p>
                  </div>
                  <Link href="/marketplace">
                    <Button visualType="quaternary" className="rounded-lg">
                      Go to Marketplace
                    </Button>
                  </Link>
                </div>
              ) : mobilePaginated.length === 0 ? (
                <div className="py-12 text-center text-sm text-label-tertiary">No pools found.</div>
              ) : (
                mobilePaginated.map(({ pool }) => <PortfolioPoolCardMobile key={pool.id} pool={pool} />)
              )}
            </div>

            {activeTab === 'payouts'
              ? mobilePayouts.length < payoutSorted.length && (
                  <Button
                    visualType="quinary"
                    className="w-full justify-center"
                    onClick={() => setMobileVisibleCount(c => c + MOBILE_PAGE_SIZE)}
                  >
                    Show more
                  </Button>
                )
              : mobilePaginated.length < sorted.length && (
                  <Button
                    visualType="quinary"
                    className="w-full justify-center"
                    onClick={() => setMobileVisibleCount(c => c + MOBILE_PAGE_SIZE)}
                  >
                    Show more
                  </Button>
                )}
          </div>
        </Wrapper>
      </section>

      <PortfolioPayoutDrawer
        pool={payoutDetail?.pool ?? null}
        tranches={payoutDetail?.tranches ?? []}
        onClose={() => setPayoutDetailId(null)}
        onClaim={p => { setClaimTarget(p); setPayoutDetailId(null); }}
      />
      <WithdrawModal pool={claimModalPool} onClose={() => setClaimTarget(null)} onWithdrawn={handleClaimed} />
    </DashboardLayout>
  );
};

export default Portfolio;
