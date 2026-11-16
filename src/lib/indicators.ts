import type { Bar, Ctx } from "./types";

export function sma(vals: number[], n: number): number[] {
  const out = new Array<number>(vals.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < vals.length; i++) {
    s += vals[i];
    if (i >= n) s -= vals[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

export function ema(vals: number[], n: number): number[] {
  const out = new Array<number>(vals.length).fill(NaN);
  if (vals.length < n) return out;
  const k = 2 / (n + 1);
  let e = 0;
  for (let i = 0; i < n; i++) e += vals[i];
  e /= n;
  out[n - 1] = e;
  for (let i = n; i < vals.length; i++) {
    e = vals[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

/** Wilder RSI state arrays; rsi[i] is derived from gain[i], loss[i]. */
export function rsiState(closes: number[], n = 14): { gain: number[]; loss: number[]; rsi: number[] } {
  const len = closes.length;
  const gain = new Array<number>(len).fill(NaN);
  const loss = new Array<number>(len).fill(NaN);
  const rsi = new Array<number>(len).fill(NaN);
  if (len <= n) return { gain, loss, rsi };
  let g = 0;
  let l = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g += d;
    else l -= d;
  }
  g /= n;
  l /= n;
  gain[n] = g;
  loss[n] = l;
  rsi[n] = rsiFrom(g, l);
  for (let i = n + 1; i < len; i++) {
    const d = closes[i] - closes[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
    gain[i] = g;
    loss[i] = l;
    rsi[i] = rsiFrom(g, l);
  }
  return { gain, loss, rsi };
}

export function rsiFrom(g: number, l: number): number {
  if (l === 0) return g === 0 ? 50 : 100;
  return 100 - 100 / (1 + g / l);
}

export function atr(bars: Bar[], n = 14): number[] {
  const out = new Array<number>(bars.length).fill(NaN);
  if (bars.length <= n) return out;
  let a = 0;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const pc = bars[i - 1].c;
    const tr = Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
    if (i <= n) {
      a += tr;
      if (i === n) {
        a /= n;
        out[i] = a;
      }
    } else {
      a = (a * (n - 1) + tr) / n;
      out[i] = a;
    }
  }
  return out;
}

export type Pre = {
  closes: number[];
  prefC: number[]; // prefix sums, prefC[i] = sum closes[0..i-1]
  prefV: number[];
  prefOvn: number[]; // prefix sums of overnight returns (bar i: open[i]/close[i-1]-1)
  prefIntr: number[]; // prefix sums of intraday returns (close/open-1)
  rsi: ReturnType<typeof rsiState>;
  atr: number[];
  ema20: number[];
  sma50: number[];
  sma200: number[];
};

export function precompute(bars: Bar[]): Pre {
  const closes = bars.map((b) => b.c);
  const prefC = [0];
  const prefV = [0];
  const prefOvn = [0];
  const prefIntr = [0];
  for (let i = 0; i < bars.length; i++) {
    prefC.push(prefC[i] + bars[i].c);
    prefV.push(prefV[i] + bars[i].v);
    prefOvn.push(prefOvn[i] + (i ? bars[i].o / bars[i - 1].c - 1 : 0));
    prefIntr.push(prefIntr[i] + (bars[i].o > 0 ? bars[i].c / bars[i].o - 1 : 0));
  }
  return {
    closes,
    prefC,
    prefV,
    prefOvn,
    prefIntr,
    rsi: rsiState(closes),
    atr: atr(bars),
    ema20: ema(closes, 20),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
  };
}

export const MIN_HISTORY = 201;

/** Context for evaluating day `i`, built only from bars before `i`. Requires i >= 200. */
export function ctxAt(bars: Bar[], pre: Pre, i: number): Ctx {
  let high20 = 0;
  for (let j = i - 20; j < i; j++) if (bars[j].h > high20) high20 = bars[j].h;
  return {
    prevClose: bars[i - 1].c,
    sum19: pre.prefC[i] - pre.prefC[i - 19],
    sum49: pre.prefC[i] - pre.prefC[i - 49],
    sum199: pre.prefC[i] - pre.prefC[i - 199],
    avgVol20: (pre.prefV[i] - pre.prefV[i - 20]) / 20,
    high20,
    avgGain: pre.rsi.gain[i - 1],
    avgLoss: pre.rsi.loss[i - 1],
    close20ago: bars[i - 20].c,
    atr14: pre.atr[i - 1],
    ovnSum59: pre.prefOvn[i] - pre.prefOvn[i - 59],
    intrSum19: pre.prefIntr[i] - pre.prefIntr[i - 19],
  };
}
