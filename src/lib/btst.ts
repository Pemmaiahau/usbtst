import { rsiFrom } from "./indicators";
import type { BtstInput, BtstRow } from "./types";

// Weights follow what the 5-year backtest of this universe actually showed about the
// close -> next-open return (see scripts/research*.ts): volatile names, names with a habit of
// gapping up, names that are weak intraday, and oversold dips in long-term uptrends did best.
// "Strong close on big volume" momentum did NOT work overnight and is penalised.
export const BTST_WEIGHTS = { volatility: 25, overnight: 25, intraday: 20, dip: 30 };
export const BTST_PARTS: Record<string, string> = {
  volatility: "Volatility rank (bigger movers earn more overnight)",
  overnight: "Habit of gapping up (last 60 nights)",
  intraday: "Weak during the day (last 20 sessions)",
  dip: "Oversold dip in a long-term uptrend",
  chased: "Penalty: big up day on heavy volume",
};
export const CHASE_PENALTY = 15;
export const SELL_WEIGHTS = { gapDown: 30, strongDay: 20, overbought: 30, trend: 20 };
export const SELL_PARTS: Record<string, string> = {
  gapDown: "Habit of gapping down (last 60 nights)",
  strongDay: "Strong during the day (last 20 sessions)",
  overbought: "Overbought or chased today",
  trend: "Below the 50/200-day averages",
};
export const SELL_RULES =
  "Sell at the close, buy back at the next open (or simply do not hold these overnight). Score 0-100: habit of gapping down over the last 60 nights (30), " +
  "gains concentrated in regular hours (20), overbought or chased today (30), and price below its 50/200-day averages (20). Same liquidity filter as the buy list.";
export const MIN_PRICE = 10;
export const MIN_DOLLAR_VOL = 50e6;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function ranker(vals: number[]): (v: number) => number {
  const s = [...vals].sort((a, b) => a - b);
  return (v) => {
    let lo = 0;
    let hi = s.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (s[m] < v) lo = m + 1;
      else hi = m;
    }
    return s.length > 1 ? lo / (s.length - 1) : 0.5;
  };
}

/**
 * Score every stock for one day. Cross-sectional (ranks are computed inside the supplied
 * universe), so pass the whole universe, not a single stock.
 * `volFrac` = fraction of the regular session elapsed (1 once the market has closed);
 * used to project partial-day volume to a full day.
 */
