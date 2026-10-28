'use client';

import React, { FC, useRef, useEffect, useState } from 'react';
import { createClient } from 'graphql-sse';
import { createChart, CandlestickSeries, HistogramSeries, ColorType, CrosshairMode, LineStyle } from 'lightweight-charts';
import { gqlFetch } from '@/lib/gqlFetch';
import { SSE_ENDPOINT } from '@/lib/config';

// ── Helpers (from demo utils.js) ──────────────────────────────────────────────

function getIntervalSeconds(interval: string): number {
  const units: Record<string, number> = { m: 60, h: 3600, d: 86400, w: 604800 };
  const value = parseInt(interval);
  const unit = interval.slice(-1);
  return value * units[unit];
}

// Parse 18-decimal wei → number (chart displays 8 decimals via priceFormat)
function parseWeiPrice(raw: string): number {
  try {
    const bigVal = BigInt(raw);
    const sign = bigVal < BigInt(0) ? '-' : '';
    const absVal = bigVal < BigInt(0) ? -bigVal : bigVal;
    const divisor = BigInt(10) ** BigInt(18);
    const integerPart = absVal / divisor;
    const fractionalPart = absVal % divisor;
    const fractionalStr = fractionalPart.toString().padStart(18, '0');
    return parseFloat(`${sign}${integerPart}.${fractionalStr}`);
  } catch {
    return 0;
  }
}

interface CandlePoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

// Fix gaps between candles (from demo main.js alignCandleData)
function alignCandleData(data: CandlePoint[]): CandlePoint[] {
  if (data.length < 2) return data;
  const aligned = data.map(c => ({ ...c }));
  for (let i = 1; i < aligned.length; i++) {
    const prev = aligned[i - 1];
    const curr = aligned[i];
    if (curr.open !== prev.close) {
      curr.open = prev.close;
      if (curr.open > curr.high) curr.high = curr.open;
      if (curr.open < curr.low) curr.low = curr.open;
    }
  }
  return aligned;
}

// ── GraphQL ──────────────────────────────────────────────────────────────────

const OHLC_QUERY = `
  query GetOhlcPriceData($input: GetOhlcPriceDataInput!) {
    getOhlcPriceData(input: $input) { timestamp open high low close }
  }
`;

const VOLUME_QUERY = `
  query GetVolumeData($input: GetVolumeDataInput!) {
    getVolumeData(input: $input) { timestamp mintVolume burnVolume }
  }
`;

const PRICE_UPDATES_SUBSCRIPTION = `
  subscription PriceUpdates($poolAddress: String!) {
    priceUpdates(poolAddress: $poolAddress) { poolAddress timestamp price }
  }
`;

// ── Component ─────────────────────────────────────────────────────────────────

interface PriceChartProps {
  poolAddress: string;
  interval: string;
  fallback?: React.ReactNode;
}

