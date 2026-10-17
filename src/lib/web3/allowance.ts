import { ERC20_APPROVE_ABI } from '@/lib/contracts';

const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);

// Every approval we send is "unlimited", and token supplies are far below this, so an allowance
// above it means a previous approval is still in place and a new approve() would only add an
// extra wallet prompt (and gas) for nothing.
const ENOUGH_ALLOWANCE = BigInt(1) << BigInt(128);

export function hasEnoughAllowance(allowance: bigint): boolean {
  return allowance >= ENOUGH_ALLOWANCE;
}

interface AllowanceDeps {
  publicClient: {
    readContract: (args: any) => Promise<unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
    waitForTransactionReceipt: (args: { hash: `0x${string}` }) => Promise<unknown>;
  };
  writeContractAsync: (args: any) => Promise<`0x${string}`>; // eslint-disable-line @typescript-eslint/no-explicit-any
  token: `0x${string}`;
  owner: `0x${string}`;
  spender: `0x${string}`;
}

// Reads the current allowance first and only sends approve() when it is missing.
// Returns true when an approve transaction was actually sent.
export async function ensureMaxAllowance({
  publicClient,
  writeContractAsync,
  token,
  owner,
  spender,
}: AllowanceDeps): Promise<boolean> {
  const current = (await publicClient.readContract({
    address: token,
    abi: ERC20_APPROVE_ABI,
    functionName: 'allowance',
    args: [owner, spender],
  })) as bigint;
  if (hasEnoughAllowance(current)) return false;

  const hash = await writeContractAsync({
    address: token,
    abi: ERC20_APPROVE_ABI,
    functionName: 'approve',
    args: [spender, MAX_UINT256],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return true;
}
