'use client';

/**
 * TickerSelect — searchable dropdown for picking an asset.
 *
 * Designed for people who don't know tickers: type "bit" → Bitcoin appears.
 * Options are grouped by category (Traditional / Crypto) with a colored badge.
 * Keyboard accessible (Enter/Escape/arrows), closes on outside click.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { getAsset, searchAssets, type Asset, type AssetCategory } from '@/lib/universe';

const CATEGORY_LABEL: Record<AssetCategory, string> = {
  traditional: 'Traditional',
  crypto: 'Crypto',
};

const CATEGORY_STYLE: Record<AssetCategory, string> = {
  traditional: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  crypto: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',
};

/** First-letter avatar, colored by category. */
function Avatar({ asset }: { asset: Asset }) {
  return (
    <span
      aria-hidden
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-1 ${
        asset.category === 'crypto'
          ? 'bg-violet-500/20 text-violet-200 ring-violet-500/40'
          : 'bg-sky-500/20 text-sky-200 ring-sky-500/40'
      }`}
    >
      {asset.name.charAt(0)}
    </span>
  );
}

export function TickerSelect({
  value,
  onChange,
  label,
  id,
}: {
  /** Currently selected ticker, e.g. "AAPL" or "BTC-USD". */
  value: string;
  onChange: (ticker: string) => void;
  label: string;
  id: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = value ? getAsset(value) : undefined;
  const results = useMemo(() => searchAssets(query), [query]);

  // Group results: traditional first, then crypto.
  const groups = useMemo(() => {
    const byCategory = { traditional: [] as Asset[], crypto: [] as Asset[] };
    for (const a of results) byCategory[a.category].push(a);
    return byCategory;
  }, [results]);

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Reset search state when opening — done in the open handler rather than
  // an effect to avoid setState-in-effect cascading renders.
  const openPanel = () => {
    setQuery('');
    setActive(0);
    setOpen(true);
    // Focus after the panel renders.
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const choose = (ticker: string) => {
    onChange(ticker);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[active]) choose(results[active].ticker);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={openPanel}
        className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left text-sm transition hover:border-white/25 hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
      >
        {selected ? (
          <>
            <Avatar asset={selected} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-white">{selected.name}</span>
              <span className="block text-xs text-zinc-500">{selected.ticker}</span>
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${CATEGORY_STYLE[selected.category]}`}
            >
              {CATEGORY_LABEL[selected.category]}
            </span>
          </>
        ) : (
          <span className="flex-1 text-zinc-400">Select an asset…</span>
        )}
        <svg className="h-4 w-4 shrink-0 text-zinc-500" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={label}
          className="absolute z-30 mt-2 w-full overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl shadow-black/50 backdrop-blur-xl"
        >
          <div className="border-b border-white/10 p-2">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search name or ticker…"
              className="w-full rounded-lg bg-white/[0.06] px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
          </div>

          <div className="max-h-64 overflow-y-auto p-1.5">
            {results.length === 0 && (
              <p className="px-3 py-4 text-center text-sm text-zinc-500">
                No assets match “{query}”.
              </p>
            )}

            {(['traditional', 'crypto'] as const).map((cat) =>
              groups[cat].length > 0 ? (
                <div key={cat} className="mb-1">
                  <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    {CATEGORY_LABEL[cat]}
                  </p>
                  {groups[cat].map((asset) => {
                    const index = results.indexOf(asset);
                    const isActive = index === active;
                    const isSelected = asset.ticker === value;
                    return (
                      <button
                        key={asset.ticker}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => choose(asset.ticker)}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition ${
                          isActive ? 'bg-emerald-500/15' : 'hover:bg-white/[0.06]'
                        }`}
                      >
                        <Avatar asset={asset} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-white">
                            {asset.name}
                          </span>
                          <span className="block text-xs text-zinc-500">{asset.ticker}</span>
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${CATEGORY_STYLE[asset.category]}`}
                        >
                          {CATEGORY_LABEL[asset.category]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null,
            )}
          </div>
        </div>
      )}
    </div>
  );
}
