# Portfolio rebalance (Portfolio class with Stocks, target allocation, and Next.js UI)

**Status:** Draft
**Last updated:** 2026-10-01

## 1. Summary

Delivers a `Portfolio` class with a collection of `Stock` objects, each exposing a `currentPrice()` method, plus a target "allocated" distribution (e.g. 40% META, 60% AAPL). Its `rebalance()` method computes which stocks must be bought and sold to match the target allocation. Prices come from free-tier APIs: Coinbase (crypto) and Alpha Vantage (equities), fetched through Next.js server-side API routes. A Next.js + Tailwind UI lets the user edit holdings and allocation, persists them in localStorage, and shows the buy/sell actions.

## 2. Motivation

The portfolio management module of the personal investments app needs a clear, well-documented core for drift correction: given current holdings and a target distribution, tell the user what trades to perform. Doing nothing leaves the calculation (and its reasoning) undefined, leaving later app features without a base to build on.

## 3. User Story

> You're building a portfolio management module, part of a personal investments and trading app
> Construct a simple Portfolio class that has a collection of Stocks. Assume each Stock has a "Current Price" method that receives the last available price. Also, the Portfolio class has a collection of "allocated" Stocks that represents the distribution of the Stocks the Portfolio is aiming (i.e. 40% META, 60% APPL)
> Provide a portfolio rebalance method to know which Stocks should be sold and which ones should be bought to have a balanced Portfolio based on the portfolio's allocation
> Add documentation/comments to understand your thinking process and solution
> Important: If you use LLMs that's ok, but you must share the conversations

## 4. Scope

### In scope

- A `Stock` class/interface with a no-argument `currentPrice()` method returning a decimal number.
- Price sources behind `currentPrice()`: Coinbase public API for crypto, Alpha Vantage free tier (25 req/day) for equities.
- Next.js server-side API routes (`/api/price` and/or `/api/rebalance`) that call the external APIs, keeping the Alpha Vantage key server-side and avoiding CORS.
- A `Portfolio` class holding current holdings (ticker → quantity) and a target allocation (ticker → percentage).
- A `rebalance()` method returning buy and sell actions with ticker, current value, target value, and difference.
- A Next.js + Tailwind page where the user adds/removes holdings and edits allocation percentages; state persists in localStorage.
- Last successful equity prices cached in localStorage as fallback when Alpha Vantage rate limit is hit (with a visible notice).
- Validation of allocations, prices, and inputs with descriptive exceptions.
- JSDoc-style documentation/comments (English) explaining the thinking process and the math.

### Out of scope

- Server/database persistence, real brokerage integration, transaction history, user accounts.
- Paid API tiers, websockets/streaming, historical candles — only last-price snapshots are used.
- Sharing the LLM conversation transcript as an artifact beyond this spec's note in Technical Notes (see Open Questions).

## 5. Actors and Permissions

| Actor   | Can do                                                                | Cannot do                                            |
| ------- | --------------------------------------------------------------------- | ---------------------------------------------------- |
| User (browser) | Edit holdings and allocation, trigger rebalance, see buy/sell actions | Access the Alpha Vantage key; write to a server DB   |
| Next.js server | Fetch prices from Alpha Vantage/Coinbase, run `rebalance()`          | Persist portfolios server-side                       |
| Developer | Instantiate classes, run tests/demo, read the documented code         | Trigger scheduled or automatic rebalancing            |

No user accounts or roles: anyone who opens the page can edit the local portfolio.

## 6. User Flows

### 6.1 Primary flow

1. User opens the Next.js page. Holdings and allocation are loaded from localStorage (or the 40% META / 60% AAPL demo defaults if empty).
2. User edits holdings (ticker → quantity) and allocation percentages via forms; changes are saved to localStorage.
3. User triggers "Rebalance".
4. The page calls the Next.js API route, which fetches fresh prices (Alpha Vantage for equities, Coinbase for crypto), computes total portfolio value, then target value per ticker (`total × target %`).
5. For each ticker, the difference `target value − current value` determines the action: positive → buy, negative → sell, zero/within tolerance → no action.
6. The API returns buy and sell lists, each entry with ticker, current value, target value, and difference; the UI renders them as two tables/cards.
7. A balanced portfolio shows an empty state: "Portfolio is already balanced".

### 6.2 Alternative flows

