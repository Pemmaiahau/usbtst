import type { Pre } from "./indicators";
import type { Bar, Side, SwingSetup } from "./types";

export type RawSignal = {
  setup: SwingSetup;
  side: Side;
  i: number;
  stop: number; // price level, based on the signal bar
  rMult: number; // target = entry +/- rMult * risk
  holdDays: number;
  rvol: number;
  note: string;
  exitMA5?: boolean; // also exit at the first close beyond the 5-day average (above for longs, below for shorts)
};

export const SWING_RULES: Record<SwingSetup, string> = {
  pullback:
    "Uptrend (price > rising 50-day > 200-day) that made a 20-day high in the last 15 sessions, pulled back to the 20-day EMA, " +
    "and turned up today. Buy next open, stop under the pullback low, target 2x risk, exit after 10 sessions.",
  breakout:
    "Uptrend stock closing above a tight 30-session base (base depth under 20%) on 1.5x+ volume, closing in the top of its range. " +
    "Buy next open, stop 1.5 ATR below, target 2x risk, exit after 15 sessions.",
  gap:
    "Catalyst gap: opens 4%+ higher on 2x+ volume and holds the gap into the close, above the 50-day average. " +
    "Buy next open, stop under the gap-day low, target 2x risk, exit after 10 sessions.",
  bounce:
    "Oversold bounce: stock above its 200-day average, down 3+ closes in a row with RSI under 35. Buy next open, " +
    "sell at the first close back above the 5-day average (or after 7 sessions), stop 2.5 ATR below.",
  rally:
    "Downtrend (price < falling 50-day < 200-day) that made a 20-day low in the last 15 sessions, rallied to the 20-day EMA, " +
    "and turned down today. Sell short next open, stop above the rally high, target 2x risk, exit after 10 sessions.",
  breakdown:
    "Downtrend stock closing below a tight 30-session base (base depth under 20%) on 1.5x+ volume, closing in the bottom of its range. " +
    "Sell short next open, stop 1.5 ATR above, target 2x risk, exit after 15 sessions.",
  gapdown:
    "Bad-news gap: opens about 4%+ lower on 2x+ volume and stays down into the close, below the 50-day average. " +
    "Sell short next open, stop above the gap-day high, target 2x risk, exit after 10 sessions.",
  fade:
    "Overbought fade: stock below its 200-day average, up 3+ closes in a row with RSI over 65. Sell short next open, " +
    "cover at the first close back below the 5-day average (or after 7 sessions), stop 2.5 ATR above.",
};

export const SWING_LABEL: Record<SwingSetup, string> = {
  pullback: "Pullback to 20 EMA",
  breakout: "Base breakout",
  gap: "Catalyst gap up",
  bounce: "Oversold bounce",
  rally: "Rally to 20 EMA",
  breakdown: "Base breakdown",
  gapdown: "Bad-news gap down",
  fade: "Overbought fade",
};
export const SWING_SIDE: Record<SwingSetup, Side> = { pullback: "long", breakout: "long", gap: "long", bounce: "long", rally: "short", breakdown: "short", gapdown: "short", fade: "short" };
export const SWING_SETUPS = Object.keys(SWING_SIDE) as SwingSetup[];
const SHORT_OF: Record<Kind, SwingSetup> = { pullback: "rally", breakout: "breakdown", gap: "gapdown", bounce: "fade" };

type Kind = "pullback" | "breakout" | "gap" | "bounce";
type Core = { kind: Kind; stop: number; rMult: number; holdDays: number; rvol: number; depth?: number; exitMA5?: boolean };

function clampRisk(close: number, stop: number, atr: number, minAtr: number, maxAtr: number): number {
  const risk = Math.max(minAtr * atr, Math.min(maxAtr * atr, close - stop));
  return close - risk;
}

