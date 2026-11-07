'use client';

import React, { FC } from 'react';
import { toast } from '@/components/ui';
import { claimedAt } from '@/lib/faucet/cooldown';

export interface FaucetHistoryItem {
  id: string;
  tokenType: 'gas' | 'hold' | 'platform';
  amount: number;
  transactionHash: string;
  createdAt: number; // unix seconds
}

const TOKEN_LABELS: Record<FaucetHistoryItem['tokenType'], string> = {
  hold: 'HOLD',
  gas: 'BNB',
  platform: 'PLT',
};

const EXPLORER_TX_URL = 'https://testnet.bscscan.com/tx/';

function formatDateTime(ts: number): string {
  const d = new Date(ts * 1000);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yy} ${hh}:${min}`;
}

function truncateHash(hash: string): string {
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}

const CopyIcon: FC = () => (
  <svg width={'14'} height={'14'} viewBox={'0 0 14 14'} fill={'none'} xmlns={'http://www.w3.org/2000/svg'}>
    <rect x={'4.5'} y={'4.5'} width={'8'} height={'8'} rx={'1'} stroke={'#959EB5'} />
    <path d={'M1.5 9.5V2a1 1 0 0 1 1-1h7.5'} stroke={'#959EB5'} strokeLinecap={'round'} />
  </svg>
);

const SkeletonRow: FC = () => <div className={'bg-bg-primary border border-stroke-primary h-[52px] animate-pulse bg-bg-tertiary/40'} />;

interface FaucetHistoryTableProps {
  items: FaucetHistoryItem[];
  isLoading: boolean;
}

const FaucetHistoryTable: FC<FaucetHistoryTableProps> = ({ items, isLoading }) => {
  const handleCopy = (hash: string) => {
    navigator.clipboard.writeText(hash);
    toast('TXID copied to clipboard');
  };

  return (
    <>
      {/* Desktop table */}
      <div className={'max-lg:hidden rounded-b-lg'}>
        <div className={'bg-bg-primary border-x border-t border-b border-stroke-primary rounded-t-lg h-[52px] flex items-center px-3 gap-2'}>
          <span className={'text-sm font-medium text-grey-dark flex-1'}>Token</span>
          <span className={'text-sm font-medium text-grey-dark flex-1 text-right'}>Amount</span>
          <span className={'text-sm font-medium text-grey-dark flex-1 text-right'}>Date</span>
          <span className={'text-sm font-medium text-grey-dark flex-1 text-right'}>TXID</span>
        </div>

        <div className={'flex flex-col'}>
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className={'-mt-px'}>
                <SkeletonRow />
              </div>
            ))
          ) : items.length === 0 ? (
            <div className={'py-12 text-center text-sm text-label-tertiary border-x border-b border-stroke-primary'}>
              No claims yet.
            </div>
          ) : (
            items.map(item => (
              <div key={item.id} className={'-mt-px bg-bg-primary border border-stroke-primary h-[52px] flex items-center px-3 gap-2'}>
                <span className={'text-sm text-black flex-1 truncate'}>{TOKEN_LABELS[item.tokenType] ?? item.tokenType}</span>
                <span className={'text-sm text-black flex-1 text-right'}>{item.amount.toLocaleString()}</span>
                <span className={'text-sm text-blue flex-1 text-right'}>{formatDateTime(claimedAt(item))}</span>
                <span className={'flex-1 flex items-center justify-end gap-2 text-sm text-black'}>
                  <a
                    href={`${EXPLORER_TX_URL}${item.transactionHash}`}
                    target={'_blank'}
                    rel={'noopener noreferrer'}
                    className={'hover:underline'}
                  >
                    {truncateHash(item.transactionHash)}
                  </a>
                  <button type={'button'} onClick={() => handleCopy(item.transactionHash)} className={'cursor-pointer'} aria-label={'Copy TXID'}>
                    <CopyIcon />
                  </button>
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Mobile cards */}
      <div className={'lg:hidden flex flex-col gap-3'}>
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)
        ) : items.length === 0 ? (
          <div className={'py-12 text-center text-sm text-label-tertiary'}>No claims yet.</div>
        ) : (
          items.map(item => (
            <div key={item.id} className={'bg-bg-tertiary rounded-2xl p-4 flex flex-col gap-3'}>
              <div>
                <p className={'text-lg font-bold text-black'}>
                  {item.amount.toLocaleString()} {TOKEN_LABELS[item.tokenType] ?? item.tokenType}
                </p>
                <p className={'text-sm text-grey-dark'}>{formatDateTime(claimedAt(item))}</p>
              </div>

              <div className={'border border-stroke-primary rounded-lg px-3 py-2.5'}>
                <p className={'text-xs text-grey-dark mb-0.5'}>TXID</p>
                <span className={'flex items-center justify-between gap-1.5 text-sm font-semibold text-black'}>
                  <a href={`${EXPLORER_TX_URL}${item.transactionHash}`} target={'_blank'} rel={'noopener noreferrer'}>
                    {truncateHash(item.transactionHash)}
                  </a>
                  <button type={'button'} onClick={() => handleCopy(item.transactionHash)} className={'cursor-pointer'} aria-label={'Copy TXID'}>
                    <CopyIcon />
                  </button>
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
};

export default FaucetHistoryTable;
