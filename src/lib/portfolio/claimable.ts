import { formatUnits } from 'viem';

// Result of one multicall item for pool.estimateBurn(rwaAmount):
// [holdAmountWithoutFee, holdFee, bonusAmountWithoutFee, bonusFee, eligibleRwaAmount]
type BurnQuoteResult = { status: 'success'; result?: unknown } | { status: 'failure' };

const HOLD_DECIMALS = 18;

// Income (the bonus paid on top of the invested funds) that the pools would pay out for the user's
// whole positions right now, net of the bonus fee. A pool that hasn't started repaying reports a
// zero bonus, so collecting / failed pools contribute nothing; failed quotes are skipped.
export function sumClaimableIncome(results: readonly BurnQuoteResult[] | undefined): number {
  let totalWei = BigInt(0);
  for (const r of results ?? []) {
    if (r.status !== 'success' || !Array.isArray(r.result)) continue;
    const [, , bonus, bonusFee] = r.result as readonly bigint[];
    if (bonus > bonusFee) totalWei += bonus - bonusFee;
  }
  return Number(formatUnits(totalWei, HOLD_DECIMALS));
}
