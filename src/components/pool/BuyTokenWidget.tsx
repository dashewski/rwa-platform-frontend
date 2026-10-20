'use client';

import React, { FC, useMemo, useState, useCallback, useEffect } from 'react';
import clsx from 'clsx';
import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi';
import { parseUnits, formatUnits, BaseError } from 'viem';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { HOLD_TOKEN_ADDRESS, ERC20_APPROVE_ABI, ERC1155_BALANCE_ABI, POOL_ABI } from '@/lib/contracts';
import { formatTicker } from '@/lib/formatTicker';
import { Button, toast } from '@/components/ui';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPool = any;

const ZERO = BigInt(0);
const SLIPPAGE_BPS = BigInt(50);
const HOLD_DECIMALS = 18;

// USDT/HOLD amounts use 18 decimals
function formatUsdtAmount(wei: bigint | undefined): string {
  if (!wei || wei === ZERO) return '0';
  const [whole, frac] = formatUnits(wei, HOLD_DECIMALS).split('.');
  const wholeStr = BigInt(whole).toLocaleString('en-US').replace(/,/g, ' ');
  if (!frac) return wholeStr;
  const fracStr = frac.slice(0, 4);
  return fracStr ? `${wholeStr}.${fracStr}` : wholeStr;
}

function parseUsdtInput(input: string): bigint {
  if (!input) return ZERO;
  const trimmed = input.replace(/\s/g, '');
  if (!trimmed || isNaN(parseFloat(trimmed))) return ZERO;
  try {
    return parseUnits(trimmed, HOLD_DECIMALS);
  } catch {
    return ZERO;
  }
}

// RWA tokens use 0 decimals — stored as plain integers
function formatRwaAmount(amount: bigint | undefined): string {
  if (!amount || amount === ZERO) return '0';
  return amount.toLocaleString('en-US').replace(/,/g, ' ');
}

function parseRwaInput(input: string): bigint {
  if (!input) return ZERO;
  const trimmed = input.split('.')[0].replace(/\s/g, '');
  try {
    return BigInt(trimmed || '0');
  } catch {
    return ZERO;
  }
}

// usdtWei is the amount to invest (goes into the pool); the entry fee is charged on top of it.
// RWA tokens are whole units, so this returns the most tokens whose cost does not exceed usdtWei.
function computeRwaFromUsdt(usdtWei: bigint, pool: AnyPool): { rwaWei: bigint; fee: bigint } {
  try {
    if (!usdtWei || usdtWei === ZERO) return { rwaWei: ZERO, fee: ZERO };
    const virtualHold = BigInt(pool?.virtualHoldReserve || '0');
    const realHold = BigInt(pool?.realHoldReserve || '0');
    const virtualRwa = BigInt(pool?.virtualRwaReserve || '0');
    const entryFee = BigInt(pool?.entryFeePercent || '100');
    if (!virtualHold || !virtualRwa) return { rwaWei: ZERO, fee: ZERO };

    const effectiveHold = virtualHold + realHold;
    const k = effectiveHold * virtualRwa;

    // holdAmountWithFee = holdAmount + holdAmount * fee / 10000, with holdAmount = usdtWei
    const bp = BigInt(10000);
    const one = BigInt(1);
    const holdAmount = usdtWei;
    const fee = (holdAmount * entryFee) / bp;

    const newHoldReserve = effectiveHold + holdAmount;
    // Round the remaining reserve up so the tokens bought never cost more than the amount entered
    const newRwaReserve = (k + newHoldReserve - one) / newHoldReserve;
    let rwaWei = virtualRwa > newRwaReserve ? virtualRwa - newRwaReserve : ZERO;

    // Fixed-sell pools cap the total RWA that can ever be minted — clamp to
    // what's actually left so we never request more than the pool can fill.
    if (pool?.fixedSell) {
      const expectedRwa = BigInt(pool?.expectedRwaAmount || '0');
      const awaitingRwa = BigInt(pool?.awaitingRwaAmount || '0');
      const remainingRwa = expectedRwa > awaitingRwa ? expectedRwa - awaitingRwa : ZERO;
      if (rwaWei > remainingRwa) rwaWei = remainingRwa;
    }

    return { rwaWei, fee };
  } catch {
    return { rwaWei: ZERO, fee: ZERO };
  }
}

