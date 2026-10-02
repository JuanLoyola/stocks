'use client';

/**
 * Portfolio rebalance UI.
 *
 * - Holdings + target allocation are edited with asset dropdowns (curated
 *   list, grouped Traditional / Crypto) so users don't need to know tickers.
 * - Everything persists to localStorage (portfolio:holdings,
 *   portfolio:allocation, portfolio:lastPrices).
 * - Prices come from /api/price (server-side proxy, key never exposed).
 * - On rate limit / missing price we fall back to portfolio:lastPrices and
 *   show the notice (spec 6.2.4 / FR-15).
 * - The rebalance math lives in src/lib/portfolio.ts via StaticStock.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Portfolio, StaticStock, type RebalanceResult } from '@/lib/portfolio';
import { TickerSelect } from '@/components/ticker-select';
import { categoryOf } from '@/lib/universe';

interface Holding {
  ticker: string;
  quantity: number;
}

interface Allocation {
  ticker: string;
  percent: number;
}

const LS_HOLDINGS = 'portfolio:holdings';
const LS_ALLOCATION = 'portfolio:allocation';
const LS_LAST_PRICES = 'portfolio:lastPrices';

/** Demo default: 40% META / 60% AAPL (FR-14). */
const DEFAULT_HOLDINGS: Holding[] = [
  { ticker: 'META', quantity: 10 },
  { ticker: 'AAPL', quantity: 15 },
];
const DEFAULT_ALLOCATION: Allocation[] = [
  { ticker: 'META', percent: 40 },
  { ticker: 'AAPL', percent: 60 },
];

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — spec EC-8: keep working */
  }
}

/* ------------------------------------------------------------------ */
/* Small presentational helpers                                       */
/* ------------------------------------------------------------------ */

function Card({
  title,
  accent,
  onAdd,
  children,
}: {
  title: string;
  accent: 'emerald' | 'violet';
  onAdd: () => void;
  children: React.ReactNode;
}) {
  const dot = accent === 'emerald' ? 'bg-emerald-400' : 'bg-violet-400';
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-sm sm:p-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="flex items-center gap-2.5 text-base font-semibold text-white">
          <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
          {title}
        </h2>
        <button
          type="button"
          onClick={onAdd}
          className="cursor-pointer rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-white/30 hover:bg-white/[0.12]"
        >
          + Add
        </button>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="shrink-0 cursor-pointer rounded-xl border border-transparent p-2.5 text-zinc-500 transition hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400"
    >
      {children}
    </button>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <div className="relative w-full shrink-0 sm:w-28">
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step="any"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 pr-7 text-sm text-white transition focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {suffix && (
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-500">
          {suffix}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Skeletons                                                           */
/* ------------------------------------------------------------------ */

/** A single shimmering bar; sizes come from className. */
function Bone({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`skeleton rounded-lg ${className}`} />;
}

/** Full-page skeleton shown before localStorage hydration completes. */
function PageSkeleton() {
  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto max-w-5xl space-y-10">
        <div className="space-y-4 text-center">
          <Bone className="mx-auto h-6 w-48 rounded-full" />
          <Bone className="mx-auto h-10 w-72 sm:h-12 sm:w-96" />
          <Bone className="mx-auto h-4 w-64 max-w-full" />
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-6"
            >
              <Bone className="mb-5 h-5 w-32" />
              {[0, 1].map((j) => (
                <div key={j} className="mb-3 flex gap-2">
                  <Bone className="h-11 flex-1" />
                  <Bone className="h-11 w-full sm:w-28" />
                </div>
              ))}
            </div>
          ))}
        </div>
        <Bone className="mx-auto h-12 w-40 rounded-2xl" />
      </div>
    </div>
  );
}

