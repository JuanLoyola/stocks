/**
 * universe.ts — Curated asset list for the ticker dropdowns.
 *
 * Why static? The target user doesn't know tickers by heart, so we hand them
 * a small, curated menu of well-known assets instead of making them guess
 * (or burning Alpha Vantage quota on SYMBOL_SEARCH). Two categories:
 *
 *   - "traditional": equities priced via Alpha Vantage (GLOBAL_QUOTE)
 *   - "crypto":      pairs priced via Coinbase spot (e.g. BTC-USD)
 *
 * The category drives the badge in the UI AND the price source in
 * /api/price (which currently infers crypto from the "-USD" suffix — keep
 * both in sync when editing this list).
 */

export type AssetCategory = 'traditional' | 'crypto';

export interface Asset {
  /** Symbol used everywhere in the app (equity: AAPL, crypto: BTC-USD). */
  ticker: string;
  /** Human-readable name, shown in the dropdown. */
  name: string;
  category: AssetCategory;
}

export const ASSETS: Asset[] = [
  // ---- Traditional (equities) ----
  { ticker: 'AAPL', name: 'Apple', category: 'traditional' },
  { ticker: 'MSFT', name: 'Microsoft', category: 'traditional' },
  { ticker: 'NVDA', name: 'NVIDIA', category: 'traditional' },
  { ticker: 'GOOGL', name: 'Alphabet (Google)', category: 'traditional' },
  { ticker: 'AMZN', name: 'Amazon', category: 'traditional' },
  { ticker: 'META', name: 'Meta Platforms', category: 'traditional' },
  { ticker: 'TSLA', name: 'Tesla', category: 'traditional' },
  { ticker: 'NFLX', name: 'Netflix', category: 'traditional' },
  { ticker: 'AMD', name: 'AMD', category: 'traditional' },
  { ticker: 'INTC', name: 'Intel', category: 'traditional' },
  { ticker: 'DIS', name: 'Walt Disney', category: 'traditional' },
  { ticker: 'JPM', name: 'JPMorgan Chase', category: 'traditional' },
  { ticker: 'V', name: 'Visa', category: 'traditional' },
  { ticker: 'WMT', name: 'Walmart', category: 'traditional' },
  { ticker: 'KO', name: 'Coca-Cola', category: 'traditional' },
  { ticker: 'JNJ', name: 'Johnson & Johnson', category: 'traditional' },
  { ticker: 'XOM', name: 'ExxonMobil', category: 'traditional' },
  { ticker: 'BA', name: 'Boeing', category: 'traditional' },
  { ticker: 'ORCL', name: 'Oracle', category: 'traditional' },
  { ticker: 'CRM', name: 'Salesforce', category: 'traditional' },
  { ticker: 'ADBE', name: 'Adobe', category: 'traditional' },
  { ticker: 'UBER', name: 'Uber', category: 'traditional' },
  { ticker: 'PYPL', name: 'PayPal', category: 'traditional' },
  { ticker: 'NKE', name: 'Nike', category: 'traditional' },
  { ticker: 'SBUX', name: 'Starbucks', category: 'traditional' },

  // ---- Crypto ----
  { ticker: 'BTC-USD', name: 'Bitcoin', category: 'crypto' },
  { ticker: 'ETH-USD', name: 'Ethereum', category: 'crypto' },
  { ticker: 'SOL-USD', name: 'Solana', category: 'crypto' },
  { ticker: 'XRP-USD', name: 'XRP', category: 'crypto' },
  { ticker: 'DOGE-USD', name: 'Dogecoin', category: 'crypto' },
  { ticker: 'ADA-USD', name: 'Cardano', category: 'crypto' },
  { ticker: 'BNB-USD', name: 'BNB', category: 'crypto' },
  { ticker: 'LINK-USD', name: 'Chainlink', category: 'crypto' },
];

const BY_TICKER = new Map(ASSETS.map((a) => [a.ticker, a]));

export function getAsset(ticker: string): Asset | undefined {
  return BY_TICKER.get(ticker);
}

export function categoryOf(ticker: string): AssetCategory | undefined {
  return BY_TICKER.get(ticker)?.category;
}

/** Case-insensitive match of a query against ticker or name. */
export function searchAssets(query: string): Asset[] {
  const q = query.trim().toLowerCase();
  if (!q) return ASSETS;
  return ASSETS.filter(
    (a) => a.ticker.toLowerCase().includes(q) || a.name.toLowerCase().includes(q),
  );
}