export function scoreBtstDay(inputs: BtstInput[], volFrac = 1): BtstRow[] {
  const frac = Math.max(0.1, Math.min(1, volFrac));
  const base = inputs
    .filter((x) => x.bar.c > 0 && x.ctx.prevClose > 0)
    .map((x) => {
      const { ctx, bar } = x;
      const c = bar.c;
      const chg = (c / ctx.prevClose - 1) * 100;
      const hasRange = bar.h != null && bar.l != null && bar.h >= bar.l;
      const clv = hasRange ? (bar.h! > bar.l! ? (c - bar.l!) / (bar.h! - bar.l!) : 0.5) : null;
      const rvol = bar.v != null && ctx.avgVol20 > 0 ? bar.v / frac / ctx.avgVol20 : null;
      const d = c - ctx.prevClose;
      const g = (ctx.avgGain * 13 + Math.max(d, 0)) / 14;
      const l = (ctx.avgLoss * 13 + Math.max(-d, 0)) / 14;
      const hasOpen = bar.o != null && bar.o > 0;
      const intraday = hasOpen ? (c / bar.o! - 1) * 100 : null;
      // without today's open, fall back to scaling the prior-days sums to the full window
      const ovn60 = (hasOpen ? ctx.ovnSum59 + (bar.o! / ctx.prevClose - 1) : (ctx.ovnSum59 * 60) / 59) * 100;
      const intr20 = (hasOpen ? ctx.intrSum19 + (c / bar.o! - 1) : (ctx.intrSum19 * 20) / 19) * 100;
      return {
        x,
        c,
        chg,
        clv: clv == null ? null : clamp01(clv),
        rvol,
        intraday,
        ovn60,
        intr20,
        atrPct: (ctx.atr14 / c) * 100,
        rsi: rsiFrom(g, l),
        ret20: (c / ctx.close20ago - 1) * 100,
        sma20: (ctx.sum19 + c) / 20,
        sma50: (ctx.sum49 + c) / 50,
        sma200: (ctx.sum199 + c) / 200,
      };
    });

  const rsPct = ranker(base.map((b) => b.ret20));
  const atrPct = ranker(base.map((b) => b.atrPct));
  const ovnPct = ranker(base.map((b) => b.ovn60));
  const intrPct = ranker(base.map((b) => b.intr20));

  const bySector = new Map<string, number[]>();
  for (const b of base) {
    const arr = bySector.get(b.x.sector) ?? [];
    arr.push(b.chg);
    bySector.set(b.x.sector, arr);
  }
  const sectorChg = new Map<string, number>();
  for (const [s, arr] of bySector) sectorChg.set(s, median(arr));
  const sectorSorted = [...sectorChg.values()].sort((a, b) => a - b);
  const sectorRank = (s: string) => (sectorSorted.length < 2 ? 0.5 : sectorSorted.indexOf(sectorChg.get(s)!) / (sectorSorted.length - 1));

  const W = BTST_WEIGHTS;
  return base.map((b) => {
    const { x, c, chg, clv, rvol } = b;
    const above20 = c > b.sma20;
    const above50 = c > b.sma50;
    const above200 = c > b.sma200;
    const atrRank = atrPct(b.atrPct);
    const ovnRank = ovnPct(b.ovn60);
    const intrRank = intrPct(b.intr20);

    const parts: Record<string, number> = {};
    parts.volatility = W.volatility * clamp01((atrRank - 0.4) / 0.5);
    parts.overnight = W.overnight * clamp01((ovnRank - 0.4) / 0.5);
    parts.intraday = W.intraday * clamp01((0.6 - intrRank) / 0.5);
    const intra = b.intraday ?? chg;
    const dip = b.rsi <= 30 ? 1 : b.rsi <= 40 || intra <= -2.5 ? 0.6 : intra <= -1 ? 0.3 : 0;
    parts.dip = W.dip * dip * (above200 ? 1 : 0.5);
    const chased = chg >= 3 && (rvol ?? 0) >= 2 && (clv ?? 1) >= 0.7;
    if (chased) parts.chased = -CHASE_PENALTY;

    const raw = Math.max(0, Object.values(parts).reduce((a, v) => a + v, 0));
    const dollarVol = x.ctx.avgVol20 * x.ctx.prevClose;
    for (const k of Object.keys(parts)) parts[k] = Math.round(parts[k] * 10) / 10;

    // ----- sell side: the mirror image (habit of gapping down, strong intraday, overbought, weak trend)
    const S = SELL_WEIGHTS;
    const sellParts: Record<string, number> = {};
    sellParts.gapDown = S.gapDown * clamp01((0.6 - ovnRank) / 0.5);
    sellParts.strongDay = S.strongDay * clamp01((intrRank - 0.4) / 0.5);
    const hot = chased ? 1 : b.rsi >= 75 ? 0.8 : b.rsi >= 70 || intra >= 2.5 ? 0.5 : 0;
    sellParts.overbought = S.overbought * hot;
    sellParts.trend = S.trend * (above200 ? 0 : above50 ? 0.5 : 1);
    const sellRaw = Object.values(sellParts).reduce((a, v) => a + v, 0);
    for (const k of Object.keys(sellParts)) sellParts[k] = Math.round(sellParts[k] * 10) / 10;

    const f1 = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
    const top = (rank: number) => `top ${Math.max(1, Math.round((1 - rank) * 100))}%`;
    const reasons: string[] = [];
    if (atrRank >= 0.65) reasons.push(`Big mover: typical daily swing ${b.atrPct.toFixed(1)}% (${top(atrRank)} of the universe)`);
    if (ovnRank >= 0.65) reasons.push(`Habit of gapping up: ${f1(b.ovn60)} summed over the last 60 nights (${top(ovnRank)})`);
    if (intrRank <= 0.35) reasons.push(`Weak in regular hours lately (${f1(b.intr20)} open-to-close over 20 sessions); such names have tended to recover overnight`);
    if (dip > 0) {
      const what = b.rsi <= 40 ? `RSI ${b.rsi.toFixed(0)} (oversold)` : `sold off ${f1(intra)} today`;
      reasons.push(above200 ? `Dip in an uptrend: ${what}, still above the 200-day average` : `Dip: ${what}, but below the 200-day average so it earns half credit`);
    }
    if (chased) reasons.push(`Caution: up ${f1(chg)} on ${(rvol ?? 0).toFixed(1)}x volume; chased closes have given back overnight`);
    if (!reasons.length) reasons.push("No overnight factor stands out");

    const sellReasons: string[] = [];
    if (ovnRank <= 0.35) sellReasons.push(`Habit of gapping down: ${f1(b.ovn60)} summed over the last 60 nights (bottom ${Math.max(1, Math.round(ovnRank * 100))}%)`);
    if (intrRank >= 0.65) sellReasons.push(`Gains come in regular hours (${f1(b.intr20)} open-to-close over 20 sessions), not overnight`);
    if (chased) sellReasons.push(`Chased: up ${f1(chg)} on ${(rvol ?? 0).toFixed(1)}x volume, closing near the high`);
    else if (hot > 0) sellReasons.push(b.rsi >= 70 ? `Overbought: RSI ${b.rsi.toFixed(0)}` : `Stretched: up ${f1(intra)} intraday today`);
    if (!above200) sellReasons.push(above50 ? "Below the 200-day average (long-term downtrend)" : "Below both the 50-day and 200-day averages (downtrend)");
    if (!sellReasons.length) sellReasons.push("No overnight weakness stands out");
    return {
      sym: x.sym,
      name: x.name,
      sector: x.sector,
      price: c,
      chg,
      clv,
      rvol,
      rsi: b.rsi,
      above20,
      above50,
      above200,
      ret20: b.ret20,
      rsRank: rsPct(b.ret20),
      sectorChg: sectorChg.get(x.sector) ?? 0,
      sectorRank: sectorRank(x.sector),
      distHigh: (x.ctx.high20 / c - 1) * 100,
      intraday: b.intraday,
      ovn60: b.ovn60,
      intr20: b.intr20,
      atrRank,
      ovnRank,
      intrRank,
      chased,
      atrPct: b.atrPct,
      dollarVol,
      liquid: c >= MIN_PRICE && dollarVol >= MIN_DOLLAR_VOL,
      score: Math.round(raw * 10) / 10,
      parts,
      reasons,
      sellScore: Math.round(sellRaw * 10) / 10,
      sellParts,
      sellReasons,
    };
  });
}

export const BTST_RULES =
  "Buy at the close, sell at the next open. Score 0-100 from what has actually paid overnight in this universe: " +
  "volatility rank (25), habit of gapping up over the last 60 nights (25), weak intraday trading over the last 20 sessions (20), " +
  "and an oversold dip (RSI under 40 or a 2.5%+ intraday sell-off) in a stock above its 200-day average (30). " +
  "Big up days on heavy volume lose 15 points. Only stocks above $10 with $50M+ average daily turnover.";
