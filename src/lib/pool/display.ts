// Shared display helpers so pool cards (marketplace, home, project page) and the pool page
// show the same price and dates for the same pool.

interface PoolReserves {
  virtualHoldReserve?: string | null;
  realHoldReserve?: string | null;
  virtualRwaReserve?: string | null;
  expectedHoldAmount?: string | null;
  expectedRwaAmount?: string | null;
}

// HOLD/USDT uses 18 decimals, RWA tokens use 0 decimals (plain integers) — so a price in
// USDT per 1 RWA is hold / 1e18 / rwa. Dividing the RWA side by 1e15 (as before) turned
// every real reserve into 0 and sent the card to its "— USDT" fallback.
function ratio(hold: bigint, rwa: bigint, decimals: number): string | null {
  if (hold <= BigInt(0) || rwa <= BigInt(0)) return null;
  // Keep 6 extra digits through the BigInt division, then let toFixed round (not truncate)
  const PRECISION = 6;
  const scaled = (hold * BigInt(10) ** BigInt(PRECISION)) / (rwa * BigInt(10) ** BigInt(18));
  return (Number(scaled) / 10 ** PRECISION).toFixed(decimals);
}

// Current spot price per 1 RWA from the pool reserves (same reserves the buy widget quotes
// from: virtual + real HOLD against virtual RWA); before any trade falls back to the
// goal/supply ratio. Returns '—' when it can't be derived.
export function getPoolPrice(pool: PoolReserves, decimals = 4): string {
  try {
    if (pool.virtualHoldReserve && pool.virtualRwaReserve) {
      const hold = BigInt(pool.virtualHoldReserve) + BigInt(pool.realHoldReserve || '0');
      const p = ratio(hold, BigInt(pool.virtualRwaReserve), decimals);
      if (p) return p;
    }
    if (pool.expectedHoldAmount && pool.expectedRwaAmount) {
      const p = ratio(BigInt(pool.expectedHoldAmount), BigInt(pool.expectedRwaAmount), decimals);
      if (p) return p;
    }
  } catch {
    // fall through
  }
  return '—';
}

// dd.mm.yyyy — the format the pool page uses
export function formatPoolDate(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}
