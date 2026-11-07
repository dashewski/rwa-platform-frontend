// A token can be claimed again 24 hours after the previous claim of the same token.
export const CLAIM_COOLDOWN_SEC = 24 * 60 * 60;

interface ClaimRecord {
  id: string;
  tokenType: 'gas' | 'hold' | 'platform';
  createdAt: number; // unix seconds
}

// When a claim happened, in unix seconds. Taken from the record's Mongo ObjectId (its first 4 bytes are the
// creation time): the API's createdAt is not reliable on the deployed backend (every record gets the same
// value), the id is. Falls back to createdAt for ids that are not ObjectIds.
export function claimedAt(record: Pick<ClaimRecord, 'id' | 'createdAt'>): number {
  const fromId = /^[0-9a-f]{24}$/i.test(record.id) ? parseInt(record.id.slice(0, 8), 16) : NaN;
  return Number.isFinite(fromId) ? fromId : record.createdAt;
}

// Unlock moment (unix seconds) per token: last claim + 24h; 0 when the token was never claimed.
// Computed from the user's claim history instead of the backend's getUnlockTime, which returns
// "now + delay" in the wrong unit and never counts down.
export function getUnlockTimes(history: readonly ClaimRecord[]): {
  gasUnlockTime: number;
  holdUnlockTime: number;
  platformUnlockTime: number;
} {
  const unlockOf = (tokenType: ClaimRecord['tokenType']) => {
    const last = Math.max(0, ...history.filter(r => r.tokenType === tokenType).map(claimedAt));
    return last > 0 ? last + CLAIM_COOLDOWN_SEC : 0;
  };
  return { gasUnlockTime: unlockOf('gas'), holdUnlockTime: unlockOf('hold'), platformUnlockTime: unlockOf('platform') };
}
