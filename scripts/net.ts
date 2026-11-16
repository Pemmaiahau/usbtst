import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Bar } from "../src/lib/types";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const CACHE_DIR = join(process.cwd(), ".cache");
const USE_CACHE = process.env.SCAN_CACHE === "1"; // dev only: reuse downloads for 6 hours

export async function getText(url: string, cacheKey?: string, tries = 4): Promise<string> {
  const file = cacheKey ? join(CACHE_DIR, cacheKey.replace(/[^\w.-]/g, "_")) : "";
  if (USE_CACHE && file && existsSync(file)) return readFileSync(file, "utf8");
  let lastErr: unknown;
  for (let t = 0; t < tries; t++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json,text/plain,*/*", "Accept-Language": "en-US,en;q=0.9" },
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (USE_CACHE && file) {
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(file, text);
      }
      return text;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500 * (t + 1)));
    }
  }
  throw new Error(`${url}: ${String(lastErr)}`);
}

export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

export type Chart = { sym: string; bars: Bar[]; regStart: number; regEnd: number; marketTime: number };

// Yahoo's named ranges stop at 10y ("max" is not daily), so longer spans are sent as explicit dates.
function rangeQuery(range: string): string {
  const y = /^(\d+)y$/.exec(range);
  if (!y || +y[1] <= 10) return `range=${range}`;
  const now = Math.floor(Date.now() / 1000);
  return `period1=${now - +y[1] * 31557600}&period2=${now}`;
}

/** Daily split-adjusted OHLCV from Yahoo's public chart endpoint. */
export async function fetchChart(sym: string, range = "5y"): Promise<Chart> {
  const hour = new Date().toISOString().slice(0, 13);
  const text = await getText(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?${rangeQuery(range)}&interval=1d`,
    `chart_${sym}_${range}_${hour.slice(0, 10)}`,
  );
  const r = JSON.parse(text)?.chart?.result?.[0];
  if (!r?.timestamp) throw new Error(`${sym}: no data`);
  const q = r.indicators.quote[0];
  const off = r.meta.gmtoffset ?? -18000;
  const bars: Bar[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const o = q.open[i];
    const h = q.high[i];
    const l = q.low[i];
    const c = q.close[i];
    if (o == null || h == null || l == null || c == null || !(c > 0)) continue;
    bars.push({ d: new Date((r.timestamp[i] + off) * 1000).toISOString().slice(0, 10), o, h, l, c, v: q.volume[i] ?? 0 });
  }
  // Yahoo occasionally repeats the last day (a daily bar plus a live tick): keep the last entry per date
  const dedup: Bar[] = [];
  for (const b of bars) {
    if (dedup.length && dedup[dedup.length - 1].d === b.d) dedup[dedup.length - 1] = b;
    else dedup.push(b);
  }
  const reg = r.meta.currentTradingPeriod?.regular ?? {};
  return { sym, bars: dedup, regStart: reg.start ?? 0, regEnd: reg.end ?? 0, marketTime: r.meta.regularMarketTime ?? 0 };
}

export const normSym = (s: string) => s.trim().toUpperCase().replace(/[./]/g, "-");
