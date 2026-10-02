/**
 * GET /api/price?symbols=AAPL,META,BTC-USD
 *
 * Server-side price proxy (FR-12). The Alpha Vantage key lives in
 * process.env.ALPHAVANTAGE_API_KEY and never reaches the client.
 *
 * - Equities  -> Alpha Vantage GLOBAL_QUOTE (free tier: 25 req/day)
 * - Crypto    -> Coinbase public spot price (no key needed)
 *
 * Response shape:
 *   {
 *     prices: { AAPL: { price: 330.32, source: "alphavantage" }, ... },
 *     errors: { TSLA: "rate limit" | "not found" | ... },   // per-symbol
 *     rateLimited: boolean                                  // any AV limit hit
 *   }
 *
 * Per-symbol errors let the client fall back to its last-known price in
 * localStorage (spec 6.2.4) instead of failing the whole request.
 */

const ALPHA_VANTAGE_URL = 'https://www.alphavantage.co/query';
const COINBASE_URL = 'https://api.coinbase.com/v2/prices';

/**
 * Alpha Vantage free tier allows ~1 request/second (in addition to 25/day).
 * We enforce that spacing server-side: the timestamp of the last AV call.
 */
const MIN_AV_INTERVAL_MS = 1100;
let lastAvCallAt = 0;

async function throttleAlphaVantage(): Promise<void> {
  const wait = lastAvCallAt + MIN_AV_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAvCallAt = Date.now();
}

/** Symbols with a dash and USD/USDT quote are treated as crypto pairs. */
function isCrypto(symbol: string): boolean {
  return /^[A-Z0-9]+-(USD|USDT|USDC)$/.test(symbol);
}

type PriceResult =
  | { price: number; source: 'alphavantage' | 'coinbase' }
  | { error: string };

async function fetchEquityOnce(symbol: string): Promise<PriceResult> {
  const key = process.env.ALPHAVANTAGE_API_KEY;
  if (!key) return { error: 'missing API key' };

  await throttleAlphaVantage();
  const url = `${ALPHA_VANTAGE_URL}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${key}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
  if (!res.ok) return { error: `upstream ${res.status}` };

  const data = await res.json();

  // Alpha Vantage reports rate limits / errors in the body with HTTP 200.
  const note: string = data.Note ?? data.Information ?? data['Error Message'] ?? '';
  if (/rate limit|frequency|too many|sparingly/i.test(note)) return { error: 'rate limit' };
  if (note) return { error: note };

  const price = Number(data['Global Quote']?.['05. price']);
  if (!Number.isFinite(price) || price <= 0) return { error: 'not found' };
  return { price, source: 'alphavantage' };
}

/**
 * First attempt, then one retry after a pause: the per-second burst limit
 * shows up as `rate limit` even though the daily quota is fine, and a retry
 * recovers it without bothering the user (E-6).
 */
async function fetchEquity(symbol: string): Promise<PriceResult> {
  const first = await fetchEquityOnce(symbol);
  if (!('error' in first) || first.error !== 'rate limit') return first;

  await new Promise((r) => setTimeout(r, 1200));
  const second = await fetchEquityOnce(symbol);
  if (!('error' in second) || second.error !== 'rate limit') return second;

  // Still limited: distinguish "daily quota exhausted" from a burst hiccup
  // is not possible from the body alone, so report rate limit either way.
  return { error: 'rate limit' };
}

async function fetchCrypto(symbol: string): Promise<PriceResult> {
  const url = `${COINBASE_URL}/${encodeURIComponent(symbol)}/spot`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return { error: `upstream ${res.status}` };

  const data = await res.json();
  const price = Number(data?.data?.amount);
  if (!Number.isFinite(price) || price <= 0) return { error: 'not found' };
  return { price, source: 'coinbase' };
}

export async function GET(request: Request): Promise<Response> {
  const symbols = new URL(request.url)
    .searchParams.get('symbols')
    ?.split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 20); // hard cap: keeps one request inside the daily quota

  if (!symbols || symbols.length === 0) {
    return Response.json({ error: 'symbols query param required' }, { status: 400 });
  }

  const prices: Record<string, { price: number; source: string }> = {};
  const errors: Record<string, string> = {};
  let rateLimited = false;

  // Sequential on purpose: Alpha Vantage quota is tiny (25/day), so we never
  // fire parallel equity requests we might not need.
  for (const symbol of symbols) {
    const result = isCrypto(symbol) ? await fetchCrypto(symbol) : await fetchEquity(symbol);
    if ('error' in result) {
      errors[symbol] = result.error;
      if (result.error === 'rate limit') rateLimited = true;
    } else {
      prices[symbol] = result;
    }
  }

  return Response.json({ prices, errors, rateLimited });
}