// Most USDT (without the fee, which is charged on top) a buy can invest before a fixed-sell
// pool runs out of RWA. Returns null when the pool has no such cap (flexible pools).
function computeMaxBuyUsdt(pool: AnyPool): bigint | null {
  try {
    if (!pool?.fixedSell) return null;
    const expectedRwa = BigInt(pool?.expectedRwaAmount || '0');
    const awaitingRwa = BigInt(pool?.awaitingRwaAmount || '0');
    if (expectedRwa <= awaitingRwa) return ZERO;
    const remainingRwa = expectedRwa - awaitingRwa;

    const virtualHold = BigInt(pool?.virtualHoldReserve || '0');
    const realHold = BigInt(pool?.realHoldReserve || '0');
    const virtualRwa = BigInt(pool?.virtualRwaReserve || '0');
    if (!virtualHold || !virtualRwa || remainingRwa >= virtualRwa) return null;

    const effectiveHold = virtualHold + realHold;
    const k = effectiveHold * virtualRwa;
    const one = BigInt(1);

    // Round every step up so the capped amount still buys the last token
    const newRwaReserve = virtualRwa - remainingRwa;
    const newHoldReserve = (k + newRwaReserve - one) / newRwaReserve;
    const holdAmount = newHoldReserve - effectiveHold;

    // The input shows 4 decimals — round up to that precision too
    const unit = BigInt(10) ** BigInt(HOLD_DECIMALS - 4);
    return ((holdAmount + unit - one) / unit) * unit;
  } catch {
    return null;
  }
}

function computeUsdtFromRwa(rwaAmt: bigint, pool: AnyPool): { usdtWei: bigint; fee: bigint } {
  try {
    if (!rwaAmt || rwaAmt === ZERO) return { usdtWei: ZERO, fee: ZERO };
    const virtualHold = BigInt(pool?.virtualHoldReserve || '0');
    const realHold = BigInt(pool?.realHoldReserve || '0');
    const virtualRwa = BigInt(pool?.virtualRwaReserve || '0');
    const exitFee = BigInt(pool?.exitFeePercent || '100');
    if (!virtualHold || !virtualRwa) return { usdtWei: ZERO, fee: ZERO };

    const effectiveHold = virtualHold + realHold;
    const k = effectiveHold * virtualRwa;

    const newRwaReserve = virtualRwa + rwaAmt;
    const newHoldReserve = k / newRwaReserve;
    const holdAmount = effectiveHold > newHoldReserve ? effectiveHold - newHoldReserve : ZERO;

    const fee = (holdAmount * exitFee) / BigInt(10000);
    const usdtWei = holdAmount - fee;

    return { usdtWei, fee };
  } catch {
    return { usdtWei: ZERO, fee: ZERO };
  }
}

const InfoIcon: FC = () => (
  <svg width='14' height='14' viewBox='0 0 14 14' fill='none' xmlns='http://www.w3.org/2000/svg'>
    <circle cx='7' cy='7' r='6.5' stroke='#959EB5' />
    <circle cx='7' cy='4.5' r='0.65' fill='#959EB5' />
    <path d='M7 6.5v3.5' stroke='#959EB5' strokeWidth='1.1' strokeLinecap='round' />
  </svg>
);

const SLIDER_MARKS = [0, 25, 50, 75, 100];

interface BuyTokenWidgetProps {
  pool: AnyPool;
  // When set, that side of the widget is blocked and the reason is shown
  buyDisabledReason?: string | null;
  sellDisabledReason?: string | null;
}

