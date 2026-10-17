'use client';

import React, { FC, useState, useRef, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { DashboardLayout, Wrapper } from '@/components/layout';
import { Button, Title, toast } from '@/components/ui';
import { Calendar, ConfirmModal } from '@/components/common';
import { useMutation, useQuery } from '@apollo/client/react';
import Link from 'next/link';
import { GET_BUSINESS_DEPLOY_INFO } from '@/lib/business/operations';
import { useAccount } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import clsx from 'clsx';
import { CREATE_POOL } from '@/lib/pool/operations';

// ── Constants ──────────────────────────────────────────────────────────────────
const TIMING_OPTIONS = Array.from({ length: 67 }, (_, i) => `${(i + 1) * 5} days`); // max 335 days: completionPeriod = timing + 30 ≤ 365
const COMMISSION_RATE = 0.03;
const MAX_TRANCHES = 20;
const PRICE_IMPACT_PERCENT = BigInt(101); // 100 is absent from the on-chain liquidity coefficient table
const ENTRY_PERIOD_DAYS = 90; // contract max; calendar months can exceed 90 days
const HOLD_DECIMALS = 18;

// ── Deploy helpers ─────────────────────────────────────────────────────────────
// Parses a raw decimal string directly into wei — never round-trip through a float,
// or precision is lost (e.g. a tranche amount silently truncated to a whole token).
function toWei(amount: string): bigint {
  if (!amount) return BigInt(0);
  try {
    return parseUnits(amount, HOLD_DECIMALS);
  } catch {
    return BigInt(0);
  }
}

// Formats a wei amount back to a clean decimal string for display, trimming trailing zeros.
function formatWei(wei: bigint): string {
  if (wei <= BigInt(0)) return '';
  const [whole, frac] = formatUnits(wei, HOLD_DECIMALS).split('.');
  const trimmedFrac = frac ? frac.replace(/0+$/, '') : '';
  return trimmedFrac ? `${whole}.${trimmedFrac}` : whole;
}

// Parses a percent string (up to 2 decimal places) directly into basis points.
function toBps(percent: string): bigint {
  if (!percent) return BigInt(0);
  try {
    return parseUnits(percent, 2);
  } catch {
    return BigInt(0);
  }
}

// Formats basis points back into a percent string with up to 2 decimal places.
function formatBps(bps: bigint): string {
  if (bps <= BigInt(0)) return '';
  const [whole, frac] = formatUnits(bps, 2).split('.');
  const trimmedFrac = frac ? frac.replace(/0+$/, '') : '';
  return trimmedFrac ? `${whole}.${trimmedFrac}` : whole;
}

// Integer division rounded to the nearest whole unit (a, b > 0) — plain BigInt division
// truncates, which under-reports amt/total ratios like amount-derived percentages.
function roundedDiv(a: bigint, b: bigint): bigint {
  if (b <= BigInt(0)) return BigInt(0);
  return (a + b / BigInt(2)) / b;
}

// Largest-remainder allocation of 10000 bps across weights that sum exactly to the
// total — rounding each row's percent independently (as roundedDiv does) can leave the
// displayed percentages off by a bp or two even though the underlying amounts add up
// exactly, so once the tranches are fully allocated we distribute the rounding slack
// to the rows with the largest fractional remainder instead.
function allocateBpsExact(weights: bigint[]): bigint[] {
  const total = weights.reduce((sum, w) => sum + w, BigInt(0));
  if (total <= BigInt(0)) return weights.map(() => BigInt(0));
  const floors = weights.map(w => (w * BigInt(10000)) / total);
  const remainders = weights.map(w => (w * BigInt(10000)) % total);
  let left = BigInt(10000) - floors.reduce((sum, b) => sum + b, BigInt(0));
  const order = remainders
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : 0));
  const result = [...floors];
  for (let k = 0; k < order.length && left > BigInt(0); k++) {
    result[order[k].i] += BigInt(1);
    left -= BigInt(1);
  }
  return result;
}

