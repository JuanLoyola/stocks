/**
 * portfolio.ts — Portfolio rebalance core
 * =======================================
 *
 * Thinking process
 * ----------------
 * The story asks for a Portfolio that knows how it *should* be distributed
 * ("allocated") and can tell us which trades are needed to get there.
 *
 * 1. A Stock is anything that can answer "what are you worth right now?" via
 *    `currentPrice()`. We keep that as an interface so the same Portfolio works
 *    with live API-backed stocks (Alpha Vantage / Coinbase through our API
 *    routes) or with static stocks (tests, demo, rate-limit fallback).
 * 2. The Portfolio stores two independent maps:
 *      - holdings:   ticker -> quantity we actually own
 *      - allocation: ticker -> target percentage (must sum to 100)
 *    They are independent on purpose: we can aim for a ticker we don't own yet
 *    (buy) and we can own a ticker that is not in the target (sell all).
 * 3. Rebalancing math (the heart of the problem):
 *      total      = Σ (qty_i × price_i)           // current portfolio value
 *      target_i   = total × allocation_i%         // where we want to be
 *      diff_i     = target_i − (qty_i × price_i)  // gap to close
 *      diff > 0   -> BUY   that amount
 *      diff < 0   -> SELL  that amount
 *      |diff| ≤ ε -> nothing (portfolio is "balanced" within tolerance)
 *
 *    Note: prices are fetched fresh on every `rebalance()` call (FR-3), never
 *    cached inside the class — the caller decides how stale is acceptable.
 *
 * Errors: we throw descriptive exceptions instead of silently correcting the
 * input (spec rule "no silent corrections").
 */

/** A tradable asset that can report its last available price. */
export interface Stock {
  /** Ticker symbol, e.g. "AAPL", "META", "BTC-USD". */
  readonly ticker: string;
  /**
   * Returns the last available price as a positive decimal number.
   * Async because real implementations hit a network API.
   */
  currentPrice(): Promise<number>;
}

/**
 * A Stock with a fixed price. Used for the demo default portfolio, unit-style
 * checks, and as the value the UI passes in after fetching live prices from
 * `/api/price`.
 */
export class StaticStock implements Stock {
  constructor(
    public readonly ticker: string,
    private readonly price: number,
  ) {}

  async currentPrice(): Promise<number> {
    return this.price;
  }
}

/** One recommended trade produced by `rebalance()`. */
export interface RebalanceAction {
  ticker: string;
  /** What the position is worth right now (qty × price). */
  currentValue: number;
  /** What it should be worth: total × target %. */
  targetValue: number;
  /** targetValue − currentValue. Positive = buy, negative = sell. */
  difference: number;
}

export interface RebalanceResult {
  /** Σ (qty × price) across all holdings. */
  totalValue: number;
  /** Fresh prices used for the calculation. */
  prices: Record<string, number>;
  buys: RebalanceAction[];
  sells: RebalanceAction[];
  /** True when no action exceeds the tolerance. */
  balanced: boolean;
}

/** Differences within this many currency units count as "balanced" (R-6). */
const TOLERANCE = 0.01;

/** Percentages must sum to 100 within this tolerance (floating point slack). */
const ALLOCATION_EPSILON = 1e-6;

export class Portfolio {
  /** ticker -> Stock, the source of truth for prices. */
  private stocks = new Map<string, Stock>();
  /** ticker -> quantity held (fractional quantities allowed, R-7). */
  private holdings = new Map<string, number>();
  /** ticker -> target percentage. */
  private allocation = new Map<string, number>();

  /**
   * Register a stock. Throws on duplicate tickers — silent overwrites would
   * hide bugs (E-4).
   */
  addStock(stock: Stock): this {
    if (this.stocks.has(stock.ticker)) {
      throw new Error(`Duplicate ticker: ${stock.ticker}`);
    }
    this.stocks.set(stock.ticker, stock);
    return this;
  }

