// Walks viem/wagmi's nested errors (message, shortMessage, details, cause…) into one string
function collectErrorText(err: unknown, depth = 0): string {
  if (!err || depth > 5) return '';
  if (typeof err === 'string') return err;
  if (typeof err !== 'object') return '';
  const e = err as { message?: unknown; shortMessage?: unknown; details?: unknown; reason?: unknown; cause?: unknown };
  return [e.shortMessage, e.message, e.details, e.reason]
    .filter((v): v is string => typeof v === 'string')
    .concat(collectErrorText(e.cause, depth + 1))
    .join(' ');
}

// A second deploy of an entity that is already on-chain isn't a failure from the user's side:
// the thing they wanted exists. The exact revert text comes from the contracts, so match the
// common spellings (AlreadyDeployed, "already deployed", "already exists").
export function isAlreadyDeployedError(err: unknown): boolean {
  return /already[\s_-]*(deployed|exists?)|AlreadyDeployed/i.test(collectErrorText(err));
}