const LockIcon: FC = () => (
  <svg width={'14'} height={'14'} viewBox={'0 0 14 14'} fill={'none'} xmlns={'http://www.w3.org/2000/svg'} aria-hidden>
    <rect x={'2.5'} y={'6'} width={'9'} height={'6.5'} rx={'1.5'} stroke={'currentColor'} strokeWidth={'1.3'} />
    <path d={'M4.5 6V4.5a2.5 2.5 0 0 1 5 0V6'} stroke={'currentColor'} strokeWidth={'1.3'} strokeLinecap={'round'} />
  </svg>
);

// Inactive look for a trade side the pool currently doesn't allow
const LOCKED_TAB_CLASS = '!bg-grey-light !text-grey-dark !border-transparent cursor-not-allowed';

const BuyTokenWidget: FC<BuyTokenWidgetProps> = ({ pool, buyDisabledReason, sellDisabledReason }) => {
  const [mode, setMode] = useState<'buy' | 'sell'>('buy');
  const [inputValue, setInputValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const rwaAddress = pool?.rwaAddress as `0x${string}` | undefined;
  const poolAddress = pool?.poolAddress as `0x${string}` | undefined;

  const { data: poolTokenId } = useReadContract({
    address: poolAddress,
    abi: POOL_ABI,
    functionName: 'tokenId',
    query: { enabled: !!poolAddress },
  });

  const { data: usdtBalance } = useReadContract({
    address: HOLD_TOKEN_ADDRESS,
    abi: ERC20_APPROVE_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: rwaBalance } = useReadContract({
    address: rwaAddress,
    abi: ERC1155_BALANCE_ABI,
    functionName: 'balanceOf',
    args: address && poolTokenId != null ? [address, poolTokenId as bigint] : undefined,
    query: { enabled: !!address && !!rwaAddress && poolTokenId != null },
  });

  const tokenSymbol = pool?.name ? formatTicker(pool.name) : 'RWA';

  const entryFeePercent = BigInt(pool?.entryFeePercent || '100');
  const exitFeePercent = BigInt(pool?.exitFeePercent || '100');
  const rewardPercent = BigInt(pool?.rewardPercent || '0');

  const feeDisplayPct =
    mode === 'buy'
      ? (Number(entryFeePercent) / 100).toFixed(2).replace('.', ',')
      : (Number(exitFeePercent) / 100).toFixed(2).replace('.', ',');

  const profitDisplayPct = (Number(rewardPercent) / 100).toFixed(0);

  // In buy mode the input is USDT (18 decimals); in sell mode it's raw RWA tokens (0 decimals)
  const inputWei = useMemo(
    () => (mode === 'buy' ? parseUsdtInput(inputValue) : parseRwaInput(inputValue)),
    [mode, inputValue]
  );

  const { receiveAmt, feeWei, profitWei } = useMemo(() => {
    if (mode === 'buy') {
      // The entered amount is what gets invested; the fee is charged on top of it
      const { rwaWei, fee } = computeRwaFromUsdt(inputWei, pool);
      const profit = (inputWei * rewardPercent) / BigInt(10000);
      return { receiveAmt: rwaWei, feeWei: fee, profitWei: profit };
    } else {
      const { usdtWei, fee } = computeUsdtFromRwa(inputWei, pool);
      return { receiveAmt: usdtWei, feeWei: fee, profitWei: ZERO };
    }
  }, [mode, inputWei, pool, rewardPercent]);

  const usdtBalanceBig = usdtBalance as bigint | undefined;
  const rwaBalanceBig = rwaBalance as bigint | undefined;

  // Exact cost of the tokens being bought, straight from the pool contract: [holdAmountWithFee, fee, actualRwaAmount].
  // Until it arrives (or if it reverts) the rows below fall back to the local estimate.
  const { data: mintQuoteRaw } = useReadContract({
    address: poolAddress,
    abi: POOL_ABI,
    functionName: 'estimateMint',
    args: [mode === 'buy' ? receiveAmt : ZERO, true],
    query: { enabled: mode === 'buy' && receiveAmt > ZERO && !!poolAddress },
  });
  const mintQuote = mode === 'buy' && receiveAmt > ZERO ? (mintQuoteRaw as [bigint, bigint, bigint] | undefined) : undefined;
  const totalPayWei = mintQuote ? mintQuote[0] : inputWei + feeWei;
  const shownFeeWei = mintQuote ? mintQuote[1] : feeWei;
  const shownInvestWei = mintQuote ? mintQuote[0] - mintQuote[1] : inputWei;
  const shownProfitWei = (shownInvestWei * rewardPercent) / BigInt(10000);

  // Amount to invest is limited by the wallet balance (which must also cover the fee on top, so
  // the largest amount is balance / (1 + fee), rounded down to the 4 decimals the input shows)
  // and by what a fixed pool has left to sell
  const maxInvestFromBalance = useMemo(() => {
    if (usdtBalanceBig === undefined) return undefined;
    const bp = BigInt(10000);
    const unit = BigInt(10) ** BigInt(HOLD_DECIMALS - 4);
    return (((usdtBalanceBig * bp) / (bp + entryFeePercent)) / unit) * unit;
  }, [usdtBalanceBig, entryFeePercent]);

  const maxBuyWei = useMemo(() => {
    const poolCap = computeMaxBuyUsdt(pool);
    if (poolCap === null) return maxInvestFromBalance;
    if (maxInvestFromBalance === undefined) return poolCap;
    return poolCap < maxInvestFromBalance ? poolCap : maxInvestFromBalance;
  }, [pool, maxInvestFromBalance]);

  // Percent shown/dragged on the slider. Kept as its own state (rather than purely
  // derived from inputWei) so the thumb tracks the pointer 1:1 while dragging, the
  // way Binance's spot/convert sliders do, instead of lagging behind bigint rounding.
  const [sliderPct, setSliderPct] = useState(0);

  const computedPct = useMemo(() => {
    const balance = mode === 'buy' ? maxBuyWei : rwaBalanceBig;
    if (!balance || balance === ZERO || inputWei === ZERO) return 0;
    return Math.min(100, Math.max(0, Number((inputWei * BigInt(100)) / balance)));
  }, [mode, inputWei, maxBuyWei, rwaBalanceBig]);

  // Keeps the slider in sync when the amount is changed some other way
  // (typed manually, tab switch reset, wallet/balance updates, etc).
  useEffect(() => {
    setSliderPct(computedPct);
  }, [computedPct]);

  const handleSlider = useCallback(
    (pct: number) => {
      const clamped = Math.min(100, Math.max(0, Math.round(pct)));
      setSliderPct(clamped);

      if (mode === 'buy') {
        if (!maxBuyWei) return;

        const wei = clamped === 100 ? maxBuyWei : (maxBuyWei * BigInt(clamped)) / BigInt(100);

        setInputValue(wei === ZERO ? '' : formatUsdtAmount(wei).replace(/\s/g, ''));
      } else {
        if (!rwaBalanceBig) return;

        const amt = clamped === 100 ? rwaBalanceBig : (rwaBalanceBig * BigInt(clamped)) / BigInt(100);

        setInputValue(amt === ZERO ? '' : amt.toString());
      }
    },
    [mode, maxBuyWei, rwaBalanceBig]
  );

  const disabledReason = mode === 'buy' ? buyDisabledReason : sellDisabledReason;
  const lockReasons = Array.from(new Set([buyDisabledReason, sellDisabledReason].filter((r): r is string => !!r)));

  // Land on the side that is actually available (e.g. Sell once a fixed pool is sold out)
  useEffect(() => {
    if (mode === 'buy' && buyDisabledReason && !sellDisabledReason) {
      setMode('sell');
      setInputValue('');
    } else if (mode === 'sell' && sellDisabledReason && !buyDisabledReason) {
      setMode('buy');
      setInputValue('');
    }
  }, [mode, buyDisabledReason, sellDisabledReason]);

  const handleBuy = async () => {
    if (buyDisabledReason) return;
    if (!address || !poolAddress || !pool) return;
    if (inputWei === ZERO) {
      toast('Enter an amount', 'error');
      return;
    }
    if (!publicClient) return;
    setIsSubmitting(true);
    try {
      // inputWei is USDT in 18 decimals; derive a rough RWA amount to quote from
      const { rwaWei: estimatedRwaWei } = computeRwaFromUsdt(inputWei, pool);
      if (estimatedRwaWei === ZERO) {
        toast('Invalid amount', 'error');
        return;
      }

      const validUntil = BigInt(Math.floor(Date.now() / 1000) + 300);

      // Ask the contract for the authoritative cost of this rwaAmount rather than
      // reverse-deriving maxHold client-side — the two AMM calculations round in
      // opposite directions and can disagree, tripping "Pool: excessive input amount".
      let rwaWei: bigint;
      let maxHold: bigint;
      try {
        const [holdAmountWithFee, , actualRwaAmount] = (await publicClient.readContract({
          address: poolAddress,
          abi: POOL_ABI,
          functionName: 'estimateMint',
          args: [estimatedRwaWei, true],
        })) as [bigint, bigint, bigint];
        rwaWei = actualRwaAmount;
        maxHold = holdAmountWithFee + (holdAmountWithFee * SLIPPAGE_BPS) / BigInt(10000);
        // The fee comes on top of the entered amount, so the wallet must cover amount + fee
        if (usdtBalanceBig !== undefined && usdtBalanceBig < holdAmountWithFee) {
          toast(`Not enough USDT: this purchase costs ${formatUsdtAmount(holdAmountWithFee)} USDT including the fee`, 'error');
          return;
        }
      } catch (estErr) {
        console.error('estimateMint reverted', estErr);
        const reason = estErr instanceof BaseError ? estErr.shortMessage : 'This amount is unavailable';
        toast(reason, 'error');
        return;
      }

      const allowance = (await publicClient.readContract({
        address: HOLD_TOKEN_ADDRESS,
        abi: ERC20_APPROVE_ABI,
        functionName: 'allowance',
        args: [address, poolAddress],
      })) as bigint;

      if (allowance < maxHold) {
        toast('Approving USDT…');
        const approveTx = await writeContractAsync({
          address: HOLD_TOKEN_ADDRESS,
          abi: ERC20_APPROVE_ABI,
          functionName: 'approve',
          args: [poolAddress, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
      }

      try {
        await publicClient.simulateContract({
          address: poolAddress,
          abi: POOL_ABI,
          functionName: 'mint',
          args: [rwaWei, maxHold, validUntil, true],
          account: address,
        });
      } catch (simErr) {
        console.error('mint simulation reverted', simErr);
        const reason = simErr instanceof BaseError ? simErr.shortMessage : 'Transaction would fail';
        toast(reason, 'error');
        return;
      }

      toast('Sending transaction…');
      await writeContractAsync({
        address: poolAddress,
        abi: POOL_ABI,
        functionName: 'mint',
        args: [rwaWei, maxHold, validUntil, true],
      });

      toast('Tokens purchased successfully!');
      setInputValue('');
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Transaction failed', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSell = async () => {
    if (sellDisabledReason) return;
    if (!address || !poolAddress || !pool) return;
    if (inputWei === ZERO) {
      toast('Enter an amount', 'error');
      return;
    }
    if (!publicClient) return;
    setIsSubmitting(true);
    try {
      // inputWei is raw RWA token count (0 decimals)
      const { usdtWei } = computeUsdtFromRwa(inputWei, pool);
      const minHold = usdtWei - (usdtWei * SLIPPAGE_BPS) / BigInt(10000);
      const validUntil = BigInt(Math.floor(Date.now() / 1000) + 300);

      toast('Sending transaction…');
      await writeContractAsync({
        address: poolAddress,
        abi: POOL_ABI,
        functionName: 'burn',
        args: [inputWei, minHold, ZERO, validUntil],
      });

      toast('Tokens sold successfully!');
      setInputValue('');
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Transaction failed', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const displayBalance = mode === 'buy' ? formatUsdtAmount(usdtBalanceBig) : formatRwaAmount(rwaBalanceBig);
  const displayBalanceSymbol = mode === 'buy' ? 'USDT' : tokenSymbol;
  const isPoolDeployed = !!poolAddress;
  const canSubmit = isPoolDeployed && inputWei > ZERO && !isSubmitting && !disabledReason;

  return (
    <div className='bg-white border border-stroke-primary rounded-2xl p-5 flex flex-col gap-4'>
      {/* Header */}
      <div className='flex items-center justify-between'>
        <span className='text-base font-bold text-[#1D1D1F]'>Your balance</span>
        <span className='text-sm font-semibold text-blue bg-[#D9E4FF] rounded-full px-3 py-1.5'>
          {displayBalance} {displayBalanceSymbol}
        </span>
      </div>

      {/* Buy / Sell tabs */}
      <div className='grid grid-cols-2 gap-2 overflow-hidden'>
        <Button
          visualType={mode === 'buy' ? 'quaternary' : 'quinary'}
          className={clsx(buyDisabledReason && LOCKED_TAB_CLASS)}
          disabled={!!buyDisabledReason}
          aria-label={buyDisabledReason ? `Buy (locked): ${buyDisabledReason}` : undefined}
          onClick={() => {
            if (mode === 'buy') return;
            setMode('buy');
            setInputValue('');
          }}
        >
          {buyDisabledReason && <LockIcon />}
          Buy
        </Button>
        <Button
          visualType={mode === 'sell' ? 'quaternary' : 'quinary'}
          className={clsx(sellDisabledReason && LOCKED_TAB_CLASS)}
          disabled={!!sellDisabledReason}
          aria-label={sellDisabledReason ? `Sell (locked): ${sellDisabledReason}` : undefined}
          onClick={() => {
            if (mode === 'sell') return;
            setMode('sell');
            setInputValue('');
          }}
        >
          {sellDisabledReason && <LockIcon />}
          Sell
        </Button>
      </div>

      {/* Why a side is locked, right under the tabs */}
      {lockReasons.map(reason => (
        <p key={reason} className='text-sm text-grey-dark flex items-start gap-1.5'>
          <span className='mt-0.5 shrink-0'><LockIcon /></span>
          {reason}
        </p>
      ))}

      {/* Input */}
      <div className='flex flex-col gap-1.5'>
        <label className='text-sm text-grey-dark'>{mode === 'buy' ? 'USDT to invest' : `${tokenSymbol} sell`}</label>
        <input
          type='number'
          min='0'
          value={inputValue}
          onChange={e => {
            const raw = e.target.value;
            if (mode === 'buy' && maxBuyWei) {
              const parsed = parseUsdtInput(raw);
              if (parsed > maxBuyWei) {
                setInputValue(formatUsdtAmount(maxBuyWei).replace(/\s/g, ''));
                return;
              }
            }
            if (mode === 'sell' && rwaBalanceBig) {
              const parsed = parseRwaInput(raw);
              if (parsed > rwaBalanceBig) {
                setInputValue(rwaBalanceBig.toString());
                return;
              }
            }
            setInputValue(raw);
          }}
          placeholder='0'
          className='w-full px-4 py-3 rounded-2xl border border-stroke-primary bg-white text-base text-black placeholder:text-label-tertiary outline-none tr-d-all focus:border-grey-dark'
        />
      </div>

      {/* Slider */}
      <div className='relative'>
        <div className='relative flex justify-between mb-1 pointer-events-none'>
          {SLIDER_MARKS.map(m => {
            const isActive = sliderPct >= m;
            return (
              <button
                key={m}
                type='button'
                onClick={() => handleSlider(m)}
                className='z-0 relative flex flex-col items-center gap-1.5 cursor-pointer group pointer-events-auto'
              >
                <span
                  className={clsx(
                    'w-3 h-3 rounded-full border-2 bg-white tr-d-all group-first-of-type:mr-auto group-last-of-type:ml-auto',
                    isActive ? 'border-black !bg-black' : 'border-label-tertiary bg-white',
                    'group-hover:border-label-tertiary'
                  )}
                />
                <span className='text-xs text-[#9B9BA5]'>{m}%</span>
              </button>
            );
          })}
        </div>

        <input
          type='range'
          min={0}
          max={100}
          step={1}
          value={sliderPct}
          onChange={e => handleSlider(Number(e.target.value))}
          className='absolute inset-x-0 top-[6px] -translate-y-1/2 z-10 w-full h-1 appearance-none bg-transparent cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-3.5
            [&::-webkit-slider-thumb]:h-3.5
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-black
            [&::-webkit-slider-thumb]:border-2
            [&::-webkit-slider-thumb]:border-white
            [&::-webkit-slider-thumb]:shadow
            [&::-webkit-slider-thumb]:cursor-pointer
            [&::-moz-range-thumb]:w-3.5
            [&::-moz-range-thumb]:h-3.5
            [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-black
            [&::-moz-range-thumb]:border-2
            [&::-moz-range-thumb]:border-white
            [&::-moz-range-thumb]:cursor-pointer'
          style={{
            background: `linear-gradient(to right, black ${sliderPct}%, #e5e5e5 ${sliderPct}%)`,
          }}
        />
      </div>

      {/* Receive row */}
      <div className='flex items-center justify-between py-3'>
        <span className='text-sm font-semibold text-[#1D1D1F]'>Receive</span>
        <span className='text-sm font-semibold text-[#1D1D1F]'>
          {mode === 'buy' ? formatRwaAmount(receiveAmt) : formatUsdtAmount(receiveAmt)}{' '}
          {mode === 'buy' ? tokenSymbol : 'USDT'}
        </span>
      </div>

      {/* Potential profit row (buy only) */}
      {mode === 'buy' && (
        <div className='flex items-center justify-between py-3 border-t border-stroke-primary'>
          <span className='flex items-center gap-1.5 text-sm text-[#1D1D1F]'>
            Potential profit ({profitDisplayPct}%)
            <InfoIcon />
          </span>
          <span className='text-sm text-grey-dark'>~ {formatUsdtAmount(mode === 'buy' ? shownProfitWei : profitWei)} USDT</span>
        </div>
      )}

      {/* Fee row */}
      <div className='flex items-center justify-between py-3 border-t border-stroke-primary'>
        <span className='flex items-center gap-1.5 text-sm text-[#1D1D1F]'>
          Fee ({feeDisplayPct}%)
          <InfoIcon />
        </span>
        <span className='text-sm text-grey-dark'>~ {formatUsdtAmount(mode === 'buy' ? shownFeeWei : feeWei)} USDT</span>
      </div>

      {/* Total to pay (buy only): the invested amount plus the fee on top, exact once the contract quote arrives */}
      {mode === 'buy' && (
        <div className='flex items-center justify-between py-3 border-t border-stroke-primary'>
          <span className='text-sm font-semibold text-[#1D1D1F]'>Total to pay</span>
          <span className='text-sm font-semibold text-[#1D1D1F]'>
            {mintQuote ? '' : '~ '}
            {formatUsdtAmount(totalPayWei)} USDT
          </span>
        </div>
      )}


      {/* Action button */}
      {!address ? (
        <Button visualType={'quaternary'} onClick={openConnectModal}>
          Connect wallet
        </Button>
      ) : (
        <Button visualType={'quaternary'} onClick={mode === 'buy' ? handleBuy : handleSell} disabled={!canSubmit}>
          {isSubmitting ? 'Processing…' : mode === 'buy' ? `Buy ${tokenSymbol}` : `Sell ${tokenSymbol}`}
        </Button>
      )}
    </div>
  );
};

export default BuyTokenWidget;
