// Buy / sell rules for the index futures (S&P 500, Nasdaq 100, Dow, Russell 2000).
// Signals and backtests run on the matching ETF's cash-session daily bars (clean, long history, no contract rolls);
// the page translates them to the futures price.
import { atr, rsiState, sma } from "./indicators";
import type { Bar, IndexRuleStat, Side } from "./types";

export const INDEX_COST = 0.0002; // 0.02% round trip: index futures are cheap to trade
const STOP_ATR = 2.5;

type S = { c: number[]; s5: number[]; s10: number[]; s20: number[]; s50: number[]; s200: number[]; r2: number[]; r14: number[]; atr: number[]; hi20: number[]; lo20: number[] };
type Rule = { key: string; name: string; side: Side; rules: string; maxHold: number; entry: (s: S, i: number) => boolean; exit: (s: S, i: number) => boolean; exitText: string };

export const INDEX_RULES: Rule[] = [
  {
    key: "dip",
    name: "Dip in an uptrend",
    side: "long",
    rules: "Above the 200-day average and 2-day RSI under 10. Buy the close; sell on the first close above the 5-day average, or after 10 sessions.",
    maxHold: 10,
    entry: (s, i) => s.c[i] > s.s200[i] && s.r2[i] < 10,
    exit: (s, i) => s.c[i] > s.s5[i],
    exitText: "Sell on the first close above the 5-day average, or after 10 sessions",
  },
  {
    key: "trend",
    name: "New high in an uptrend",
    side: "long",
    rules: "Above the 50-day and 200-day averages and closing at a new 20-day high. Buy the close; sell on a close below the 20-day average, or after 20 sessions.",
    maxHold: 20,
    entry: (s, i) => s.c[i] > s.s200[i] && s.c[i] > s.s50[i] && s.c[i] > s.hi20[i],
    exit: (s, i) => s.c[i] < s.s20[i],
    exitText: "Sell on a close below the 20-day average, or after 20 sessions",
  },
  {
    key: "washout",
    name: "Panic washout",
    side: "long",
    rules: "14-day RSI under 30 (any trend). Buy the close; sell on the first close above the 10-day average, or after 10 sessions.",
    maxHold: 10,
    entry: (s, i) => s.r14[i] < 30,
    exit: (s, i) => s.c[i] > s.s10[i],
    exitText: "Sell on the first close above the 10-day average, or after 10 sessions",
  },
  {
    key: "fade",
    name: "Rally in a downtrend",
    side: "short",
    rules: "Below the 200-day average and 2-day RSI over 90. Sell the close; buy back on the first close below the 5-day average, or after 10 sessions.",
    maxHold: 10,
    entry: (s, i) => s.c[i] < s.s200[i] && s.r2[i] > 90,
    exit: (s, i) => s.c[i] < s.s5[i],
    exitText: "Buy back on the first close below the 5-day average, or after 10 sessions",
  },
  {
    key: "breakdown",
    name: "New low in a downtrend",
    side: "short",
    rules: "Below the 50-day and 200-day averages and closing at a new 20-day low. Sell the close; buy back on a close above the 20-day average, or after 20 sessions.",
    maxHold: 20,
    entry: (s, i) => s.c[i] < s.s200[i] && s.c[i] < s.s50[i] && s.c[i] < s.lo20[i],
    exit: (s, i) => s.c[i] > s.s20[i],
    exitText: "Buy back on a close above the 20-day average, or after 20 sessions",
  },
];

const BUCKETS = ["fell 0.75% or more", "fell a little", "rose a little", "rose 0.75% or more"];
const bucketOf = (m: number) => (m <= -0.0075 ? 0 : m < 0 ? 1 : m < 0.0075 ? 2 : 3);

export type IndexAnalysis = {
  from: string;
  last: { c: number; s20: number; s50: number; s200: number; rsi2: number; rsi14: number; atrPct: number };
  rules: (IndexRuleStat & { exitText: string })[];
  overnight: { label: string; n: number; avg: number; winRate: number; now: boolean }[];
};