  /** Add (or increase) a holding. The stock must be registered first. */
  addHolding(ticker: string, quantity: number): this {
    if (!this.stocks.has(ticker)) {
      throw new Error(`Unknown ticker: ${ticker}`);
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Quantity must be a positive number, got ${quantity}`);
    }
    this.holdings.set(ticker, (this.holdings.get(ticker) ?? 0) + quantity);
    return this;
  }

  /**
   * Set the target distribution, e.g. { META: 40, AAPL: 60 }.
   * Percentages must sum to exactly 100 (R-1); 0% entries are dropped (R-4).
   * Every ticker must be registered so we can price it during rebalance.
   */
  setAllocation(target: Record<string, number>): this {
    const entries = Object.entries(target).filter(([, pct]) => pct > 0);

    for (const [ticker, pct] of entries) {
      if (!this.stocks.has(ticker)) {
        throw new Error(`Unknown ticker in allocation: ${ticker}`);
      }
      if (!Number.isFinite(pct)) {
        throw new Error(`Invalid percentage for ${ticker}: ${pct}`);
      }
    }

    const sum = entries.reduce((acc, [, pct]) => acc + pct, 0);
    if (Math.abs(sum - 100) > ALLOCATION_EPSILON) {
      throw new Error(`Allocation must sum to 100%, got ${round(sum)}%`);
    }

    this.allocation = new Map(entries);
    return this;
  }

  /**
   * Compute the trades needed to reach the target allocation.
   *
   * Steps:
   *  1. Fetch fresh prices for every registered stock we care about
   *     (holdings ∪ allocation).
   *  2. Validate prices are positive (EC-2) and the portfolio is non-empty
   *     (EC-1) and has an allocation set.
   *  3. Compute total value, per-ticker target value, and the gap.
   *  4. Split gaps into buys / sells, ignoring differences within tolerance.
   *
   * Holdings missing from the allocation get target 0 → full sell (EC-6).
   * Allocation tickers with no holding get current 0 → full target buy (EC-5).
   */
  async rebalance(): Promise<RebalanceResult> {
    if (this.holdings.size === 0) {
      throw new Error('Cannot rebalance an empty portfolio');
    }
    if (this.allocation.size === 0) {
      throw new Error('Cannot rebalance without a target allocation');
    }

    // Tickers we need prices for: everything we hold plus everything targeted.
    const tickers = new Set([...this.holdings.keys(), ...this.allocation.keys()]);

    const prices: Record<string, number> = {};
    for (const ticker of tickers) {
      const stock = this.stocks.get(ticker);
      if (!stock) throw new Error(`Unknown ticker: ${ticker}`);
      const price = await stock.currentPrice();
      if (!Number.isFinite(price) || price <= 0) {
        throw new Error(`Price must be positive for ${ticker}, got ${price}`);
      }
      prices[ticker] = price;
    }

    // Current value of every position (missing holding => 0).
    const currentValues = new Map<string, number>();
    let totalValue = 0;
    for (const ticker of tickers) {
      const value = (this.holdings.get(ticker) ?? 0) * prices[ticker];
      currentValues.set(ticker, value);
      totalValue += value;
    }
    if (totalValue <= 0) {
      throw new Error('Portfolio has no value; nothing to rebalance');
    }

    // Target value per ticker; tickers absent from the allocation target 0.
    const buys: RebalanceAction[] = [];
    const sells: RebalanceAction[] = [];

    for (const ticker of tickers) {
      const targetValue = totalValue * ((this.allocation.get(ticker) ?? 0) / 100);
      const currentValue = currentValues.get(ticker)!;
      const difference = targetValue - currentValue;

      if (Math.abs(difference) <= TOLERANCE) continue; // already balanced

      const action: RebalanceAction = { ticker, currentValue, targetValue, difference };
      if (difference > 0) buys.push(action);
      else sells.push(action);
    }

    // Deterministic output helps demos and tests.
    const byTicker = (a: RebalanceAction, b: RebalanceAction) =>
      a.ticker.localeCompare(b.ticker);

    return {
      totalValue,
      prices,
      buys: buys.sort(byTicker),
      sells: sells.sort(byTicker),
      balanced: buys.length === 0 && sells.length === 0,
    };
  }
}

/** Round for readable error messages and demo output. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