/** The four patterns, written for the long side. Shorts run the same code on a mirrored (1/price) series. */
function detectCore(bars: Bar[], pre: Pre, i: number, volFrac: number): Core[] {
  if (i < 220) return [];
  const b = bars[i];
  const p = bars[i - 1];
  const a = pre.atr[i];
  const s50 = pre.sma50[i];
  const s200 = pre.sma200[i];
  const e20 = pre.ema20[i];
  if (!(a > 0) || !(s200 > 0)) return [];
  const avgVol = (pre.prefV[i] - pre.prefV[i - 20]) / 20;
  const rvol = avgVol > 0 ? b.v / Math.max(0.1, volFrac) / avgVol : 0;
  const clv = b.h > b.l ? (b.c - b.l) / (b.h - b.l) : 0.5;
  const rsi = pre.rsi.rsi[i];
  const trendUp = b.c > s50 && s50 > s200 && s50 > pre.sma50[i - 10];
  const out: Core[] = [];

  // --- catalyst gap
  const gap = b.o / p.c - 1;
  if (gap >= 0.04 && rvol >= 2 && clv >= 0.5 && b.c >= b.o * 0.995 && b.c > s50) {
    out.push({ kind: "gap", stop: clampRisk(b.c, b.l - 0.1 * a, a, 0.75, 2.5), rMult: 2, holdDays: 10, rvol });
  }

  // --- oversold bounce (mean reversion inside a long-term uptrend)
  if (b.c > s200 && rsi < 35 && b.c < p.c && p.c < bars[i - 2].c && bars[i - 2].c < bars[i - 3].c) {
    out.push({ kind: "bounce", stop: b.c - 2.5 * a, rMult: 3, holdDays: 7, rvol, exitMA5: true });
  }

  if (!trendUp) return out;

  // --- base breakout
  let hh = 0;
  let ll = Infinity;
  for (let j = i - 30; j < i; j++) {
    if (bars[j].h > hh) hh = bars[j].h;
    if (bars[j].l < ll) ll = bars[j].l;
  }
  const dayChg = b.c / p.c - 1;
  if (b.c > hh && p.c <= hh && rvol >= 1.5 && clv >= 0.6 && (hh - ll) / b.c <= 0.2 && dayChg <= 0.08) {
    out.push({ kind: "breakout", stop: b.c - 1.5 * a, rMult: 2, holdDays: 15, rvol, depth: (hh - ll) / b.c });
  }

  // --- pullback to 20 EMA
  let madeHigh = false;
  for (let j = i - 15; j <= i - 2 && !madeHigh; j++) {
    let h20 = 0;
    for (let k = j - 20; k < j; k++) if (bars[k].h > h20) h20 = bars[k].h;
    if (bars[j].h >= h20) madeHigh = true;
  }
  const low3 = Math.min(b.l, p.l, bars[i - 2].l);
  const touched = low3 <= e20 * 1.01;
  const turned = b.c > p.h || (b.c > b.o && clv >= 0.6 && b.c > p.c);
  if (madeHigh && touched && b.c > e20 * 0.97 && turned && rsi >= 40 && rsi <= 62) {
    out.push({ kind: "pullback", stop: clampRisk(b.c, low3 - 0.25 * a, a, 0.75, 2.5), rMult: 2, holdDays: 10, rvol });
  }
  return out;
}

/** Buy setups completing on bar i (signal at the close of i, entry at the open of i+1). */
export function detectSwing(bars: Bar[], pre: Pre, i: number, volFrac = 1): RawSignal[] {
  const rsi = pre.rsi.rsi[i];
  return detectCore(bars, pre, i, volFrac).map((c) => {
    const x = c.rvol.toFixed(1);
    const note =
      c.kind === "gap"
        ? `Gapped up ${((bars[i].o / bars[i - 1].c - 1) * 100).toFixed(1)}% on ${x}x volume and held`
        : c.kind === "bounce"
          ? `Down 3+ days to RSI ${rsi.toFixed(0)} while above the 200-day average`
          : c.kind === "breakout"
            ? `Broke out of a ${((c.depth ?? 0) * 100).toFixed(0)}%-deep 30-day base on ${x}x volume`
            : `Pulled back to the 20 EMA in an uptrend and turned up (RSI ${rsi.toFixed(0)})`;
    return { setup: c.kind, side: "long", i, stop: c.stop, rMult: c.rMult, holdDays: c.holdDays, rvol: c.rvol, note, exitMA5: c.exitMA5 };
  });
}

