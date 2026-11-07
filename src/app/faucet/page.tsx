'use client';

import React, { FC, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { DashboardLayout, Wrapper } from '@/components/layout';
import { Button, Pagination, Title, toast } from '@/components/ui';
import { useMutation, useQuery } from '@apollo/client/react';
import { GET_HISTORY, REQUEST_GAS, REQUEST_HOLD, REQUEST_PLATFORM } from '@/lib/faucet/operations';
import { claimedAt, getUnlockTimes } from '@/lib/faucet/cooldown';
import { useAuth } from '@/lib/auth/AuthContext';
import { useKeepInViewport } from '@/lib/useKeepInViewport';
import FaucetHistoryTable, { FaucetHistoryItem } from '@/components/faucet/FaucetHistoryTable';

// Real time left until the server-reported unlock moment, as HH:MM:SS.
function formatCountdown(ts: number): string {
  const diff = Math.max(0, Math.ceil(ts - Date.now() / 1000));
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const sec = diff % 60;
  return [h, m, sec].map(n => String(n).padStart(2, '0')).join(':');
}

function formatUnlock(ts: number): string {
  if (!ts || ts <= Date.now() / 1000) return 'Available now';
  return `Available in ${formatCountdown(ts)}`;
}

// Same countdown without the "Available in/now" prefix — used once a token is already
// claimed, both in the hover tooltip and the click toast below.
const formatCooldown = formatCountdown;

// Small hover bubble for a claimed button, mirroring ui/Tooltip's own bubble markup
// (same arrow, same viewport-clamping hook) without nesting another <button> inside
// the claim Button itself.
const CooldownTooltip: FC<{ open: boolean; text: string }> = ({ open, text }) => {
  const { ref, shift } = useKeepInViewport<HTMLDivElement>(open);
  if (!open) return null;
  return (
    <div
      ref={ref}
      className={'absolute bottom-full left-1/2 z-50 mb-2 flex flex-col items-center w-44 pointer-events-none'}
      style={{ transform: `translateX(calc(-50% + ${shift}px))`, filter: 'drop-shadow(0px 2px 7px rgba(0,0,0,0.1))' }}
    >
      <div className={'bg-bg-primary rounded-xl px-3 py-2 w-full text-center -mb-px'}>
        <p className={'text-xs leading-[1.2] text-grey-dark break-words'}>{text}</p>
      </div>
      <svg
        width={'20'}
        height={'9'}
        viewBox={'0 0 28 12'}
        fill={'none'}
        xmlns={'http://www.w3.org/2000/svg'}
        style={{ transform: `translateX(${-shift}px)` }}
      >
        <path
          d={
            'M13.1 0.001L0.72 0C0.49 0 0.25 0.067 0.13 0.259C-0.1 0.635 -0.02 1.105 0.37 1.419L13.08 11.589C13.57 11.98 14.37 11.98 14.86 11.589L27.57 1.419C27.97 1.105 28.04 0.635 27.81 0.259C27.69 0.067 27.45 0 27.22 0L14.86 0.001H13.1Z'
          }
          fill={'var(--color-bg-primary, #FDFEFF)'}
        />
      </svg>
    </div>
  );
};

const FaucetPage: FC = () => {
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  // Claim history, newest first; paginated client-side since getHistory returns a plain list.
  const HISTORY_LIMIT = 100;
  const HISTORY_PAGE_SIZE = 10;
  const {
    data: historyData,
    loading: historyLoading,
    refetch: refetchHistory,
  } = useQuery(GET_HISTORY, {
    variables: { pagination: { limit: HISTORY_LIMIT, offset: 0, sort: { field: 'createdAt', direction: 'desc' } } },
    fetchPolicy: 'network-only',
    skip: !isAuthenticated,
  });
  // Sorted here by the real claim time too: the server's createdAt can't be trusted to order (or time) the records
  const history: FaucetHistoryItem[] = useMemo(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => [...(((historyData as any)?.getHistory ?? []) as FaucetHistoryItem[])].sort((a, b) => claimedAt(b) - claimedAt(a)),
    [historyData],
  );
  // The next-claim moments come from this same history: last claim of a token + 24h
  const unlockTimes = getUnlockTimes(history);
  const unlockKnown = !!historyData;
  const [historyPage, setHistoryPage] = useState(1);
  const historyTotalPages = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
  const pagedHistory = history.slice((historyPage - 1) * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE);

  // formatUnlock/formatCooldown read Date.now() fresh on every call, so this 1s tick just
  // forces a re-render: the labels and the open tooltip count down in real time against the
  // unlock time the server reports, and a button flips back to claimable the moment it hits 0.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const now = Date.now() / 1000;
  const notReady = authLoading || !isAuthenticated || historyLoading;
  // "Claimed" (locked) is only shown once we actually know the unlock time, so the
  // buttons don't flash into the claimed state while auth/unlock data is still loading.
  const holdClaimed = !notReady && unlockTimes.holdUnlockTime > now;
  const gasClaimed = !notReady && unlockTimes.gasUnlockTime > now;
  const platformClaimed = !notReady && unlockTimes.platformUnlockTime > now;
  // A visitor who isn't signed in yet (as opposed to still loading) sees the same
  // "inactive" look as a claimed button, but clicking it prompts them to sign in
  // instead of sending a claim — Sign In itself stays reachable via the page header.
  const notAuthenticated = !authLoading && !isAuthenticated;
  const stillLoading = authLoading || historyLoading;

  const [tipOpen, setTipOpen] = useState<'hold' | 'gas' | 'platform' | null>(null);
  const openTip = (key: 'hold' | 'gas' | 'platform') => setTipOpen(key);
  const closeTip = (key: 'hold' | 'gas' | 'platform') => setTipOpen(t => (t === key ? null : t));

  const [requestHold, { loading: claimingHold }] = useMutation(REQUEST_HOLD);
  const [requestGas, { loading: claimingGas }] = useMutation(REQUEST_GAS);
  const [requestPlatform, { loading: claimingPlatform }] = useMutation(REQUEST_PLATFORM);

  const handleClaimHold = async () => {
    if (notAuthenticated) {
      toast('Sign in to claim', 'warning');
      return;
    }
    if (holdClaimed) {
      toast(`1 claim available in ${formatCooldown(unlockTimes.holdUnlockTime)}`, 'warning');
      return;
    }
    try {
      await requestHold({ variables: { input: { amount: 500 } } });
      await refetchHistory();
      toast('500 HOLD tokens sent to your wallet!');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to claim HOLD';
      toast(msg, 'error');
    }
  };

  const handleClaimGas = async () => {
    if (notAuthenticated) {
      toast('Sign in to claim', 'warning');
      return;
    }
    if (gasClaimed) {
      toast(`1 claim available in ${formatCooldown(unlockTimes.gasUnlockTime)}`, 'warning');
      return;
    }
    try {
      await requestGas({ variables: { input: { amount: 0.01 } } });
      await refetchHistory();
      toast('0.01 BNB sent to your wallet!');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to claim gas';
      toast(msg, 'error');
    }
  };

  const handleClaimPlatform = async () => {
    if (notAuthenticated) {
      toast('Sign in to claim', 'warning');
      return;
    }
    if (platformClaimed) {
      toast(`1 claim available in ${formatCooldown(unlockTimes.platformUnlockTime)}`, 'warning');
      return;
    }
    try {
      await requestPlatform({ variables: { input: { amount: 10000 } } });
      await refetchHistory();
      toast('10 000 PLT tokens sent to your wallet!');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to claim PLT';
      toast(msg, 'error');
    }
  };

  return (
    <DashboardLayout>
      <section className={'mb-12'}>
        <Wrapper>
          <Title className={'mb-2'} size={'xs'}>Testnet Faucet</Title>
          <p className={'text-base text-label-tertiary mb-10'}>
            Claim test tokens to use platform features on BSC Testnet.
          </p>

          <div className={'grid gap-4 sm:grid-cols-2 lg:grid-cols-3 max-w-4xl'}>
            <div className={'h-full p-6 border border-stroke-primary rounded-xl flex flex-col gap-4'}>
              <div>
                <div className={'text-lg font-semibold mb-1'}>HOLD Token</div>
                <div className={'text-sm text-label-tertiary min-h-10'}>Required to deploy projects and pools</div>
              </div>
              <div className={'text-2xl font-bold'}>500 HOLD</div>
              <div className={'text-sm text-label-tertiary'}>
                {unlockKnown ? formatUnlock(unlockTimes.holdUnlockTime) : '—'}
              </div>
              <div
                className={'relative mt-auto'}
                onMouseEnter={() => holdClaimed && openTip('hold')}
                onMouseLeave={() => closeTip('hold')}
              >
                <CooldownTooltip
                  open={holdClaimed && tipOpen === 'hold'}
                  text={`1 claim available in ${unlockKnown ? formatCooldown(unlockTimes.holdUnlockTime) : ''}`}
                />
                <Button
                  className={clsx('w-full', (holdClaimed || notAuthenticated) && '!bg-grey-light !text-grey-dark')}
                  visualType={'quaternary'}
                  disabled={stillLoading || claimingHold}
                  onClick={handleClaimHold}
                >
                  {claimingHold ? 'Claiming…' : holdClaimed ? 'Claimed' : 'Claim HOLD'}
                </Button>
              </div>
            </div>

            <div className={'h-full p-6 border border-stroke-primary rounded-xl flex flex-col gap-4'}>
              <div>
                <div className={'text-lg font-semibold mb-1'}>BNB Gas</div>
                <div className={'text-sm text-label-tertiary min-h-10'}>Required to pay transaction fees</div>
              </div>
              <div className={'text-2xl font-bold'}>0.01 BNB</div>
              <div className={'text-sm text-label-tertiary'}>
                {unlockKnown ? formatUnlock(unlockTimes.gasUnlockTime) : '—'}
              </div>
              <div
                className={'relative mt-auto'}
                onMouseEnter={() => gasClaimed && openTip('gas')}
                onMouseLeave={() => closeTip('gas')}
              >
                <CooldownTooltip
                  open={gasClaimed && tipOpen === 'gas'}
                  text={`1 claim available in ${unlockKnown ? formatCooldown(unlockTimes.gasUnlockTime) : ''}`}
                />
                <Button
                  className={clsx('w-full', (gasClaimed || notAuthenticated) && '!bg-grey-light !text-grey-dark')}
                  visualType={'quaternary'}
                  disabled={stillLoading || claimingGas}
                  onClick={handleClaimGas}
                >
                  {claimingGas ? 'Claiming…' : gasClaimed ? 'Claimed' : 'Claim BNB'}
                </Button>
              </div>
            </div>

            <div className={'h-full p-6 border border-stroke-primary rounded-xl flex flex-col gap-4'}>
              <div>
                <div className={'text-lg font-semibold mb-1'}>PLT Token</div>
                <div className={'text-sm text-label-tertiary min-h-10'}>Required to stake and participate in governance</div>
              </div>
              <div className={'text-2xl font-bold'}>10 000 PLT</div>
              <div className={'text-sm text-label-tertiary'}>
                {unlockKnown ? formatUnlock(unlockTimes.platformUnlockTime) : '—'}
              </div>
              <div
                className={'relative mt-auto'}
                onMouseEnter={() => platformClaimed && openTip('platform')}
                onMouseLeave={() => closeTip('platform')}
              >
                <CooldownTooltip
                  open={platformClaimed && tipOpen === 'platform'}
                  text={`1 claim available in ${unlockKnown ? formatCooldown(unlockTimes.platformUnlockTime) : ''}`}
                />
                <Button
                  className={clsx('w-full', (platformClaimed || notAuthenticated) && '!bg-grey-light !text-grey-dark')}
                  visualType={'quaternary'}
                  disabled={stillLoading || claimingPlatform}
                  onClick={handleClaimPlatform}
                >
                  {claimingPlatform ? 'Claiming…' : platformClaimed ? 'Claimed' : 'Claim PLT'}
                </Button>
              </div>
            </div>
          </div>
        </Wrapper>
      </section>

      <section className={'mb-12'}>
        <Wrapper>
          <Title className={'mb-6'} size={'xs'}>Claim history</Title>
          <div className={'max-w-4xl'}>
            <FaucetHistoryTable items={pagedHistory} isLoading={authLoading || historyLoading} />
            {history.length > HISTORY_PAGE_SIZE && (
              <div className={'mt-4 flex justify-center'}>
                <Pagination page={historyPage} totalPages={historyTotalPages} onPageChange={setHistoryPage} />
              </div>
            )}
          </div>
        </Wrapper>
      </section>
    </DashboardLayout>
  );
};

export default FaucetPage;