const PriceChart: FC<PriceChartProps> = ({ poolAddress, interval, fallback = null }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candleSeriesRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const volumeSeriesRef = useRef<any>(null);
  const candlesRef = useRef<CandlePoint[]>([]);

  const [loading, setLoading] = useState(true);
  const [chartData, setChartData] = useState<{
    candles: CandlePoint[];
    volume: { time: number; value: number; color: string }[];
  }>({ candles: [], volume: [] });

  const hasData = chartData.candles.length > 0;

  // ── Fetch OHLC + volume data (200 candles back) ─────────────────────────────
  useEffect(() => {
    if (!poolAddress) return;

    let cancelled = false;
    setLoading(true);

    const now = Math.floor(Date.now() / 1000);
    // Fixed 30-day lookback — covers all pool history regardless of interval
    const startTime = now - 30 * 86400;

    Promise.all([
      gqlFetch(OHLC_QUERY, { input: { poolAddress, interval, startTime, endTime: now } }),
      gqlFetch(VOLUME_QUERY, { input: { poolAddress, interval, startTime, endTime: now } }),
    ])
      .then(([ohlcResult, volResult]) => {
        if (cancelled) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ohlc = ((ohlcResult.getOhlcPriceData ?? []) as any[])
          .map(d => ({
            time: d.timestamp as number,
            open: parseWeiPrice(d.open),
            high: parseWeiPrice(d.high),
            low: parseWeiPrice(d.low),
            close: parseWeiPrice(d.close),
          }))
          .filter(d => d.close > 0)
          .sort((a, b) => a.time - b.time) as CandlePoint[];

        const aligned = alignCandleData(ohlc);
        candlesRef.current = aligned;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const volume = ((volResult.getVolumeData ?? []) as any[])
          .map(d => {
            const mint = Number(d.mintVolume || '0');
            const burn = Number(d.burnVolume || '0');
            return {
              time: d.timestamp as number,
              value: mint + burn,
              color: mint >= burn ? '#26a69a' : '#ef5350',
            };
          })
          .filter(d => d.value > 0)
          .sort((a, b) => a.time - b.time);

        setChartData({ candles: aligned, volume });
        setLoading(false);
      })
      .catch(err => {
        console.error('Chart data fetch error:', err);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [poolAddress, interval]);

  // ── Create chart when data appears ──────────────────────────────────────────
  useEffect(() => {
    if (!chartContainerRef.current || !hasData) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9B9BA5',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#E8ECF2' },
        horzLines: { color: '#E8ECF2' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { width: 1, color: '#1D58E9', style: LineStyle.Dashed },
        horzLine: { width: 1, color: '#1D58E9', style: LineStyle.Dashed },
      },
      rightPriceScale: { borderColor: '#C2D0EB' },
      timeScale: { borderColor: '#C2D0EB', timeVisible: true, secondsVisible: false },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: true,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      borderUpColor: '#26a69a',
      borderDownColor: '#ef5350',
      priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 },
    });

    candleSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.1, bottom: 0.3 },
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.7, bottom: 0 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.offsetWidth,
          height: chartContainerRef.current.offsetHeight,
        });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [hasData]);

  // ── Update data on chart when chartData changes ─────────────────────────────
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;
    candleSeriesRef.current.setData(chartData.candles);
    volumeSeriesRef.current.setData(chartData.volume);
    chartRef.current?.timeScale().fitContent();
  }, [chartData, hasData]);

  // ── SSE live updates (from demo api.js + main.js) ────────────────────────────
  useEffect(() => {
    if (!poolAddress) return;

    let cancelled = false;
    let dispose: (() => void) | undefined;

    const connect = async () => {
      if (cancelled) return;

      const sseClient = createClient({
        url: SSE_ENDPOINT,
      });

      dispose = sseClient.subscribe(
        {
          query: PRICE_UPDATES_SUBSCRIPTION,
          variables: { poolAddress },
        },
        {
          next: (result) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const update = (result as any)?.data?.priceUpdates;
            if (!update) return;

            const price = parseWeiPrice(update.price);
            if (price <= 0) return;

            const intervalSecs = getIntervalSeconds(interval);
            const candleTime = Math.floor(update.timestamp / intervalSecs) * intervalSecs;

            const candles = candlesRef.current;
            const lastCandle = candles.length > 0 ? candles[candles.length - 1] : null;

            if (lastCandle && lastCandle.time === candleTime) {
              // Update existing candle
              lastCandle.close = price;
              if (price > lastCandle.high) lastCandle.high = price;
              if (price < lastCandle.low) lastCandle.low = price;
              candleSeriesRef.current?.update(lastCandle);
            } else if (lastCandle && candleTime > lastCandle.time) {
              // New candle — open = previous close
              const newCandle: CandlePoint = {
                time: candleTime,
                open: lastCandle.close,
                high: price,
                low: price,
                close: price,
              };
              candles.push(newCandle);
              candleSeriesRef.current?.update(newCandle);
            }
          },
          error: (err) => console.error('SSE error:', err),
          complete: () => {},
        }
      );
    };

    connect();

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [poolAddress, interval]);

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading && !hasData) {
    return (
      <div className='flex items-center justify-center py-16 text-sm text-label-tertiary'>
        Loading…
      </div>
    );
  }

  if (!hasData) {
    return <>{fallback}</>;
  }

  return (
    <div className='w-full'>
      <div ref={chartContainerRef} className='w-full' style={{ height: 400 }} />
    </div>
  );
};

export default PriceChart;