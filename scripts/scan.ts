// Downloads free market data, scores the universe, backtests the rules and writes public/data/*.json.
// Run: npm run scan          (SCAN_CACHE=1 reuses today's downloads while developing)
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { BTST_RULES, SELL_RULES, scoreBtstDay } from "../src/lib/btst";
import { ctxAt, precompute, sma, type Pre } from "../src/lib/indicators";
import { analyseIndex } from "../src/lib/indexSignals";
import { detectShort, detectSwing, mirror, simulate, SWING_RULES, SWING_SETUPS, SWING_SIDE } from "../src/lib/swing";
import type { Backtest, Bar, BtstInput, BtstRow, Check, EarningsItem, EconEvent, IndexCall, Meta, Pulse, PulseComponent, Snapshot, SwingSetup, SwingSignal, TradeStats } from "../src/lib/types";
import { fetchChart, getText, normSym, pool, type Chart } from "./net";

type U = { sym: string; name: string; sector: string; idx: string[] };
const OUT = "public/data";
const COST = 0.0005; // 0.05% round trip for slippage/fees
const r2 = (x: number) => Math.round(x * 100) / 100;
const clamp = (x: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));
const write = (name: string, data: unknown) => writeFileSync(`${OUT}/${name}`, JSON.stringify(data));

const MACRO: Record<string, string> = {
  SPY: "S&P 500 (SPY)",
  QQQ: "Nasdaq 100 (QQQ)",
  IWM: "Small caps (IWM)",
  "ES=F": "S&P futures",
  "NQ=F": "Nasdaq futures",
  "^VIX": "VIX",
  "^TNX": "10-yr yield",
  "DX-Y.NYB": "Dollar index",
  "CL=F": "Crude oil",
  "GC=F": "Gold",
  "^N225": "Nikkei",
  "^HSI": "Hang Seng",
  "^GDAXI": "DAX",
  "^FTSE": "FTSE 100",
};
const INDEXES = [
  { key: "sp500", name: "S&P 500", etf: "SPY", fut: "ES=F", contracts: "ES / MES" },
  { key: "ndx", name: "Nasdaq 100", etf: "QQQ", fut: "NQ=F", contracts: "NQ / MNQ" },
  { key: "dow", name: "Dow Jones", etf: "DIA", fut: "YM=F", contracts: "YM / MYM" },
  { key: "rut", name: "Russell 2000", etf: "IWM", fut: "RTY=F", contracts: "RTY / M2K" },
];
// NYSE full-day closures
const HOLIDAYS = new Set(["2026-11-26", "2026-12-25", "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"]);
const SECTOR_ETF: Record<string, string> = {
  XLK: "Information Technology",
  XLC: "Communication Services",
  XLY: "Consumer Discretionary",
  XLP: "Consumer Staples",
  XLF: "Financials",
  XLV: "Health Care",
  XLI: "Industrials",
  XLE: "Energy",
  XLB: "Materials",
  XLU: "Utilities",
  XLRE: "Real Estate",
};

// ---------- calendars & news ----------