/** Mirror a price series (1/price, highs and lows swapped) so a downtrend looks like an uptrend. */
export function mirror(bars: Bar[]): Bar[] {
  return bars.map((b) => ({ d: b.d, o: 1 / b.o, h: 1 / b.l, l: 1 / b.h, c: 1 / b.c, v: b.v }));
}

/** Sell-short setups on bar i. `mbars`/`mpre` are mirror(bars) and its precompute; `pre` is the real one. */
export function detectShort(bars: Bar[], pre: Pre, mbars: Bar[], mpre: Pre, i: number, volFrac = 1): RawSignal[] {
  const rsi = pre.rsi.rsi[i];
  return detectCore(mbars, mpre, i, volFrac).map((c) => {
    const x = c.rvol.toFixed(1);
    const note =
      c.kind === "gap"
        ? `Gapped down ${((1 - bars[i].o / bars[i - 1].c) * 100).toFixed(1)}% on ${x}x volume and stayed down`
        : c.kind === "bounce"
          ? `Up 3+ days to RSI ${rsi.toFixed(0)} while below the 200-day average`
          : c.kind === "breakout"
            ? `Broke below a 30-day base on ${x}x volume in a downtrend`
            : `Rallied to the falling 20 EMA in a downtrend and turned down (RSI ${rsi.toFixed(0)})`;
    return { setup: SHORT_OF[c.kind], side: "short", i, stop: 1 / c.stop, rMult: c.rMult, holdDays: c.holdDays, rvol: c.rvol, note, exitMA5: c.exitMA5 };
  });
}

export type SimTrade = { entryDate: string; exitDate: string; entry: number; exit: number; r: number; pct: number; days: number; exitIdx: number };

/** Simulate one signal. Returns null when the trade is skipped (bad open) or has no data yet. */
export function simulate(bars: Bar[], sig: RawSignal, cost = 0.0005): SimTrade | null {
  const dir = sig.side === "short" ? -1 : 1;
  const ei = sig.i + 1;
  if (ei >= bars.length) return null;
  const entry = bars[ei].o;
  const risk = dir * (entry - sig.stop);
  const refRisk = dir * (bars[sig.i].c - sig.stop);
  if (risk <= 0 || refRisk <= 0) return null;
  if (dir * (entry - bars[sig.i].c) > refRisk) return null; // gapped more than 1R away: don't chase
  const target = entry + dir * sig.rMult * risk;
  const last = Math.min(bars.length - 1, ei + sig.holdDays - 1);
  let exit = bars[last].c;
  let xi = last;
  for (let j = ei; j <= last; j++) {
    const bar = bars[j];
    if (dir > 0 ? bar.l <= sig.stop : bar.h >= sig.stop) {
      exit = j > ei && dir * (bar.o - sig.stop) < 0 ? bar.o : sig.stop; // gap through the stop fills at the open
      xi = j;
      break;
    }
    if (dir > 0 ? bar.h >= target : bar.l <= target) {
      exit = j > ei && dir * (bar.o - target) > 0 ? bar.o : target;
      xi = j;
      break;
    }
    if (sig.exitMA5 && j >= 4) {
      let s5 = 0;
      for (let k = j - 4; k <= j; k++) s5 += bars[k].c;
      if (dir * (bar.c - s5 / 5) > 0) {
        exit = bar.c;
        xi = j;
        break;
      }
    }
  }
  const pct = dir * (exit / entry - 1) - cost;
  return { entryDate: bars[ei].d, exitDate: bars[xi].d, entry, exit, r: (pct * entry) / risk, pct: pct * 100, days: xi - ei + 1, exitIdx: xi };
}