/** Skeleton mimicking the buy/sell result cards while prices load. */
function ResultsSkeleton() {
  return (
    <section aria-busy="true" aria-live="polite" className="mt-12 space-y-5">
      <span className="sr-only">Fetching prices…</span>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <Bone className="h-6 w-44" />
        <Bone className="h-8 w-52 rounded-full" />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {['emerald', 'red'].map((color) => (
          <div
            key={color}
            className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]"
          >
            <div className="flex items-center justify-between bg-white/[0.04] px-4 py-4 sm:px-6">
              <Bone className="h-4 w-16" />
              <Bone className="h-5 w-7 rounded-full" />
            </div>
            <div className="space-y-3 p-4 sm:p-6">
              {[0, 1, 2].map((j) => (
                <div key={j} className="flex items-center justify-between gap-3">
                  <Bone className="h-4 w-16" />
                  <Bone className="h-4 w-20" />
                  <Bone className="h-4 w-20" />
                  <Bone className="h-4 w-16" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */

export default function Home() {
  const [hydrated, setHydrated] = useState(false);
  const [holdings, setHoldings] = useState<Holding[]>(DEFAULT_HOLDINGS);
  const [allocation, setAllocation] = useState<Allocation[]>(DEFAULT_ALLOCATION);
  const [result, setResult] = useState<RebalanceResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Restore from localStorage after mount to avoid SSR hydration mismatch
  // (EC-8). setState-in-effect is intentional: localStorage only exists on
  // the client, so this is the standard "load external store after mount"
  // pattern, not a cascading render.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHoldings(load(LS_HOLDINGS, DEFAULT_HOLDINGS));
    setAllocation(load(LS_ALLOCATION, DEFAULT_ALLOCATION));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) save(LS_HOLDINGS, holdings);
  }, [holdings, hydrated]);

  useEffect(() => {
    if (hydrated) save(LS_ALLOCATION, allocation);
  }, [allocation, hydrated]);

  const allocationSum = useMemo(
    () => allocation.reduce((acc, a) => acc + (Number.isFinite(a.percent) ? a.percent : 0), 0),
    [allocation],
  );

  const sumOk = Math.abs(allocationSum - 100) < 1e-6;

  const updateHolding = (i: number, patch: Partial<Holding>) =>
    setHoldings((prev) => prev.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));

  const updateAllocation = (i: number, patch: Partial<Allocation>) =>
    setAllocation((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));

  /** Pick a free default ticker so two rows never collide. */
  const nextFreeTicker = (taken: string[]): string => {
    const order = ['AAPL', 'MSFT', 'BTC-USD', 'ETH-USD', 'NVDA', 'TSLA'];
    return order.find((t) => !taken.includes(t)) ?? '';
  };

  const runRebalance = useCallback(async () => {
    setError(null);
    setNotice(null);

    if (holdings.length === 0) {
      setError('Cannot rebalance an empty portfolio');
      return;
    }
    if (!sumOk) {
      setError(`Allocation must sum to 100%, got ${Math.round(allocationSum * 100) / 100}%`);
      return;
    }

    const tickers = [
      ...new Set([...holdings.map((h) => h.ticker), ...allocation.map((a) => a.ticker)]),
    ].filter(Boolean);

    setLoading(true);
    try {
      const res = await fetch(`/api/price?symbols=${tickers.join(',')}`);
      if (!res.ok) throw new Error(`Price API returned ${res.status}`);
      const data: {
        prices: Record<string, { price: number; source: string }>;
        errors: Record<string, string>;
        rateLimited: boolean;
      } = await res.json();

      // Merge fresh prices with last-known ones for symbols that failed.
      const lastPrices = load<Record<string, number>>(LS_LAST_PRICES, {});
      const merged: Record<string, number> = {};
      const missing: string[] = [];

      for (const ticker of tickers) {
        if (data.prices[ticker]) {
          merged[ticker] = data.prices[ticker].price;
        } else if (typeof lastPrices[ticker] === 'number') {
          merged[ticker] = lastPrices[ticker];
        } else {
          missing.push(ticker);
        }
      }

      if (missing.length > 0) {
        setError(`Could not fetch prices for ${missing.join(', ')}. Try again later.`);
        return;
      }

      if (data.rateLimited) {
        setNotice('Rate limit reached — showing last known prices');
      } else if (Object.keys(data.errors).length > 0) {
        setNotice('Some prices unavailable — showing last known prices');
      }

      // Persist fetched prices for future fallbacks (FR-15).
      save(LS_LAST_PRICES, {
        ...lastPrices,
        ...Object.fromEntries(Object.entries(data.prices).map(([t, v]) => [t, v.price])),
      });

      // Run the documented rebalance logic (lib/portfolio.ts).
      // `tickers` is the deduped union of holdings + allocation, so each
      // ticker gets registered exactly once.
      const portfolio = new Portfolio();
      for (const t of tickers) {
        portfolio.addStock(new StaticStock(t, merged[t]));
      }
      for (const h of holdings) portfolio.addHolding(h.ticker, h.quantity);
      portfolio.setAllocation(Object.fromEntries(allocation.map((a) => [a.ticker, a.percent])));

      setResult(await portfolio.rebalance());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not fetch prices. Try again later.');
    } finally {
      setLoading(false);
    }
  }, [holdings, allocation, allocationSum, sumOk]);

  const fmt = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

  if (!hydrated) return <PageSkeleton />; // localStorage not read yet (EC-8)

  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      {/* Ambient background: drifting gradient blobs + subtle grid.
          Blobs are wrapped in a positioning div so the CSS keyframe
          transform never fights the Tailwind centering transform. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-80 w-[34rem] -translate-x-1/2 sm:h-96 sm:w-[42rem]">
          <div className="blob-a h-full w-full rounded-full bg-emerald-500/35 blur-[90px]" />
        </div>
        <div className="absolute -bottom-32 -right-24 h-72 w-72 sm:h-96 sm:w-96">
          <div className="blob-b h-full w-full rounded-full bg-violet-600/30 blur-[100px]" />
        </div>
        <div className="absolute top-1/3 -left-20 h-56 w-56 sm:h-80 sm:w-80">
          <div className="blob-c h-full w-full rounded-full bg-sky-500/25 blur-[90px]" />
        </div>
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
      </div>

      <main className="relative mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        {/* Hero */}
        <header className="mb-8 text-center sm:mb-12">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-medium text-emerald-300 sm:px-4 sm:text-xs">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            Live prices · Alpha Vantage + Coinbase
          </p>
          <h1 className="bg-gradient-to-br from-white via-zinc-200 to-zinc-500 bg-clip-text text-3xl font-bold tracking-tight text-transparent sm:text-5xl">
            Portfolio Rebalance
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-zinc-400">
            Pick your assets from the list — no tickers needed. Set how much of each
            you want, and we&apos;ll tell you exactly what to buy and sell.
          </p>
        </header>

        {/* Editors */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card
            title="Holdings"
            accent="emerald"
            onAdd={() =>
              setHoldings((p) => [
                ...p,
                { ticker: nextFreeTicker(p.map((h) => h.ticker)), quantity: 1 },
              ])
            }
          >
            {holdings.length === 0 && (
              <p className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-zinc-500">
                No holdings yet — add your first asset.
              </p>
            )}
            {holdings.map((h, i) => (
              <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <TickerSelect
                    id={`holding-${i}`}
                    label={`Holding ${i + 1} asset`}
                    value={h.ticker}
                    onChange={(t) => updateHolding(i, { ticker: t })}
                  />
                </div>
                <NumberInput
                  label="Quantity"
                  value={h.quantity}
                  min={0}
                  onChange={(n) => updateHolding(i, { quantity: n })}
                />
                <IconButton label={`Remove holding ${h.ticker || i + 1}`} onClick={() => setHoldings((p) => p.filter((_, idx) => idx !== i))}>
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                  </svg>
                </IconButton>
              </div>
            ))}
          </Card>

          <Card
            title="Target allocation"
            accent="violet"
            onAdd={() =>
              setAllocation((p) => [
                ...p,
                { ticker: nextFreeTicker(p.map((a) => a.ticker)), percent: 0 },
              ])
            }
          >
            {allocation.map((a, i) => (
              <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <TickerSelect
                    id={`allocation-${i}`}
                    label={`Allocation ${i + 1} asset`}
                    value={a.ticker}
                    onChange={(t) => updateAllocation(i, { ticker: t })}
                  />
                </div>
                <NumberInput
                  label="Percent"
                  value={a.percent}
                  min={0}
                  max={100}
                  suffix="%"
                  onChange={(n) => updateAllocation(i, { percent: n })}
                />
                <IconButton label={`Remove allocation ${a.ticker || i + 1}`} onClick={() => setAllocation((p) => p.filter((_, idx) => idx !== i))}>
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                  </svg>
                </IconButton>
              </div>
            ))}

            {/* Allocation progress */}
            <div className="pt-2">
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="text-zinc-500">Total allocated</span>
                <span className={`font-semibold ${sumOk ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {Math.round(allocationSum * 100) / 100}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    sumOk ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                  style={{ width: `${Math.min(allocationSum, 100)}%` }}
                />
              </div>
            </div>
          </Card>
        </div>

        {/* CTA */}
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={runRebalance}
            disabled={loading}
            className="group relative cursor-pointer overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-400 to-teal-500 px-8 py-3.5 text-base font-semibold text-zinc-950 shadow-lg shadow-emerald-500/25 transition hover:shadow-xl hover:shadow-emerald-500/40 sm:px-10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="relative z-10 flex items-center gap-2">
              {loading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Fetching prices…
                </>
              ) : (
                'Rebalance'
              )}
            </span>
          </button>
        </div>

        {/* Alerts */}
        <div className="mt-6 space-y-3">
          {notice && (
            <p
              role="status"
              className="mx-auto max-w-2xl rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-3.5 text-center text-sm text-amber-200"
            >
              {notice}
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="mx-auto max-w-2xl rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-3.5 text-center text-sm text-red-300"
            >
              {error}
            </p>
          )}
        </div>

        {/* Results (or skeleton while fetching prices) */}
        {loading ? (
          <ResultsSkeleton />
        ) : (
          result &&
          !error && (
          <section className="mt-12 space-y-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-xl font-semibold text-white">Rebalance actions</h2>
              <div className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-sm">
                <span className="text-zinc-500">Portfolio value</span>{' '}
                <span className="font-semibold text-white">{fmt(result.totalValue)}</span>
              </div>
            </div>

            {result.balanced ? (
              <p className="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 px-6 py-5 text-center text-sm font-medium text-emerald-300">
                ✓ Portfolio is already balanced
              </p>
            ) : (
              <div className="grid gap-6 md:grid-cols-2">
                <ActionTable title="Buy" actions={result.buys} kind="buy" fmt={fmt} />
                <ActionTable title="Sell" actions={result.sells} kind="sell" fmt={fmt} />
              </div>
            )}

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Prices used
              </h3>
              <ul className="flex flex-wrap gap-2">
                {Object.entries(result.prices).map(([t, p]) => (
                  <li
                    key={t}
                    className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-sm"
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        categoryOf(t) === 'crypto' ? 'bg-violet-400' : 'bg-sky-400'
                      }`}
                    />
                    <span className="font-medium text-zinc-200">{t}</span>
                    <span className="text-zinc-500">{fmt(p)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
          )
        )}
      </main>
    </div>
  );
}

function ActionTable({
  title,
  actions,
  kind,
  fmt,
}: {
  title: string;
  actions: RebalanceResult['buys'];
  kind: 'buy' | 'sell';
  fmt: (n: number) => string;
}) {
  const buy = kind === 'buy';
  return (
    <div
      className={`overflow-hidden rounded-3xl border bg-white/[0.03] backdrop-blur-sm ${
        buy ? 'border-emerald-500/25' : 'border-red-500/25'
      }`}
    >
      <div
        className={`flex items-center justify-between px-4 py-4 sm:px-6 ${
          buy ? 'bg-emerald-500/10' : 'bg-red-500/10'
        }`}
      >
        <h3 className={`text-sm font-semibold uppercase tracking-wider ${buy ? 'text-emerald-300' : 'text-red-300'}`}>
          {title}
        </h3>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            buy ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
          }`}
        >
          {actions.length}
        </span>
      </div>

      {actions.length === 0 ? (
        <p className="px-6 py-6 text-center text-sm text-zinc-500">
          Nothing to {title.toLowerCase()}.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[22rem] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="px-4 py-3 font-medium sm:px-6">Asset</th>
                <th className="px-2 py-3 text-right font-medium">Current</th>
                <th className="px-2 py-3 text-right font-medium">Target</th>
                <th className="px-4 py-3 text-right font-medium sm:px-6">{title}</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((a) => (
                <tr key={a.ticker} className="border-t border-white/[0.06]">
                  <td className="px-4 py-3.5 sm:px-6">
                    <span className="font-medium text-white">{a.ticker}</span>
                  </td>
                  <td className="px-2 py-3.5 text-right text-zinc-400">{fmt(a.currentValue)}</td>
                  <td className="px-2 py-3.5 text-right text-zinc-400">{fmt(a.targetValue)}</td>
                  <td
                    className={`px-4 py-3.5 text-right font-semibold sm:px-6 ${
                      buy ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {fmt(Math.abs(a.difference))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