function nyDate(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}
function nextWeekdays(from: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(from + "T12:00:00Z");
  while (out.length < n) {
    const iso = d.toISOString().slice(0, 10);
    if (d.getUTCDay() % 6 !== 0 && (!out.length || !HOLIDAYS.has(iso))) out.push(iso);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

async function fetchEarnings(days: string[], universe: Map<string, U>): Promise<EarningsItem[]> {
  const out: EarningsItem[] = [];
  for (const date of days) {
    try {
      const j = JSON.parse(await getText(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`, `earn_${date}`));
      for (const r of j?.data?.rows ?? []) {
        const sym = normSym(r.symbol ?? "");
        const u = universe.get(sym);
        if (!u) continue;
        const when = r.time === "time-after-hours" ? "after close" : r.time === "time-pre-market" ? "before open" : "time n/a";
        out.push({ sym, name: u.name, date, when, eps: r.epsForecast ?? "" });
      }
    } catch (e) {
      console.warn(`earnings ${date}: ${e}`);
    }
  }
  return out;
}

const HIGH = /\b(CPI|Nonfarm Payrolls|Fed Interest Rate Decision|FOMC (Statement|Press Conference|Economic Projections|Meeting Minutes)|Core PCE|PCE Price Index|GDP \(QoQ\)|Unemployment Rate|^PPI|Core PPI|Retail Sales \(MoM\)|ISM Manufacturing PMI|ISM (Non-Manufacturing|Services) PMI|Fed Chair .* (Speaks|Testifies))/i;
const MEDIUM = /(Initial Jobless Claims|JOLTS|Consumer Confidence|Michigan Consumer Sentiment|Durable Goods Orders \(MoM\)|ADP Nonfarm|Housing Starts \(|Existing Home Sales \(|New Home Sales \(|Empire State|Philadelphia Fed Manufacturing Index|S&P Global .*PMI|Speaks|Industrial Production \(MoM\)|Crude Oil Inventories|Average Hourly Earnings)/i;

async function fetchEcon(days: string[]): Promise<EconEvent[]> {
  const out: EconEvent[] = [];
  const clean = (s: string) => (s ?? "").replace(/&nbsp;/g, "").trim();
  for (const date of days) {
    try {
      // Nasdaq's endpoint is off by one: asking for day D returns the events of D-1 (checked against
      // weekly jobless claims, which are always Thursday), so ask for the following calendar day.
      const q = new Date(date + "T12:00:00Z");
      q.setUTCDate(q.getUTCDate() + 1);
      const j = JSON.parse(await getText(`https://api.nasdaq.com/api/calendar/economicevents?date=${q.toISOString().slice(0, 10)}`, `econ_for_${date}`));
      for (const r of j?.data?.rows ?? []) {
        if (r.country !== "United States") continue;
        const name = clean(r.eventName);
        const impact = HIGH.test(name) ? "high" : MEDIUM.test(name) ? "medium" : "low";
        if (impact === "low") continue;
        out.push({ date, time: clean(r.gmt), name, impact, consensus: clean(r.consensus), previous: clean(r.previous), actual: clean(r.actual) });
      }
    } catch (e) {
      console.warn(`econ ${date}: ${e}`);
    }
  }
  return out;
}

const POS = /\b(beats?|tops?|surges?|soars?|jumps?|rall(y|ies)|upgrades?|raises?|record|strong|outperform|buy rating|bullish|growth|wins?|approval|approved|partnership|buyback|hikes? dividend|all-time high)\b/i;
const NEG = /\b(miss(es)?|falls?|drops?|plunges?|sinks?|slumps?|downgrades?|cuts?|lawsuit|probe|investigation|recall|weak|underperform|sell rating|bearish|layoffs?|warns?|warning|fraud|decline|tumbles?|slides?)\b/i;

export type NewsItem = { title: string; link: string; date: string; tone: "pos" | "neg" | "neutral" };
async function fetchNews(sym: string): Promise<NewsItem[]> {
  try {
    const xml = await getText(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(sym)}&region=US&lang=en-US`, `news_${sym}_${nyDate()}`, 2);
    const items: NewsItem[] = [];
    const un = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const pick = (tag: string) => un(m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] ?? "");
      const title = pick("title");
      const date = new Date(pick("pubDate"));
      if (!title || isNaN(+date) || Date.now() - +date > 5 * 864e5) continue;
      const p = POS.test(title);
      const n = NEG.test(title);
      items.push({ title, link: pick("link"), date: date.toISOString(), tone: p && !n ? "pos" : n && !p ? "neg" : "neutral" });
    }
    return items.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  } catch {
    return [];
  }
}

// ---------- stats helpers ----------

function stats(vals: number[], curveVals?: number[], compound = false): TradeStats {
  const wins = vals.filter((v) => v > 0);
  const losses = vals.filter((v) => v <= 0);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const series = curveVals ?? vals;
  let eq = compound ? 1 : 0;
  let peak = eq;
  let dd = 0;
  for (const v of series) {
    eq = compound ? eq * (1 + v / 100) : eq + v;
    if (eq > peak) peak = eq;
    dd = Math.max(dd, compound ? (1 - eq / peak) * 100 : peak - eq);
  }
  return {
    n: vals.length,
    winRate: vals.length ? r2((wins.length / vals.length) * 100) : 0,
    avg: vals.length ? Math.round((sum(vals) / vals.length) * 1000) / 1000 : 0,
    avgWin: wins.length ? r2(sum(wins) / wins.length) : 0,
    avgLoss: losses.length ? r2(sum(losses) / losses.length) : 0,
    profitFactor: losses.length && sum(losses) !== 0 ? r2(sum(wins) / -sum(losses)) : 0,
    total: r2(compound ? (eq - 1) * 100 : eq),
    maxDD: r2(dd),
  };
}
function downsample(curve: [string, number][], max = 260): [string, number][] {
  if (curve.length <= max) return curve;
  const step = curve.length / max;
  const out: [string, number][] = [];
  for (let i = 0; i < max; i++) out.push(curve[Math.floor(i * step)]);
  out.push(curve[curve.length - 1]);
  return out;
}
function byYear(rows: { date: string; v: number }[], compound: boolean) {
  const m = new Map<string, number[]>();
  for (const r of rows) m.set(r.date.slice(0, 4), [...(m.get(r.date.slice(0, 4)) ?? []), r.v]);
  return [...m.entries()].sort().map(([year, v]) => {
    const s = stats(v, undefined, compound);
    return { year, n: s.n, avg: s.avg, winRate: s.winRate, total: s.total };
  });
}

// ---------- main ----------

type Stock = U & { bars: Bar[]; pre: Pre; mbars: Bar[]; mpre: Pre; idxOf: Map<string, number> };

async function main() {
  const t0 = Date.now();
  const universe: U[] = JSON.parse(readFileSync("data/universe.json", "utf8"));
  const uMap = new Map(universe.map((u) => [u.sym, u]));
  const notes: string[] = [];
  const failed: string[] = [];

  console.log(`fetching ${universe.length} stocks + ${Object.keys(MACRO).length + Object.keys(SECTOR_ETF).length} market symbols...`);
  const macroSyms = [...Object.keys(MACRO), ...Object.keys(SECTOR_ETF)];
  const macro = new Map<string, Chart>();
  await pool(macroSyms, 6, async (s) => {
    try {
      macro.set(s, await fetchChart(s, "2y"));
    } catch (e) {
      notes.push(`Market symbol ${s} unavailable`);
      console.warn(String(e));
    }
  });
  const spy = macro.get("SPY");
  if (!spy) throw new Error("SPY data unavailable; aborting scan");

  let done = 0;
  const charts = await pool(universe, 8, async (u) => {
    try {
      const c = await fetchChart(u.sym, "5y");
      if (++done % 100 === 0) console.log(`  ${done}/${universe.length}`);
      return c;
    } catch {
      failed.push(u.sym);
      return null;
    }
  });

  // session state from SPY
  const now = Date.now() / 1000;
  const barDate = spy.bars[spy.bars.length - 1].d;
  const live = now >= spy.regStart && now < spy.regEnd && barDate === nyDate();
  const volFrac = live ? clamp((now - spy.regStart) / (spy.regEnd - spy.regStart), 0.05, 1) : 1;

  const stocks: Stock[] = [];
  charts.forEach((c, i) => {
    if (!c) return;
    const u = universe[i];
    if (c.bars.length < 260) return void notes.push(`${u.sym}: under 1 year of history, skipped`);
    if (c.bars[c.bars.length - 1].d !== barDate) return void failed.push(u.sym);
    const mbars = mirror(c.bars);
    stocks.push({ ...u, bars: c.bars, pre: precompute(c.bars), mbars, mpre: precompute(mbars), idxOf: new Map(c.bars.map((b, j) => [b.d, j])) });
  });
  console.log(`loaded ${stocks.length} stocks, ${failed.length} failed; bar date ${barDate} (${live ? "LIVE " + Math.round(volFrac * 100) + "% of session" : "closed"})`);
  if (stocks.length < universe.length * 0.8) throw new Error("Too many symbols failed to download; aborting so old data is kept.");

  // ----- calendars
  const days = nextWeekdays(nyDate(), 6);
  const [earnings, econ] = await Promise.all([fetchEarnings(days, uMap), fetchEcon(days.slice(0, 5))]);
  if (!earnings.length) notes.push("Earnings calendar unavailable: earnings-risk flags are missing, check dates yourself.");
  const nextSession = nextWeekdays(barDate, 2)[1];
  const earnBySym = new Map<string, EarningsItem>();
  for (const e of earnings) if (!earnBySym.has(e.sym) && e.date >= barDate) earnBySym.set(e.sym, e);
  const overnightRisk = (sym: string) => {
    const e = earnBySym.get(sym);
    if (!e) return false;
    return (e.date === barDate && e.when !== "before open") || (e.date === nextSession && e.when !== "after close");
  };
  const earnText = (sym: string) => {
    const e = earnBySym.get(sym);
    return e ? `${e.date} ${e.when}` : undefined;
  };

  // ----- BTST scan (today)
  const inputs: BtstInput[] = stocks.map((s) => {
    const i = s.bars.length - 1;
    return { sym: s.sym, name: s.name, sector: s.sector, ctx: ctxAt(s.bars, s.pre, i), bar: s.bars[i] };
  });
  const btstRows: BtstRow[] = scoreBtstDay(inputs, volFrac)
    .map((r) => ({ ...r, earnings: earnText(r.sym), earningsRisk: overnightRisk(r.sym) }))
    .sort((a, b) => b.score - a.score);

  // ----- market pulse
  const pulse = buildPulse(macro, btstRows, stocks, econ, barDate, nextSession);

  // ----- index futures
  const indexCalls: IndexCall[] = [];
  await pool(INDEXES, 4, async (ix) => {
    try {
      const [etf, fut] = await Promise.all([fetchChart(ix.etf, "21y"), fetchChart(ix.fut, "2y")]);
      indexCalls.push(buildIndexCall(ix, etf.bars, fut.bars, pulse));
    } catch (e) {
      notes.push(`Index ${ix.name} unavailable`);
      console.warn(String(e));
    }
  });
  indexCalls.sort((a, b) => INDEXES.findIndex((x) => x.key === a.key) - INDEXES.findIndex((x) => x.key === b.key));

  // ----- swing scan (signals from the last 3 sessions, both directions)
  const rsOf = new Map<string, number>();
  {
    const r = stocks.map((s) => ({ sym: s.sym, v: s.bars[s.bars.length - 1].c / s.bars[s.bars.length - 127].c })).sort((a, b) => a.v - b.v);
    r.forEach((x, k) => rsOf.set(x.sym, Math.round((k / Math.max(1, r.length - 1)) * 100)));
  }
  const sector20 = new Map(pulse.sectors.map((x) => [x.sector, x.chg20]));
  const swing: SwingSignal[] = [];
  for (const s of stocks) {
    const n = s.bars.length;
    for (let i = n - 1; i >= n - 3; i--) {
      const vf = i === n - 1 ? volFrac : 1;
      for (const sig of [...detectSwing(s.bars, s.pre, i, vf), ...detectShort(s.bars, s.pre, s.mbars, s.mpre, i, vf)]) {
        const b = s.bars[i];
        const dir = sig.side === "short" ? -1 : 1;
        const dollarVol = ((s.pre.prefV[i] - s.pre.prefV[i - 20]) / 20) * b.c;
        if (b.c < 10 || dollarVol < 50e6) continue;
        const last = s.bars[n - 1].c;
        const risk = dir * (b.c - sig.stop);
        if (i < n - 1 && (dir * (last - sig.stop) <= 0 || dir * (last - b.c) > risk)) continue; // already stopped or ran away
        const e = earnBySym.get(s.sym);
        const rs = rsOf.get(s.sym) ?? 50;
        const sec = sector20.get(s.sector);
        const long = dir > 0;
        const above = b.c > s.pre.sma200[i];
        const checks: Check[] = [
          { name: "Market", ok: long ? pulse.label !== "Risk-off" : pulse.label !== "Risk-on", text: `Market pulse is ${pulse.label}` },
          { name: "Strength", ok: long ? rs >= 60 : rs <= 40, text: `6-month relative strength ${rs}/100` },
          { name: "Sector", ok: sec == null ? false : long ? sec > 0 : sec < 0, text: sec == null ? "Sector trend unavailable" : `${s.sector} ${sec >= 0 ? "+" : ""}${sec.toFixed(1)}% in 20 days` },
          { name: "Trend", ok: long ? above : !above, text: `${above ? "Above" : "Below"} the 200-day average` },
          { name: "Volume", ok: sig.rvol >= 1.2, text: `Volume ${sig.rvol.toFixed(1)}x average` },
          { name: "Earnings", ok: !e, text: e ? `Earnings ${e.date} ${e.when}` : "No earnings in the next 6 sessions" },
        ];
        swing.push({
          sym: s.sym,
          name: s.name,
          sector: s.sector,
          setup: sig.setup,
          side: sig.side,
          checks,
          rs,
          date: b.d,
          close: r2(b.c),
          stop: r2(sig.stop),
          target: r2(b.c + sig.rMult * (b.c - sig.stop)),
          riskPct: r2((risk / b.c) * 100),
          atrPct: r2((s.pre.atr[i] / b.c) * 100),
          rsi: Math.round(s.pre.rsi.rsi[i]),
          rvol: r2(sig.rvol),
          holdDays: sig.holdDays,
          note: sig.note,
          earnings: earnText(s.sym),
          earningsRisk: !!e,
        });
      }
    }
  }
  const okCount = (x: SwingSignal) => x.checks.filter((c) => c.ok).length;
  swing.sort((a, b) => b.date.localeCompare(a.date) || okCount(b) - okCount(a) || b.rvol - a.rvol);

  // ----- news for the names most likely to be opened
  const liquidRows = btstRows.filter((r) => r.liquid);
  const topSell = [...liquidRows].sort((a, b) => b.sellScore - a.sellScore).slice(0, 10).map((r) => r.sym);
  const newsSyms = [...new Set([...liquidRows.slice(0, 25).map((r) => r.sym), ...topSell, ...swing.slice(0, 30).map((s) => s.sym)])];
  const news: Record<string, NewsItem[]> = {};
  await pool(newsSyms, 6, async (s) => {
    const n = await fetchNews(s);
    if (n.length) news[s] = n;
  });

  // ----- backtest
  console.log("backtesting...");
  const backtest = runBacktest(stocks, spy.bars.length ? stocks.find((s) => s.sym === "AAPL")!.bars.map((b) => b.d) : [], live);

  // ----- write
  const meta: Meta = { generatedAt: new Date().toISOString(), barDate, session: live ? "live" : "closed", volFrac: r2(volFrac), symbols: stocks.length, failed, notes };
  rmSync(`${OUT}/stocks`, { recursive: true, force: true });
  mkdirSync(`${OUT}/stocks`, { recursive: true });
  const snapshot: Snapshot = { meta, stocks: {} };
  // The snapshot context always describes the days BEFORE `barDate`, so a manual upload of
  // live quotes for that date (or the scan itself) can be scored against it.
  for (const inp of inputs) snapshot.stocks[inp.sym] = { name: inp.name, sector: inp.sector, ctx: roundCtx(inp.ctx), earnings: earnText(inp.sym), earningsRisk: overnightRisk(inp.sym) };
  // After the close, also provide next-day context so tomorrow's upload works before the next scan.
  const nextCtx: Snapshot["stocks"] = {};
  if (!live) {
    for (const s of stocks) {
      const ext = [...s.bars, s.bars[s.bars.length - 1]]; // placeholder bar so ctxAt can look "before" tomorrow
      nextCtx[s.sym] = { name: s.name, sector: s.sector, ctx: roundCtx(ctxAt(ext, precompute(ext), ext.length - 1)), earnings: earnText(s.sym), earningsRisk: false };
    }
  }
  write("meta.json", meta);
  write("pulse.json", pulse);
  write("index.json", { meta, calls: indexCalls });
  write("btst.json", { meta, rows: btstRows.map(slimRow) });
  write("swing.json", { meta, signals: swing });
  write("snapshot.json", { ...snapshot, next: live ? null : nextCtx });
  write("calendar.json", { earnings, econ });
  write("news.json", news);
  write("backtest.json", backtest);
  for (const s of stocks) write(`stocks/${s.sym}.json`, { sym: s.sym, name: s.name, sector: s.sector, idx: s.idx, bars: s.bars.slice(-420).map((b) => [b.d, r2(b.o), r2(b.h), r2(b.l), r2(b.c), b.v]) });
  console.log(`done in ${Math.round((Date.now() - t0) / 1000)}s: pulse ${pulse.score} (${pulse.label}), ${btstRows.filter((r) => r.liquid && r.score >= 70).length} BTST candidates >= 70, ${swing.filter((x) => x.side === "long").length} swing buys, ${swing.filter((x) => x.side === "short").length} swing sells, index: ${indexCalls.map((c) => `${c.contracts.split(" ")[0]} ${c.swing.call}`).join(", ")}`);
}

function roundCtx(c: BtstInput["ctx"]): BtstInput["ctx"] {
  const o = { ...c } as Record<string, number>;
  for (const k of Object.keys(o)) o[k] = Math.round(o[k] * 10000) / 10000;
  return o as BtstInput["ctx"];
}
function slimRow(r: BtstRow): BtstRow {
  const o = { ...r } as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) if (typeof v === "number") o[k] = Math.round(v * 1000) / 1000;
  return o as BtstRow;
}

function buildPulse(macro: Map<string, Chart>, rows: BtstRow[], stocks: Stock[], econ: EconEvent[], barDate: string, nextSession: string): Pulse {
  const last = (s: string, back = 0) => {
    const b = macro.get(s)?.bars;
    return b && b.length > back ? b[b.length - 1 - back].c : NaN;
  };
  const chg = (s: string, n = 1) => (last(s) / last(s, n) - 1) * 100;
  const comps: PulseComponent[] = [];
  const add = (name: string, value: string, score: number, max: number, note: string) => comps.push({ name, value, score: Number.isFinite(score) ? r2(score) : 0, max, note: Number.isFinite(score) ? note : "data unavailable" });

  // trend
  const trendOf = (s: string) => {
    const closes = macro.get(s)?.bars.map((b) => b.c) ?? [];
    const n = closes.length - 1;
    return { c: closes[n], s20: sma(closes, 20)[n], s50: sma(closes, 50)[n], s200: sma(closes, 200)[n] };
  };
  const sp = trendOf("SPY");
  const qq = trendOf("QQQ");
  const sgn = (b: boolean) => (b ? 1 : -1);
  const trend = 4 * sgn(sp.c > sp.s20) + 4 * sgn(sp.c > sp.s50) + 5 * sgn(sp.c > sp.s200) + 4 * sgn(qq.c > qq.s20) + 4 * sgn(qq.c > qq.s50) + 4 * sgn(qq.c > qq.s200);
  const up = (b: boolean) => (b ? "above" : "below");
  add("Index trend", `SPY ${up(sp.c > sp.s20)} 20d, ${up(sp.c > sp.s50)} 50d, ${up(sp.c > sp.s200)} 200d`, trend, 25, "S&P 500 and Nasdaq 100 versus their 20/50/200-day averages");

  // volatility
  const vix = last("^VIX");
  const vix5 = chg("^VIX", 5);
  const vixLvl = vix < 15 ? 12 : vix < 18 ? 8 : vix < 22 ? 0 : vix < 28 ? -8 : -12;
  add("Volatility (VIX)", `${vix.toFixed(1)} (${vix5 >= 0 ? "+" : ""}${vix5.toFixed(0)}% in 5d)`, vixLvl + -8 * clamp(vix5 / 15), 20, "Low and falling VIX favours holding overnight; high or spiking VIX means bigger gaps");

  // breadth
  const liquid = rows.filter((r) => r.liquid);
  const adv = liquid.filter((r) => r.chg > 0).length;
  const dec = liquid.filter((r) => r.chg < 0).length;
  const pct = (f: (r: BtstRow) => boolean) => Math.round((liquid.filter(f).length / Math.max(1, liquid.length)) * 100);
  const above50 = pct((r) => r.above50);
  let newLow20 = 0;
  for (const s of stocks) {
    const n = s.bars.length - 1;
    let lo = Infinity;
    for (let j = n - 20; j < n; j++) lo = Math.min(lo, s.bars[j].l);
    if (s.bars[n].c < lo) newLow20++;
  }
  const breadth = { adv, dec, above20: pct((r) => r.above20), above50, above200: pct((r) => r.above200), newHigh20: liquid.filter((r) => r.distHigh <= 0).length, newLow20 };
  add("Breadth", `${above50}% above 50d, ${adv} up / ${dec} down`, 12 * clamp((above50 - 50) / 25) + 8 * clamp((adv / Math.max(1, adv + dec) - 0.5) / 0.25), 20, "How many stocks take part in the move");

  // futures and overseas
  const fut = (chg("ES=F") + chg("NQ=F")) / 2;
  const globals = ["^N225", "^HSI", "^GDAXI", "^FTSE"].map((s) => chg(s)).filter(Number.isFinite);
  const glob = globals.length ? globals.reduce((a, b) => a + b, 0) / globals.length : NaN;
  add("Futures & overseas", `US futures ${fut >= 0 ? "+" : ""}${fut.toFixed(2)}%, Asia/Europe ${glob >= 0 ? "+" : ""}${glob.toFixed(2)}%`, 10 * clamp(fut / 0.75) + 5 * clamp((Number.isFinite(glob) ? glob : 0) / 1), 15, "S&P/Nasdaq futures versus prior settlement, and the latest Asia/Europe sessions");

  // macro
  const tnxBp = (last("^TNX") - last("^TNX", 5)) * 100;
  const dxy5 = chg("DX-Y.NYB", 5);
  const oil5 = chg("CL=F", 5);
  add("Rates, dollar, oil", `10y ${last("^TNX").toFixed(2)}% (${tnxBp >= 0 ? "+" : ""}${tnxBp.toFixed(0)}bp/5d), DXY ${dxy5 >= 0 ? "+" : ""}${dxy5.toFixed(1)}%, oil ${oil5 >= 0 ? "+" : ""}${oil5.toFixed(1)}%`, -4 * clamp(tnxBp / 15) - 4 * clamp(dxy5 / 1) - 4 * clamp(Math.max(0, oil5) / 10), 12, "Fast-rising yields, dollar or oil pressure stocks");

  // event risk
  const upcoming = econ.filter((e) => e.impact === "high" && (e.date === nextSession || (e.date === barDate && !e.actual)));
  add("Event risk", upcoming.length ? upcoming.slice(0, 3).map((e) => e.name).join(", ") : "No major US release next session", -Math.min(8, upcoming.length * 4), 8, "High-impact US data or Fed events before your exit can gap the whole market");

  const score = Math.round(clamp(comps.reduce((a, c) => a + c.score, 0), -100, 100));
  const label = score >= 25 ? "Risk-on" : score <= -25 ? "Risk-off" : "Neutral";
  const advice =
    label === "Risk-on"
      ? "Conditions favour overnight and swing longs. Take the best-scoring setups at normal size."
      : label === "Neutral"
        ? "Mixed conditions. Be selective: fewer positions, top scores only, smaller size."
        : "Conditions are against long trades. Stay mostly in cash or trade very small; gaps down are more likely.";

  const tiles = Object.entries(MACRO)
    .filter(([s]) => macro.has(s))
    .map(([s, name]) => ({ name, sym: s, last: r2(last(s)), chg: r2(chg(s)), chg5: r2(chg(s, 5)) }));
  const sectors = Object.entries(SECTOR_ETF)
    .filter(([s]) => macro.has(s))
    .map(([s, sector]) => ({ sector, chg: r2(chg(s)), chg5: r2(chg(s, 5)), chg20: r2(chg(s, 20)) }))
    .sort((a, b) => b.chg - a.chg);
  return { score, label, advice, components: comps, tiles, sectors, breadth, events: econ };
}

function buildIndexCall(ix: (typeof INDEXES)[number], etf: Bar[], fut: Bar[], pulse: Pulse): IndexCall {
  const a = analyseIndex(etf);
  const L = a.last;
  const f = fut[fut.length - 1];
  const fp = fut[fut.length - 2];
  const vs = (m: number) => r2((L.c / m - 1) * 100);
  const sg = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`;
  const up = L.c > L.s200;
  const trend = `${up ? "Uptrend" : "Downtrend"}: ${sg(vs(L.s200))} versus the 200-day average, ${sg(vs(L.s50))} versus the 50-day`;
  const hist = (r: (typeof a.rules)[number]) => `since ${a.from.slice(0, 4)} this rule made ${r.n} trades, ${r.winRate.toFixed(0)}% winners, ${r.avg >= 0 ? "+" : ""}${r.avg.toFixed(2)}% average over ${r.avgDays.toFixed(0)} sessions`;

  // swing: the most recently triggered open rule, but only if that rule has paid historically
  const open = a.rules.filter((r) => r.active).sort((x, y) => (y.entryDate ?? "").localeCompare(x.entryDate ?? ""));
  const good = open.find((r) => r.avg > 0 && r.n >= 20);
  const swing: IndexCall["swing"] = { call: "Stand aside", fresh: false, reasons: [] };
  if (good) {
    const long = good.side === "long";
    swing.call = long ? "Buy" : "Sell";
    swing.fresh = good.fresh;
    swing.rule = good.name;
    swing.since = good.entryDate;
    swing.stop = r2(f.c * (1 + (long ? -1 : 1) * ((good.stopPct ?? 0) / 100)));
    swing.exit = good.exitText;
    swing.reasons.push(good.fresh ? `"${good.name}" triggered at the latest close` : `"${good.name}" triggered on ${good.entryDate} and is still open (${sg(good.sinceEntry ?? 0)} so far)`);
    swing.reasons.push(trend);
    swing.reasons.push(`2-day RSI ${L.rsi2.toFixed(0)}, 14-day RSI ${L.rsi14.toFixed(0)}`);
    swing.reasons.push(`Evidence: ${hist(good)}`);
    const against = long ? pulse.label === "Risk-off" : pulse.label === "Risk-on";
    swing.reasons.push(against ? `Caution: the market pulse is ${pulse.label}, which argues against this trade; use smaller size` : `Market pulse is ${pulse.label}`);
  } else {
    for (const r of open) swing.reasons.push(`"${r.name}" is triggered, but it has not paid historically (${hist(r)}), so it is not acted on`);
    swing.reasons.push(trend);
    swing.reasons.push(`2-day RSI ${L.rsi2.toFixed(0)}, 14-day RSI ${L.rsi14.toFixed(0)}: no rule with a positive record is triggered`);
    swing.reasons.push(up ? "Plan: wait to buy a dip (2-day RSI under 10) rather than chase" : "Plan: wait for a washout (14-day RSI under 30) to buy, or a sharp rally (2-day RSI over 90) to sell");
  }

  // overnight: what this kind of day has done historically
  const o = a.overnight.find((x) => x.now)!;
  const btst: IndexCall["btst"] = { call: "No trade", reasons: [] };
  if (o.n >= 50 && o.avg >= 0.03 && o.winRate >= 53) btst.call = "Buy";
  else if (o.n >= 50 && o.avg <= -0.03 && o.winRate <= 47) btst.call = "Sell";
  btst.reasons.push(`Today: ${o.label.charAt(0).toLowerCase()}${o.label.slice(1)}`);
  btst.reasons.push(`After ${o.n} such days since ${a.from.slice(0, 4)}, the move from the close to the next open averaged ${o.avg >= 0 ? "+" : ""}${o.avg.toFixed(3)}% with ${o.winRate.toFixed(0)}% up`);
  if (btst.call === "No trade") btst.reasons.push("That is too small or too close to a coin flip to trade");
  const ev = pulse.components.find((c) => c.name === "Event risk");
  if (ev && ev.score < 0) btst.reasons.push(`Caution: ${ev.value} before the next open`);

  const piv = (fp.h + fp.l + fp.c) / 3;
  const prior = fut.slice(-21, -1);
  const levels = [
    { name: "20-day high", value: Math.max(...prior.map((b) => b.h)) },
    { name: "Resistance (R1)", value: 2 * piv - fp.l },
    { name: "Pivot", value: piv },
    { name: "Support (S1)", value: 2 * piv - fp.h },
    { name: "20-day low", value: Math.min(...prior.map((b) => b.l)) },
    { name: "50-day average (approx.)", value: f.c / (1 + vs(L.s50) / 100) },
    { name: "200-day average (approx.)", value: f.c / (1 + vs(L.s200) / 100) },
  ].map((l) => ({ name: l.name, value: r2(l.value) }));

  return {
    key: ix.key,
    name: ix.name,
    etf: ix.etf,
    fut: ix.fut,
    contracts: ix.contracts,
    futLast: r2(f.c),
    futChg: r2((f.c / fp.c - 1) * 100),
    from: a.from,
    trend,
    facts: { rsi2: r2(L.rsi2), rsi14: r2(L.rsi14), atrPct: r2(L.atrPct), vs50: vs(L.s50), vs200: vs(L.s200) },
    swing,
    btst,
    overnight: a.overnight,
    rules: a.rules,
    levels,
  };
}

function runBacktest(stocks: Stock[], dates: string[], live: boolean): Backtest {
  const spyLike = stocks.find((s) => s.sym === "AAPL")!; // calendar reference with full 5y history
  const cal = live ? dates.slice(0, -1) : dates;
  // market regime from an equal-weight proxy is noisy; use the median stock's trend via % above 50d instead
  type Day = { date: string; picks70: number[]; picks60: number[]; sell70: number[]; sell60: number[]; all: number[]; pctAbove50: number };
  const dayRows: Day[] = [];
  const buckets = [
    { bucket: "Score under 20", lo: -1, hi: 20, v: [] as number[] },
    { bucket: "20 to 35", lo: 20, hi: 35, v: [] as number[] },
    { bucket: "35 to 50", lo: 35, hi: 50, v: [] as number[] },
    { bucket: "50 to 60", lo: 50, hi: 60, v: [] as number[] },
    { bucket: "60 to 70", lo: 60, hi: 70, v: [] as number[] },
    { bucket: "70 and above", lo: 70, hi: 101, v: [] as number[] },
  ];
  const start = 201;
  for (let t = start; t < cal.length - 1; t++) {
    const date = cal[t];
    const inputs: BtstInput[] = [];
    const nextOpen = new Map<string, number>();
    for (const s of stocks) {
      const i = s.idxOf.get(date);
      if (i == null || i < 201 || i + 1 >= s.bars.length) continue;
      inputs.push({ sym: s.sym, name: "", sector: s.sector, ctx: ctxAt(s.bars, s.pre, i), bar: s.bars[i] });
      nextOpen.set(s.sym, s.bars[i + 1].o);
    }
    if (inputs.length < 100) continue;
    const rows = scoreBtstDay(inputs).filter((r) => r.liquid);
    const ret = (r: BtstRow) => (nextOpen.get(r.sym)! / r.price - 1 - COST) * 100;
    for (const r of rows) {
      const v = ret(r);
      for (const b of buckets) if (r.score >= b.lo && r.score < b.hi) b.v.push(v);
    }
    const sorted = [...rows].sort((a, b) => b.score - a.score);
    const short = (r: BtstRow) => (1 - nextOpen.get(r.sym)! / r.price - COST) * 100;
    const bySell = [...rows].sort((a, b) => b.sellScore - a.sellScore);
    dayRows.push({
      date,
      sell70: bySell.filter((r) => r.sellScore >= 70).slice(0, 5).map(short),
      sell60: bySell.filter((r) => r.sellScore >= 60).slice(0, 5).map(short),
      picks70: sorted.filter((r) => r.score >= 70).slice(0, 5).map(ret),
      picks60: sorted.filter((r) => r.score >= 60).slice(0, 5).map(ret),
      all: rows.map(ret),
      pctAbove50: rows.filter((r) => r.above50).length / rows.length,
    });
  }
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const variant = (name: string, pick: (d: Day) => number[]) => {
    const trades: number[] = [];
    const daily: number[] = [];
    const curve: [string, number][] = [];
    let eq = 1;
    for (const d of dayRows) {
      const p = pick(d);
      trades.push(...p);
      const dr = mean(p);
      daily.push(dr);
      eq *= 1 + dr / 100;
      curve.push([d.date, r2((eq - 1) * 100)]);
    }
    const st = stats(trades, daily, true);
    return { name, stats: st, curve: downsample(curve) };
  };
  const variants = [
    variant("Top 5, score 70+", (d) => d.picks70),
    variant("Top 5, score 70+, only when most stocks are above their 50-day", (d) => (d.pctAbove50 >= 0.5 ? d.picks70 : [])),
    variant("Top 5, score 60+ (more trades)", (d) => d.picks60),
    variant("Baseline: every stock, every night", (d) => [mean(d.all)]),
  ];
  const sellVariants = [
    variant("Short the top 5, sell score 70+", (d) => d.sell70),
    variant("Short the top 5, sell score 70+, only when most stocks are below their 50-day", (d) => (d.pctAbove50 < 0.5 ? d.sell70 : [])),
    variant("Short the top 5, sell score 60+ (more trades)", (d) => d.sell60),
  ];
  const main = dayRows.flatMap((d) => d.picks70.map((v) => ({ date: d.date, v })));

  // swing
  const regime = new Map(dayRows.map((d) => [d.date, d.pctAbove50 >= 0.5]));
  // 6-month relative strength percentile of every stock on every date (same definition as the live scan)
  const rsAt = new Map<string, Map<string, number>>();
  for (const date of cal) {
    const v: { sym: string; r: number }[] = [];
    for (const s of stocks) {
      const i = s.idxOf.get(date);
      if (i != null && i >= 126) v.push({ sym: s.sym, r: s.bars[i].c / s.bars[i - 126].c });
    }
    v.sort((a, b) => a.r - b.r);
    const m = new Map<string, number>();
    v.forEach((x, k) => m.set(x.sym, (k / Math.max(1, v.length - 1)) * 100));
    rsAt.set(date, m);
  }
  const setups = SWING_SETUPS;
  const blank = <T,>(f: () => T) => Object.fromEntries(setups.map((k) => [k, f()])) as Record<SwingSetup, T>;
  const trades = blank(() => [] as { date: string; exit: string; r: number; pct: number; days: number; on: boolean; strong: boolean }[]);
  for (const s of stocks) {
    const busy = blank(() => -1);
    const end = s.bars.length - (live ? 2 : 1);
    for (let i = 220; i < end; i++) {
      const b = s.bars[i];
      const dollarVol = ((s.pre.prefV[i] - s.pre.prefV[i - 20]) / 20) * b.c;
      if (b.c < 10 || dollarVol < 50e6) continue;
      for (const sig of [...detectSwing(s.bars, s.pre, i), ...detectShort(s.bars, s.pre, s.mbars, s.mpre, i)]) {
        if (i <= busy[sig.setup]) continue;
        const tr = simulate(s.bars, sig, COST);
        if (!tr) continue;
        const rs = rsAt.get(b.d)?.get(s.sym) ?? 50;
        busy[sig.setup] = tr.exitIdx;
        trades[sig.setup].push({ date: b.d, exit: tr.exitDate, r: tr.r, pct: tr.pct, days: tr.days, on: (regime.get(b.d) ?? true) === (sig.side === "long"), strong: sig.side === "long" ? rs >= 60 : rs <= 40 });
      }
    }
  }
  const swing = setups.map((setup) => {
    const tr = trades[setup].sort((a, b) => a.exit.localeCompare(b.exit));
    let eq = 0;
    const curve: [string, number][] = tr.map((t) => [t.exit, r2((eq += t.r))]);
    return {
      setup,
      side: SWING_SIDE[setup],
      rules: SWING_RULES[setup],
      all: stats(tr.map((t) => t.r)),
      riskOn: stats(tr.filter((t) => t.on).map((t) => t.r)),
      checked: stats(tr.filter((t) => t.on && t.strong).map((t) => t.r)),
      avgHold: r2(mean(tr.map((t) => t.days))),
      avgPct: r2(mean(tr.map((t) => t.pct))),
      curve: downsample(curve),
      byYear: byYear(tr.map((t) => ({ date: t.exit, v: t.r })), false),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    from: dayRows[0]?.date ?? "",
    to: dayRows[dayRows.length - 1]?.date ?? "",
    caveats: [
      "Uses today's index members for the whole period (survivorship bias): stocks that fell out of the indexes are missing, which flatters results.",
      "Historical earnings dates are not excluded, so the live scan (which flags earnings) will behave a little differently.",
      "Assumes you get the closing price on entry and the opening price on exit, minus 0.05% for costs. Real fills, spreads and taxes will be worse.",
      "Short trades ignore borrow fees and hard-to-borrow restrictions, and a short position has no upper limit on its loss.",
      "Past results do not predict future results. Treat these numbers as a sanity check, not a promise.",
    ],
    btst: {
      rules: BTST_RULES,
      variants,
      buckets: buckets.map((b) => ({ bucket: b.bucket, n: b.v.length, avg: Math.round(mean(b.v) * 1000) / 1000, winRate: r2((b.v.filter((x) => x > 0).length / Math.max(1, b.v.length)) * 100) })),
      byYear: byYear(main, false).map((y) => ({ ...y, total: r2(y.total / 5) })),
    },
    btstSell: { rules: SELL_RULES, variants: sellVariants },
    swing,
  };
  void spyLike;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