export function analyseIndex(bars: Bar[]): IndexAnalysis {
  const c = bars.map((b) => b.c);
  const n = c.length - 1;
  const hi20 = new Array<number>(c.length).fill(NaN);
  const lo20 = new Array<number>(c.length).fill(NaN);
  for (let i = 20; i < c.length; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - 20; j < i; j++) {
      hi = Math.max(hi, c[j]);
      lo = Math.min(lo, c[j]);
    }
    hi20[i] = hi;
    lo20[i] = lo;
  }
  const s: S = { c, s5: sma(c, 5), s10: sma(c, 10), s20: sma(c, 20), s50: sma(c, 50), s200: sma(c, 200), r2: rsiState(c, 2).rsi, r14: rsiState(c, 14).rsi, atr: atr(bars), hi20, lo20 };
  const r2 = (x: number) => Math.round(x * 100) / 100;

  const rules = INDEX_RULES.map((rule) => {
    const dir = rule.side === "short" ? -1 : 1;
    const pcts: number[] = [];
    let days = 0;
    let open: { i: number; entry: number; stop: number } | null = null;
    for (let i = 200; i <= n; i++) {
      if (open) {
        const b = bars[i];
        const stopped = dir > 0 ? b.l <= open.stop : b.h >= open.stop;
        let exit: number | null = null;
        if (stopped) exit = dir * (b.o - open.stop) < 0 ? b.o : open.stop;
        else if (rule.exit(s, i) || i - open.i >= rule.maxHold) exit = b.c;
        if (exit != null) {
          pcts.push((dir * (exit / open.entry - 1) - INDEX_COST) * 100);
          days += i - open.i;
          open = null;
        }
        continue; // no re-entry on the exit bar
      }
      if (rule.entry(s, i)) open = { i, entry: c[i], stop: c[i] - dir * STOP_ATR * s.atr[i] };
    }
    const wins = pcts.filter((v) => v > 0);
    const losses = pcts.filter((v) => v <= 0);
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    return {
      key: rule.key,
      name: rule.name,
      side: rule.side,
      rules: `${rule.rules} Protective stop ${STOP_ATR} ATR from entry.`,
      exitText: rule.exitText,
      n: pcts.length,
      winRate: pcts.length ? r2((wins.length / pcts.length) * 100) : 0,
      avg: pcts.length ? r2(sum(pcts) / pcts.length) : 0,
      profitFactor: losses.length && sum(losses) !== 0 ? r2(sum(wins) / -sum(losses)) : 0,
      avgDays: pcts.length ? r2(days / pcts.length) : 0,
      active: !!open,
      fresh: !!open && open.i === n,
      entryDate: open ? bars[open.i].d : undefined,
      sinceEntry: open ? r2(dir * (c[n] / open.entry - 1) * 100) : undefined,
      stopPct: open ? r2(Math.abs(open.stop / c[n] - 1) * 100) : undefined,
    };
  });

  // close -> next open, split by trend and by what the day did
  const acc = Array.from({ length: 8 }, () => [] as number[]);
  const key = (i: number) => (c[i] > s.s200[i] ? 0 : 4) + bucketOf(c[i] / c[i - 1] - 1);
  for (let i = 200; i < n; i++) acc[key(i)].push((bars[i + 1].o / c[i] - 1 - INDEX_COST) * 100);
  const now = key(n);
  const overnight = acc.map((v, k) => ({
    label: `${k < 4 ? "Above" : "Below"} the 200-day average, day ${BUCKETS[k % 4]}`,
    n: v.length,
    avg: v.length ? Math.round((v.reduce((x, y) => x + y, 0) / v.length) * 1000) / 1000 : 0,
    winRate: v.length ? r2((v.filter((x) => x > 0).length / v.length) * 100) : 0,
    now: k === now,
  }));

  return { from: bars[200]?.d ?? "", last: { c: c[n], s20: s.s20[n], s50: s.s50[n], s200: s.s200[n], rsi2: s.r2[n], rsi14: s.r14[n], atrPct: (s.atr[n] / c[n]) * 100 }, rules, overnight };
}