function daysFromTimingOption(option: string): number {
  return parseInt(option);
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface Tranche {
  timing: string;
  percent: string;
  amount: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function formatNumber(n: number): string {
  if (!n) return '0';
  return Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');
}

function parseNum(v: string): number {
  return parseFloat(v.replace(/\s/g, '')) || 0;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}.${dd}.${yyyy}`;
}

function isoToDisplay(isoDate: string): string {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return `${m}.${d}.${y}`;
}

// ── Info icon ──────────────────────────────────────────────────────────────────
const InfoIcon: FC = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="8" r="7.5" stroke="#959EB5" />
    <circle cx="8" cy="5" r="0.75" fill="#959EB5" />
    <path d="M8 7.5v4" stroke="#959EB5" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

// ── Tooltip ────────────────────────────────────────────────────────────────────
const Tooltip: FC<{ text: string; children: React.ReactNode }> = ({ text, children }) => {
  const [visible, setVisible] = useState(false);
  return (
    <span
      className="relative inline-flex items-center cursor-default"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span className="absolute left-0 bottom-full mb-2 z-50 w-64 max-md:fixed max-md:left-1/2 max-md:top-1/2 max-md:bottom-auto max-md:mb-0 max-md:-translate-x-1/2 max-md:-translate-y-1/2 bg-white rounded-xl shadow-base border border-stroke-primary p-3 text-xs text-grey-dark leading-relaxed whitespace-normal pointer-events-none">
          {text}
        </span>
      )}
    </span>
  );
};

// ── Timing dropdown ────────────────────────────────────────────────────────────
const TimingDropdown: FC<{ value: string; onChange: (v: string) => void; minOption?: string }> = ({ value, onChange, minOption }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const minDays = minOption ? daysFromTimingOption(minOption) : 0;
  const availableOptions = TIMING_OPTIONS.filter(opt => daysFromTimingOption(opt) > minDays);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-stroke-primary bg-white text-sm cursor-pointer text-left"
      >
        <span className={value ? 'text-black' : 'text-label-tertiary'}>{value || 'Select timing'}</span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          className={clsx('shrink-0 transition-transform duration-200', open && 'rotate-180')}
        >
          <path d="M4 6l4 4 4-4" stroke="#959EB5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-white rounded-xl border border-stroke-primary shadow-base max-h-48 overflow-y-auto">
          {availableOptions.map(opt => (
            <button
              key={opt}
              type="button"
              onClick={() => { onChange(opt); setOpen(false); }}
              className={clsx(
                'w-full text-left px-3 py-2.5 text-sm hover:bg-blue-light cursor-pointer transition-colors',
                value === opt && 'text-blue font-medium'
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Info card ──────────────────────────────────────────────────────────────────
const InfoCard: FC<{ label: string; value: string; description: string; icon: React.ReactNode }> = ({
  label,
  value,
  description,
  icon,
}) => (
  <div className="bg-blue-light rounded-2xl p-4 flex flex-col gap-2">
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium text-grey-dark">{label}</span>
      <span className="text-blue">{icon}</span>
    </div>
    <span className="inline-flex bg-blue-dark text-white text-sm font-semibold px-3 py-1.5 rounded-lg self-start">
      {value}
    </span>
    <span className="text-sm text-grey-dark leading-snug">{description}</span>
  </div>
);

// ── SVG icons for info cards ───────────────────────────────────────────────────
const CommissionIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <circle cx="9" cy="9" r="7.5" stroke="currentColor" strokeWidth="1.3" />
    <path d="M6.5 9h5M9 6.5v5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);
const DebtIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M3 5h12M3 9h12M3 13h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);
const CalendarIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <rect x="2.5" y="3.5" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    <path d="M2.5 7h13M6 2v3M12 2v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

// ── Page ───────────────────────────────────────────────────────────────────────
const AddPoolContent: FC = () => {
  const searchParams = useSearchParams();
  const businessId = searchParams.get('businessId') ?? '';
  const { address: walletAddress } = useAccount();
  const router = useRouter();
  // Set synchronously on the first click (state updates aren't instant, so a fast double click
  // could otherwise create two pools: createPool has no idempotency, every call is a new record).
  // Stays locked once the pool exists, as we leave the page right after.
  const creatingRef = useRef(false);

  // The pool's on-chain deploy needs the project's RWA contract, so block everything
  // (including the DB record creation) until the backend reports its tokenAddress.
  const { data: businessDeployData, loading: businessDeployLoading } = useQuery(GET_BUSINESS_DEPLOY_INFO, {
    variables: { id: businessId },
    skip: !businessId,
    fetchPolicy: 'network-only',
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projectDeployed = !!(businessDeployData as any)?.getBusiness?.tokenAddress;
  const projectNotDeployed = !!businessId && !businessDeployLoading && !projectDeployed;

  const [createPool] = useMutation(CREATE_POOL);

  const [isCreating, setIsCreating] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [financialGoal, setFinancialGoal] = useState('');
  const [profitability, setProfitability] = useState('');
  const [poolType, setPoolType] = useState<'fixed' | 'flexible'>('fixed');
  const [startDate, setStartDate] = useState('');
  const [showCalendar, setShowCalendar] = useState(false);
  const [tranches, setTranches] = useState<Tranche[]>([{ timing: '', percent: '', amount: '' }]);

  const goalNum = parseNum(financialGoal);
  const profitNum = parseNum(profitability);
  const commission = goalNum * COMMISSION_RATE;
  const goalWei = toWei(financialGoal);
  const rewardBps = toBps(profitability);
  const debtAmountWei = goalWei > BigInt(0) ? goalWei + (goalWei * rewardBps) / BigInt(10000) : BigInt(0);
  const debtAmount = Number(formatUnits(debtAmountWei, HOLD_DECIMALS));
  const endDate = startDate ? addDays(startDate, ENTRY_PERIOD_DAYS) : '';

  const hasCommission = goalNum > 0;
  const hasDebt = goalNum > 0 && profitability !== '';
  const hasEndDate = !!startDate;
  const hasAllCards = hasCommission && hasDebt && hasEndDate;

  const trancheTotalWei = tranches.reduce((sum, t) => sum + toWei(t.amount), BigInt(0));
  const trancheTotal = Number(formatUnits(trancheTotalWei, HOLD_DECIMALS));
  const tranchePercent = debtAmountWei > BigInt(0)
    ? Math.min(Number(roundedDiv(trancheTotalWei * BigInt(10000), debtAmountWei)) / 100, 100)
    : 0;
  const hasAnyTranche = tranches.some(t => t.timing);

  const updateTranche = useCallback(
    (index: number, field: keyof Tranche, value: string) => {
      setTranches(prev => {
        let clampedValue = value;

        if (field === 'percent' && value !== '') {
          const otherBps = prev.reduce((sum, t, j) => j !== index ? sum + toBps(t.percent) : sum, BigInt(0));
          const maxBps = BigInt(10000) - otherBps;
          const bps = toBps(value);
          if (bps > maxBps) clampedValue = formatBps(maxBps);
        } else if (field === 'amount' && value !== '') {
          const otherAmtWei = prev.reduce((sum, t, j) => j !== index ? sum + toWei(t.amount) : sum, BigInt(0));
          const maxAmtWei = debtAmountWei - otherAmtWei;
          const amtWei = toWei(value);
          if (amtWei > maxAmtWei) clampedValue = formatWei(maxAmtWei);
        }

        const next = prev.map((t, i) => (i === index ? { ...t, [field]: clampedValue } : t));
        const t = { ...next[index] };

        if (field === 'percent') {
          const bps = toBps(clampedValue);
          if (debtAmountWei > BigInt(0) && bps > BigInt(0)) {
            const otherAmtWei = prev.reduce((sum, t, j) => j !== index ? sum + toWei(t.amount) : sum, BigInt(0));
            const maxAmtWei = debtAmountWei - otherAmtWei;
            const rawAmtWei = roundedDiv(bps * debtAmountWei, BigInt(10000));
            t.amount = formatWei(rawAmtWei > maxAmtWei ? maxAmtWei : rawAmtWei);
          } else {
            t.amount = '';
          }
        } else if (field === 'amount') {
          const amtWei = toWei(clampedValue);
          t.percent = debtAmountWei > BigInt(0) && amtWei > BigInt(0)
            ? formatBps(roundedDiv(amtWei * BigInt(10000), debtAmountWei))
            : '';
        }

        next[index] = t;

        if (field === 'amount') {
          // Match the same criterion as trancheTotal/tranchePercent below (all rows with
          // an amount, regardless of whether a timing has been picked yet) so the row
          // percentages and the "Tranche total" progress bar always agree.
          const filledIdx = next.reduce<number[]>((acc, row, i) => (toWei(row.amount) > BigInt(0) ? [...acc, i] : acc), []);
          const filledAmounts = filledIdx.map(i => toWei(next[i].amount));
          const filledTotal = filledAmounts.reduce((sum, w) => sum + w, BigInt(0));
          if (debtAmountWei > BigInt(0) && filledIdx.length > 0 && filledTotal === debtAmountWei) {
            const bpsList = allocateBpsExact(filledAmounts);
            filledIdx.forEach((i, k) => {
              next[i] = { ...next[i], percent: formatBps(bpsList[k]) };
            });
          }
        }

        if (field === 'timing' && value && index === next.length - 1 && next.length < MAX_TRANCHES) {
          next.push({ timing: '', percent: '', amount: '' });
        }

        return next;
      });
    },
    [debtAmountWei]
  );

  const deleteTranche = (index: number) => {
    setTranches(prev => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) return [{ timing: '', percent: '', amount: '' }];
      const last = next[next.length - 1];
      if (last.timing && next.length < MAX_TRANCHES) next.push({ timing: '', percent: '', amount: '' });
      return next;
    });
  };

  const clearAll = () => setTranches([{ timing: '', percent: '', amount: '' }]);

  const closeCalendar = useCallback(() => setShowCalendar(false), []);

  // ── Build tranche arrays from form state ───────────────────────────────────
  const buildTranches = useCallback(() => {
    const startUnix = startDate ? Math.floor(new Date(startDate).getTime() / 1000) : 0;
    const endUnix = startUnix + ENTRY_PERIOD_DAYS * 86400;

    const filledTranches = tranches.filter(t => t.timing && t.amount);

    const incomingAmounts = filledTranches.map(t => toWei(t.amount));
    const incomingDeadlines = filledTranches.map(t => BigInt(endUnix + daysFromTimingOption(t.timing) * 86400));

    const lastDeadline = incomingDeadlines.length > 0 ? incomingDeadlines[incomingDeadlines.length - 1] : BigInt(endUnix + 86400);
    const completionPeriodExpired = lastDeadline + BigInt(30 * 86400);

    // Single outgoing tranche: full financial goal disbursed to owner 1 day after fundraising end
    const outgoingAmounts = [goalWei];
    const outgoingTimestamps = [BigInt(endUnix + 86400)];

    return {
      startUnix,
      endUnix,
      completionPeriodExpiredUnix: completionPeriodExpired,
      incomingAmounts,
      incomingDeadlines,
      outgoingAmounts,
      outgoingTimestamps,
    };
  }, [startDate, tranches, goalWei]);

  // ── Validate and open confirmation modal ──────────────────────────────────
  const handleCreateClick = () => {
    if (projectNotDeployed || businessDeployLoading) {
      toast('Deploy the project first, then create a pool', 'error');
      return;
    }
    if (!walletAddress) {
      toast('Connect your wallet first', 'error');
      return;
    }
    if (!businessId) {
      toast('Missing businessId in URL', 'error');
      return;
    }
    if (!name || !financialGoal || !profitability || !startDate) {
      toast('Fill in all required fields', 'error');
      return;
    }
    if (profitNum < 1 || profitNum > 100) {
      toast('Profitability must be between 1% and 100%', 'error');
      return;
    }
    const filledTranches = tranches.filter(t => t.timing && t.amount);
    if (filledTranches.length === 0) {
      toast('Add at least one debt repayment tranche', 'error');
      return;
    }
    setShowDeployModal(true);
  };

  // ── Create pool ────────────────────────────────────────────────────────────
  // Only saves the pool (a draft with its own id). Requesting signatures and the on-chain deploy
  // are a separate step on the pool page, so this button can never deploy — or duplicate — a pool.
  const handleCreate = async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setShowDeployModal(false);
    if (!projectDeployed) {
      toast('Deploy the project first, then create a pool', 'error');
      creatingRef.current = false;
      return;
    }
    let created = false;
    setIsCreating(true);
    try {
      const { startUnix, endUnix, completionPeriodExpiredUnix, incomingAmounts, incomingDeadlines, outgoingAmounts, outgoingTimestamps } =
        buildTranches();

      const holdAmount = goalWei;

      const totalExpected = holdAmount + (holdAmount * rewardBps) / BigInt(10000);
      const totalIncoming = incomingAmounts.reduce((a, b) => a + b, BigInt(0));
      if (totalIncoming !== totalExpected) {
        const expectedUsdt = Number(totalExpected / BigInt(10 ** 18));
        toast(`Tranche amounts must sum to exactly ${expectedUsdt} USDT (goal + ${profitNum}% profit)`, 'error');
        return;
      }

      const { data: poolData } = await createPool({
        variables: {
          input: {
            name,
            businessId,
            description: description || undefined,
            expectedHoldAmount: holdAmount.toString(),
            expectedRwaAmount: goalNum.toString(),
            rewardPercent: rewardBps.toString(),
            priceImpactPercent: PRICE_IMPACT_PERCENT.toString(),
            entryFeePercent: '100',
            exitFeePercent: '100',
            entryPeriodStart: startUnix,
            entryPeriodExpired: endUnix,
            completionPeriodExpired: Number(completionPeriodExpiredUnix),
            fixedSell: poolType === 'fixed',
            allowEntryBurn: false,
            awaitCompletionExpired: true,
            floatingOutTranchesTimestamps: false,
            outgoingTranches: outgoingAmounts.map((amount, i) => ({
              amount: amount.toString(),
              timestamp: Number(outgoingTimestamps[i]),
              executedAmount: '0',
            })),
            incomingTranches: incomingAmounts.map((amount, i) => ({
              amount: amount.toString(),
              expiredAt: Number(incomingDeadlines[i]),
              returnedAmount: '0',
            })),
          },
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pool = (poolData as any)?.createPool as { id: string } | undefined;
      if (!pool) throw new Error('Failed to create pool record');
      created = true;
      toast('Pool created. Deploy it from the pool page.');
      router.push(`/pool/${pool.id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create pool';
      toast(msg, 'error');
    } finally {
      if (!created) creatingRef.current = false;
      setIsCreating(false);
    }
  };

  // The form is only usable for a project that is deployed on-chain: the backend refuses to
  // create a pool without the project's tokenAddress. Until then show why, not the form.
  if (!businessId || businessDeployLoading || projectNotDeployed) {
    return (
      <DashboardLayout>
        <section className="mb-10">
          <Wrapper>
            <div className="border-b border-stroke-primary pb-6">
              <Title size="xs">New pool</Title>
            </div>
            <div className="mt-6 max-w-xl rounded-xl border border-stroke-primary bg-bg-tertiary px-4 py-4 text-sm text-grey-dark flex flex-col gap-3">
              {!businessId ? (
                <>
                  <span>Pools are created inside a project. Open one of your projects and press Add pool there.</span>
                  <Link href="/my-companies" className="text-blue font-medium hover:underline">
                    Go to my companies
                  </Link>
                </>
              ) : businessDeployLoading ? (
                <span>Checking the project…</span>
              ) : (
                <>
                  <span>This project isn&apos;t deployed on-chain yet, so a pool can&apos;t be created.</span>
                  <Link href={`/project/${businessId}`} className="text-blue font-medium hover:underline">
                    Go to the project and deploy it first
                  </Link>
                </>
              )}
            </div>
          </Wrapper>
        </section>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      {/* Page header */}
      <section className="mb-10">
        <Wrapper>
          <div className="border-b border-stroke-primary pb-6 flex justify-between items-center max-md:flex-wrap max-md:gap-3">
            <Title size="xs">New pool</Title>
            <div className="flex items-center gap-3">
              <Button
                visualType="quaternary"
                type="button"
                onClick={handleCreateClick}
                disabled={isCreating || projectNotDeployed || businessDeployLoading}
              >
                {isCreating ? 'Creating…' : 'Create pool'}
              </Button>
            </div>
          </div>
        </Wrapper>
      </section>

      <Wrapper>
        <div className="flex flex-col gap-10 pb-16">

          {/* ── Information ──────────────────────────────────────────────────── */}
          <section>
            <h2 className="text-xl font-semibold mb-6">Information</h2>

            <div className="flex flex-col gap-5">
              {/* Pool name */}
              <div className="flex items-start gap-6 max-md:flex-col max-md:gap-2">
                <label className="w-44 shrink-0 max-md:w-auto pt-2.5 max-md:pt-0 text-sm text-grey-dark">Pool name</label>
                <div className="relative w-[330px] max-md:w-full">
                  <input
                    value={name}
                    maxLength={50}
                    onChange={e => setName(e.target.value)}
                    placeholder="Prototype development"
                    className="w-full px-3 py-2.5 rounded-lg border border-stroke-primary bg-white text-sm outline-none placeholder:text-label-tertiary tr-d-all focus:border-grey-dark"
                  />
                  <span className="absolute right-2 bottom-2.5 text-xs text-label-tertiary pointer-events-none">
                    {name.length}/50
                  </span>
                </div>
              </div>

              {/* Description */}
              <div className="flex items-start gap-6 max-md:flex-col max-md:gap-2">
                <label className="w-44 shrink-0 max-md:w-auto pt-2.5 max-md:pt-0 text-sm text-grey-dark">Description</label>
                <div className="relative w-[330px] max-md:w-full">
                  <textarea
                    value={description}
                    maxLength={250}
                    rows={5}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Tell investors what you need money for and why they should invest in your pool"
                    className="w-full px-3 py-2.5 pb-6 rounded-lg border border-stroke-primary bg-white text-sm outline-none placeholder:text-label-tertiary resize-none tr-d-all focus:border-grey-dark"
                  />
                  <span className="absolute right-2 bottom-2.5 text-xs text-label-tertiary pointer-events-none">
                    {description.length}/250
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* ── Pool parameters ──────────────────────────────────────────────── */}
          <section>
            <h2 className="text-xl font-semibold mb-6">Pool parameters</h2>

            <div className={clsx('flex gap-8 max-md:flex-col max-md:gap-5', !hasAllCards && 'items-start max-md:items-stretch')}>
              {/* Left: form fields */}
              <div className="flex flex-col gap-5 flex-1">
                {/* Financial goal */}
                <div className="flex items-center gap-6 max-md:flex-col max-md:items-start max-md:gap-2">
                  <label className="w-44 shrink-0 max-md:w-auto text-sm text-grey-dark">Financial goal</label>
                  <div className="relative w-[330px] max-md:w-full">
                    <input
                      value={financialGoal}
                      onChange={e => setFinancialGoal(e.target.value.replace(/[^0-9]/g, ''))}
                      placeholder="50 000"
                      className="w-full px-3 py-2.5 pr-8 rounded-lg border border-stroke-primary bg-white text-sm outline-none placeholder:text-label-tertiary tr-d-all focus:border-grey-dark"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-grey text-sm pointer-events-none">₮</span>
                  </div>
                </div>

                {/* Profitability */}
                <div className="flex items-center gap-6 max-md:flex-col max-md:items-start max-md:gap-2">
                  <label className="w-44 shrink-0 max-md:w-auto text-sm text-grey-dark flex items-center gap-1.5">
                    Profitability
                    <Tooltip text="Best option is not too high and not too low. Profitability can't be higher than 100%. Profitability will be included in the total amount of debt">
                      <InfoIcon />
                    </Tooltip>
                  </label>
                  <div className="relative w-[330px] max-md:w-full">
                    <input
                      value={profitability}
                      onChange={e => {
                        const v = e.target.value.replace(/[^0-9.]/g, '');
                        if (v === '' || (parseFloat(v) >= 1 && parseFloat(v) <= 100)) setProfitability(v);
                      }}
                      placeholder="4"
                      className="w-full px-3 py-2.5 pr-8 rounded-lg border border-stroke-primary bg-white text-sm outline-none placeholder:text-label-tertiary tr-d-all focus:border-grey-dark"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-grey text-sm pointer-events-none">%</span>
                  </div>
                </div>

                {/* Pool type */}
                <div className="flex items-center gap-6 max-md:flex-col max-md:items-start max-md:gap-2">
                  <label className="w-44 shrink-0 max-md:w-auto text-sm text-grey-dark">Pool type</label>
                  <div className="flex gap-3 max-md:flex-wrap">
                    {(
                      [
                        {
                          value: 'fixed',
                          label: 'Fixed pool',
                          tooltip: 'The pool stops collecting after reaching the financial goal',
                        },
                        {
                          value: 'flexible',
                          label: 'Flexible pool',
                          tooltip: 'The pool will continue collecting after reaching the financial goal',
                        },
                      ] as const
                    ).map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setPoolType(opt.value)}
                        className={clsx(
                          'flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium cursor-pointer tr-d-all',
                          poolType === opt.value
                            ? 'border-blue bg-white text-blue-dark'
                            : 'border-stroke-primary bg-white text-grey-dark hover:border-grey'
                        )}
                      >
                        <span
                          className={clsx(
                            'w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0',
                            poolType === opt.value ? 'border-blue' : 'border-grey'
                          )}
                        >
                          {poolType === opt.value && <span className="w-2 h-2 rounded-full bg-blue" />}
                        </span>
                        {opt.label}
                        <Tooltip text={opt.tooltip}>
                          <InfoIcon />
                        </Tooltip>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Collection start date */}
                <div className="flex items-center gap-6 max-md:flex-col max-md:items-start max-md:gap-2">
                  <label className="w-44 shrink-0 max-md:w-auto text-sm text-grey-dark">Collection start date</label>
                  <div className="relative w-[330px] max-md:w-full">
                    <button
                      type="button"
                      onClick={() => setShowCalendar(o => !o)}
                      className={clsx(
                        'w-full flex items-center justify-between px-3 py-2.5 rounded-lg border bg-white text-sm cursor-pointer tr-d-all',
                        showCalendar ? 'border-grey-dark' : 'border-stroke-primary'
                      )}
                    >
                      <span className={startDate ? 'text-black' : 'text-label-tertiary'}>
                        {startDate ? isoToDisplay(startDate) : 'MM.DD.YYYY'}
                      </span>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="#959EB5" strokeWidth="1.2" />
                        <path d="M2 6.5h12M5.5 2v2.5M10.5 2v2.5" stroke="#959EB5" strokeWidth="1.2" strokeLinecap="round" />
                      </svg>
                    </button>
                    {showCalendar && (
                      <Calendar value={startDate} onChange={setStartDate} onClose={closeCalendar} minDate={new Date().toISOString().slice(0, 10)} />
                    )}
                  </div>
                </div>
              </div>

              {/* Right: stacked info cards (only when not all cards present) */}
              {!hasAllCards && (hasCommission || hasDebt || hasEndDate) && (
                <div className="flex flex-col gap-3 w-[340px] shrink-0 max-md:w-full">
                  {hasCommission && (
                    <InfoCard
                      label="Comission:"
                      value={`${formatNumber(commission)} USDT`}
                      description="Will be debited upon receipt of money to the pool account"
                      icon={<CommissionIcon />}
                    />
                  )}
                  {hasDebt && (
                    <InfoCard
                      label="Debt amount:"
                      value={`${formatNumber(debtAmount)} USDT`}
                      description="The amount owed to your investors that you will have to repay"
                      icon={<DebtIcon />}
                    />
                  )}
                  {hasEndDate && (
                    <InfoCard
                      label="End date:"
                      value={endDate}
                      description="The end date of the fundraising, 90 days from the start date"
                      icon={<CalendarIcon />}
                    />
                  )}
                </div>
              )}
            </div>
          </section>

          {/* ── Terms (horizontal, once all cards are available) ─────────────── */}
          {hasAllCards && (
            <section>
              <h2 className="text-xl font-semibold mb-4">Terms</h2>
              <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
                <InfoCard
                  label="Comission:"
                  value={`${formatNumber(commission)} USDT`}
                  description="Will be debited upon receipt of money to the pool account"
                  icon={<CommissionIcon />}
                />
                <InfoCard
                  label="Debt amount:"
                  value={`${formatNumber(debtAmount)} USDT`}
                  description="The amount owed to your investors that you will have to repay"
                  icon={<DebtIcon />}
                />
                <InfoCard
                  label="End date:"
                  value={endDate}
                  description="The end date of the fundraising, 90 days from the start date"
                  icon={<CalendarIcon />}
                />
              </div>
            </section>
          )}

          {/* ── Debt paying schedule ─────────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 mb-6">
              <h2 className="text-xl font-semibold">Debt paying schedule</h2>
              <Tooltip text="Set the repayment schedule: choose how many days after the pool ends each tranche will be paid. Then, assign what percentage of the total debt you want to return in each tranche. The total across all tranches must equal 100%. You can schedule up to 20 tranches, or pay off the entire debt in one go">
                <InfoIcon />
              </Tooltip>
            </div>

            <div className="bg-grey-light rounded-2xl overflow-hidden">
              {/* Table header */}
              <div className="grid items-center px-6 py-3 text-sm text-grey-dark gap-4 md:grid-cols-[60px_1fr_180px_220px_130px] max-md:hidden">
                <div>№</div>
                <div>Tranche timing (days post-end)</div>
                <div>Precent of debt</div>
                <div>Amount of debt (USDT)</div>
                {hasAnyTranche ? (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={clearAll}
                      className="flex items-center gap-1 text-blue text-sm hover:opacity-70 cursor-pointer"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                      Clear everything
                    </button>
                  </div>
                ) : <div />}
              </div>

              {hasAnyTranche && (
                <div className="md:hidden flex justify-end px-4 py-3">
                  <button
                    type="button"
                    onClick={clearAll}
                    className="flex items-center gap-1 text-blue text-sm hover:opacity-70 cursor-pointer"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    Clear everything
                  </button>
                </div>
              )}

              {/* Rows */}
              <div className="divide-y divide-stroke-primary">
                {tranches.map((tranche, i) => (
                  <div
                    key={i}
                    className="grid items-center px-6 py-3 gap-4 bg-white max-md:grid-cols-2 max-md:px-4 md:grid-cols-[60px_1fr_180px_220px_130px]"
                  >
                    <span className="text-sm text-grey-dark max-md:col-span-2 max-md:font-semibold max-md:text-black">
                      <span className="md:hidden">Tranche № </span>
                      {i + 1}
                    </span>

                    <div className="max-md:col-span-2">
                      <div className="md:hidden mb-1 text-xs text-grey-dark">Tranche timing (days post-end)</div>
                      <TimingDropdown
                        value={tranche.timing}
                        onChange={v => updateTranche(i, 'timing', v)}
                        minOption={i > 0 ? tranches[i - 1].timing : undefined}
                      />
                    </div>

                    {/* Percent of debt */}
                    <div>
                      <div className="md:hidden mb-1 text-xs text-grey-dark">Percent of debt</div>
                      <div className="relative">
                        <input
                          value={tranche.percent}
                          onChange={e => updateTranche(i, 'percent', e.target.value.replace(/[^0-9.]/g, ''))}
                          placeholder="0"
                          className="w-full px-3 py-2.5 pr-8 rounded-lg border border-stroke-primary bg-white text-sm outline-none placeholder:text-label-tertiary tr-d-all focus:border-grey-dark"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-grey text-sm pointer-events-none">%</span>
                      </div>
                    </div>

                    {/* Amount of debt */}
                    <div>
                      <div className="md:hidden mb-1 text-xs text-grey-dark">Amount of debt (USDT)</div>
                      <div className="relative">
                        <input
                          value={tranche.amount}
                          onChange={e => updateTranche(i, 'amount', e.target.value.replace(/[^0-9.]/g, ''))}
                          placeholder="0"
                          className="w-full px-3 py-2.5 pr-8 rounded-lg border border-stroke-primary bg-white text-sm outline-none placeholder:text-label-tertiary tr-d-all focus:border-grey-dark"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-grey text-sm pointer-events-none">₮</span>
                      </div>
                    </div>

                    {/* Delete */}
                    <div className="flex justify-end max-md:col-span-2">
                      {tranche.timing && (
                        <button
                          type="button"
                          onClick={() => deleteTranche(i)}
                          className="flex items-center gap-1 text-grey-dark text-xs hover:text-red cursor-pointer tr-d-all"
                        >
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path
                              d="M2 3.5h10M5.5 3.5V2.5a1 1 0 012 0v1M3 3.5l.5 8a1 1 0 001 1h5a1 1 0 001-1l.5-8"
                              stroke="currentColor"
                              strokeWidth="1.2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Tranche total */}
              <div className="px-6 py-4 border-t border-stroke-primary">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold">Tranche total</span>
                  <span className="text-sm font-semibold">
                    {formatNumber(trancheTotal)} of {formatNumber(debtAmount)}
                  </span>
                </div>
                <div className="h-1 bg-stroke-primary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue rounded-full tr-d-all"
                    style={{ width: `${tranchePercent}%` }}
                  />
                </div>
                <div className="flex items-start justify-between mt-2">
                  <span className="text-xs text-grey-dark max-w-[220px] leading-snug">
                    You can pay the entire sum at once or in parts
                  </span>
                  <span className="text-xs text-grey-dark">{Math.round(tranchePercent)}%</span>
                </div>
              </div>
            </div>
          </section>

        </div>
      </Wrapper>
      <ConfirmModal
        isOpen={showDeployModal}
        title={'Create pool?'}
        heading={'Care to double-check?'}
        description={"The pool will be saved first and deployed on-chain from its page. Parameters can't be changed once signatures for the deploy are requested, so make sure everything is correct"}
        confirmText={'Create'}
        onConfirm={handleCreate}
        onCancel={() => setShowDeployModal(false)}
      />
    </DashboardLayout>
  );
};

const AddPoolPage: FC = () => (
  <React.Suspense fallback={null}>
    <AddPoolContent />
  </React.Suspense>
);

export default AddPoolPage;