- **6.2.1 Buy-only target:** allocation includes a ticker the portfolio doesn't hold → generates a buy action for its full target value.
- **6.2.2 Sell-all holding:** a current holding is absent from the allocation → generates a sell action for its entire current value.
- **6.2.3 Already balanced:** all differences within tolerance → empty state instead of action lists (no exception).
- **6.2.4 Rate limit hit:** Alpha Vantage returns rate-limit → UI shows a notice and uses the last known price from localStorage if available; otherwise the error is shown and no calculation runs for that ticker.

### 6.3 Flows explicitly rejected

- Automatic/scheduled rebalancing — rejected: this is a one-shot calculation (non-goal).
- Rebalancing via trade execution — rejected: out of scope, no brokerage integration.
- Server-side portfolio storage — rejected: localStorage only (agreed).

## 7. Functional Requirements

- FR-1: `Portfolio` must store a collection of holdings (ticker → quantity) and a target allocation (ticker → percentage).
- FR-2: Each `Stock` must expose a no-argument `currentPrice()` method returning the last available price as a decimal number.
- FR-3: `rebalance()` must fetch prices fresh from `currentPrice()` on every call; prices must never be cached.
- FR-4: `rebalance()` must return both buy and sell actions, each with ticker, current value, target value, and difference.
- FR-5: Target value must be computed as `total portfolio value × target percentage`.
- FR-6: Allocations must sum to exactly 100%; otherwise a validation error must be raised.
- FR-7: Quantities must be fractional (no lot-size rounding); results are reported as value differences, not share counts.
- FR-8: The code must include JSDoc-style comments in English documenting the thinking process and the math.
- FR-9: The deliverable must include a runnable example demonstrating the 40% META / 60% AAPL scenario.
- FR-10: Equity prices must be fetched from Alpha Vantage's free-tier endpoint; crypto prices from Coinbase's public API.
- FR-11: API rate-limit responses (e.g. Alpha Vantage's 25 req/day) must surface as descriptive errors, not silent zeros.
- FR-12: External API calls must go through Next.js server-side API routes; the Alpha Vantage key must never reach the client.
- FR-13: The UI must let the user add/remove holdings and edit allocation percentages, persisting them to localStorage on every change.
- FR-14: On page load, the UI must restore state from localStorage, falling back to a 40% META / 60% AAPL demo default when empty.
- FR-15: When Alpha Vantage rate limit is hit, the UI must show a visible notice and fall back to the last price stored in localStorage when one exists.
- FR-16: UI must be built with Next.js (App Router), TypeScript, and Tailwind CSS.

## 8. Rules and Constraints

| ID   | Rule                                                              | Applies to          |
| ---- | ----------------------------------------------------------------- | ------------------- |
| R-1  | Allocation percentages must sum to 100                           | Allocation validation |
| R-2  | Allocation may include tickers not currently held                 | `rebalance()`       |
| R-3  | Holdings absent from the allocation are sold in full              | `rebalance()`       |
| R-4  | Allocation entries with 0% are ignored                            | `rebalance()`       |
| R-5  | Zero or negative prices raise a validation error                 | `Stock.currentPrice()` |
| R-6  | Differences below a small tolerance count as balanced             | `rebalance()`       |
| R-7  | No server-side persistence; state lives in browser localStorage | Deliverable         |

## 9. Edge Cases

| ID   | Scenario                                       | Expected behavior                                    |
| ---- | ---------------------------------------------- | ---------------------------------------------------- |
| EC-1 | Empty portfolio (no stocks)                    | Raise a clear error                                  |
| EC-2 | Zero or negative price from `currentPrice()`   | Raise a validation error                             |
| EC-3 | 0% allocation entry                            | Ignored; no action generated                         |
| EC-4 | Portfolio already within tolerance             | Return empty action list                             |
| EC-5 | Ticker in allocation but not held              | Buy action for full target value                     |
| EC-6 | Ticker held but not in allocation              | Sell action for entire current value                 |
| EC-7 | Duplicate ticker when adding holdings/allocation | Raise a descriptive error                          |
| EC-8 | localStorage empty or unavailable (private mode) | Fall back to demo defaults; app still works        |
| EC-9 | Alpha Vantage rate limit hit                     | Notice shown; use last stored price if available   |
| EC-10 | External API unreachable/timeout                 | Descriptive error in UI; no calculation for that ticker |

## 10. Error Handling

| ID   | Failure                                        | User sees                         | Recovery                              |
| ---- | ---------------------------------------------- | --------------------------------- | ------------------------------------- |
| E-1  | Allocation percentages ≠ 100                   | Descriptive exception             | Fix allocation and call again         |
| E-2  | Empty portfolio on `rebalance()`               | Descriptive exception             | Add holdings first                    |
| E-3  | Zero/negative price                            | Descriptive exception             | Fix price source                      |
| E-4  | Unknown or duplicate ticker                    | Descriptive exception             | Correct the input                     |
| E-5  | Network failure from a price source            | Error banner in UI, no calculation       | Retry when APIs recover; no silent corrections |
| E-6  | Alpha Vantage rate limit exceeded / API error note | Notice banner in UI ("rate limit, using last known price") | Daily reset, or use localStorage-cached price |

No silent corrections: invalid input always throws with a descriptive message.

## 11. Data

### 11.1 Data created or modified

- Holdings: ticker → quantity (fractional), in memory and in localStorage (client).
- Target allocation: ticker → percentage, in memory and in localStorage (client).
- Last known equity prices per ticker, in localStorage, written after each successful fetch (rate-limit fallback).
- `rebalance()` result: list of actions (ticker, current value, target value, difference), ephemeral.

### 11.2 Data read

- Prices via `Stock.currentPrice()` at call time: Alpha Vantage (`GLOBAL_QUOTE`) for equities, Coinbase public market endpoints for crypto.

### 11.3 Retention and deletion

No server persistence: all state lives in the browser's localStorage until the user clears it. External API responses are used only for the current calculation (plus the last-price cache above).

## 12. States and Lifecycle

- **Portfolio data:** empty (demo defaults) → edited → persisted in localStorage. No server-side lifecycle.
- **Rebalance:** idle → fetching prices → success (actions or "already balanced" empty state) or error (rate limit / network).
- A portfolio is "balanced" only when a `rebalance()` call returns zero actions; balance is never a stored flag.

## 13. UX and Content

- Language and tone: English UI copy; JSDoc-style comments written for a developer reader.
- Exact strings for every user-visible message, empty state, and error:
  - Empty/rebalanced state: `"Portfolio is already balanced"`
  - Rate-limit notice: `"Rate limit reached — showing last known prices"`
  - Error banner: `"Could not fetch prices. Try again later."`
  - Validation: `"Allocation must sum to 100%, got 90%"`
  - Exception messages in code, e.g. `"Cannot rebalance an empty portfolio"`, `"Price must be positive for META"`
- Accessibility requirements: Form inputs labeled; color is not the only signal for buy/sell (use text/icons alongside green/red).
- Responsive or platform notes: Tailwind responsive layout; usable on desktop and mobile widths.

## 14. Success Criteria

- The `rebalance()` logic passes the example scenarios (40% META / 60% AAPL, plus buy-only, sell-all, and already-balanced cases) with correct buy/sell amounts.
- The UI lets a user edit holdings/allocation, reload the page and keep the data, trigger rebalance, and see correct buy/sell tables sourced from live free-tier APIs.
- Rate-limit and network failures show the specified notices instead of breaking the page.
- The reasoning and math are visible in the code comments.

## 15. Non-Goals

- Transaction costs, taxes, rebalancing thresholds/bands, scheduled or drift-triggered rebalancing (one-shot calculation only).
- Server/database persistence, user accounts, offline support, mobile app, brokerage integration, streaming data.

## 16. Technical Notes

Suggestions only, not agreed requirements:

- Stack: Next.js (App Router) + TypeScript + Tailwind CSS, as agreed by the user.
- Structure: `lib/portfolio.ts` with `Stock` (`currentPrice()`), `Portfolio` (`addHolding()`, `setAllocation()`, `rebalance()` → `{ buys, sells }`); `app/api/price/route.ts` for external calls; a single page component with forms and result tables.
- Price sources: `AlphaVantageStock` (fetch `GLOBAL_QUOTE`, key from `ALPHAVANTAGE_API_KEY` env var, 25 req/day **and ~1 req/sec burst limit** — the proxy spaces requests 1.1s apart and retries once on throttle) and `CoinbaseStock` (public endpoint, no key). A `StaticStock` mock keeps tests/demo runnable without burning rate limit.
- Tolerance: a small epsilon (e.g. 0.01 currency units) when comparing differences to zero.
- localStorage keys e.g. `portfolio:holdings`, `portfolio:allocation`, `portfolio:lastPrices`; read via effects guarded for SSR hydration.
- Rate-limit fallback: the API route returns a flag (`stale: true`) with the cached price so the UI can render the notice.
