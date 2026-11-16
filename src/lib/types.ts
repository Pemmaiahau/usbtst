// Shared types used by the scan script (Node) and the web app (browser).

export type Bar = { d: string; o: number; h: number; l: number; c: number; v: number };

/** Everything we need to know about a stock *before* the evaluation day. */
export type Ctx = {
  prevClose: number;
  sum19: number; // sum of the last 19 closes (add today's price -> SMA20)
  sum49: number;
  sum199: number;
  avgVol20: number;
  high20: number; // highest high of the prior 20 sessions
  avgGain: number; // Wilder RSI(14) state
  avgLoss: number;
  close20ago: number; // close 20 sessions before the evaluation day
  atr14: number;
  ovnSum59: number; // sum of the prior 59 overnight (close->open) returns, as fractions
  intrSum19: number; // sum of the prior 19 intraday (open->close) returns
};

/** The evaluation day's bar. Only `c` is mandatory (manual uploads may lack the rest). */
export type DayBar = { o?: number; h?: number; l?: number; c: number; v?: number };

export type BtstInput = {
  sym: string;
  name: string;
  sector: string;
  ctx: Ctx;
  bar: DayBar;
};

export type BtstRow = {
  sym: string;
  name: string;
  sector: string;
  price: number;
  chg: number; // day change %
  clv: number | null; // close location in day's range 0..1
  rvol: number | null; // projected volume / 20d average
  rsi: number;
  above20: boolean;
  above50: boolean;
  above200: boolean;
  ret20: number; // 20-session return %
  rsRank: number; // percentile 0..1 of ret20 in universe
  sectorChg: number; // median day change of the sector %
  sectorRank: number; // 0..1
  distHigh: number; // % below prior 20d high (negative = above it)
  intraday: number | null; // today's open->close %
  ovn60: number; // sum of last 60 overnight returns %
  intr20: number; // sum of last 20 intraday returns %
  atrRank: number;
  ovnRank: number;
  intrRank: number;
  chased: boolean; // big up day on heavy volume: historically poor overnight
  atrPct: number;
  dollarVol: number; // avg daily $ volume
  liquid: boolean;
  score: number; // 0..100, buy at the close / sell at the open
  parts: Record<string, number>;
  reasons: string[]; // plain-language reasons behind the buy score
  sellScore: number; // 0..100, sell (or avoid holding) overnight
  sellParts: Record<string, number>;
  sellReasons: string[];
  earnings?: string; // e.g. "2026-11-17 after close"
  earningsRisk?: boolean;
};

export type Side = "long" | "short";
export type SwingSetup = "pullback" | "breakout" | "gap" | "bounce" | "rally" | "breakdown" | "gapdown" | "fade";
export type Check = { name: string; ok: boolean; text: string };

export type SwingSignal = {
  sym: string;
  name: string;
  sector: string;
  setup: SwingSetup;
  side: Side;
  checks: Check[]; // confluence checks (market, relative strength, sector, trend, volume, earnings)
  rs: number; // 6-month relative strength percentile 0..100
  date: string; // signal day
  close: number;
  stop: number;
  target: number;
  riskPct: number; // |close - stop| / close %
  atrPct: number;
  rsi: number;
  rvol: number;
  holdDays: number; // time stop
  note: string;
  earnings?: string;
  earningsRisk?: boolean;
};

export type PulseComponent = { name: string; value: string; score: number; max: number; note: string };

export type Pulse = {
  score: number; // -100..100
  label: "Risk-on" | "Neutral" | "Risk-off";
  advice: string;
  components: PulseComponent[];
  tiles: { name: string; sym: string; last: number; chg: number; chg5: number }[];
  sectors: { sector: string; chg: number; chg5: number; chg20: number }[];
  breadth: { adv: number; dec: number; above20: number; above50: number; above200: number; newHigh20: number; newLow20: number };
  events: EconEvent[];
};

export type EconEvent = { date: string; time: string; name: string; impact: "high" | "medium" | "low"; consensus: string; previous: string; actual: string };
export type EarningsItem = { sym: string; name: string; date: string; when: string; eps: string };

export type Meta = {
  generatedAt: string;
  barDate: string;
  session: "live" | "closed";
  volFrac: number;
  symbols: number;
  failed: string[];
  notes: string[];
};

export type Snapshot = {
  meta: Meta;
  stocks: Record<string, { name: string; sector: string; ctx: Ctx; earnings?: string; earningsRisk?: boolean }>;
};

export type TradeStats = {
  n: number;
  winRate: number;
  avg: number; // avg % (BTST) or avg R (swing)
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  total: number;
  maxDD: number;
};

export type Backtest = {
  generatedAt: string;
  from: string;
  to: string;
  caveats: string[];
  btst: {
    rules: string;
    variants: { name: string; stats: TradeStats; curve: [string, number][] }[];
    buckets: { bucket: string; n: number; avg: number; winRate: number }[];
    byYear: { year: string; n: number; avg: number; winRate: number; total: number }[];
  };
  btstSell: { rules: string; variants: { name: string; stats: TradeStats; curve: [string, number][] }[] };
  swing: {
    setup: SwingSetup;
    side: Side;
    rules: string;
    all: TradeStats;
    riskOn: TradeStats; // market aligned with the trade direction
    checked: TradeStats; // market aligned AND relative strength on the trade's side
    avgHold: number;
    avgPct: number;
    curve: [string, number][];
    byYear: { year: string; n: number; avg: number; winRate: number; total: number }[];
  }[];
};

// ---------- index futures ----------

export type IndexRuleStat = {
  key: string;
  name: string;
  side: Side;
  rules: string;
  n: number;
  winRate: number;
  avg: number; // avg % per trade after costs
  profitFactor: number;
  avgDays: number;
  active: boolean; // a trade from this rule is open now
  fresh: boolean; // it triggered on the latest bar
  entryDate?: string;
  sinceEntry?: number; // % move in the trade's favour since entry
  stopPct?: number; // distance from the latest close to the stop, %
};

export type IndexCall = {
  key: string;
  name: string;
  etf: string; // signals and backtests are computed on this ETF's cash-session bars
  fut: string;
  contracts: string; // e.g. "ES / MES"
  futLast: number;
  futChg: number;
  from: string; // start of the backtest history
  trend: string;
  facts: { rsi2: number; rsi14: number; atrPct: number; vs50: number; vs200: number };
  swing: { call: "Buy" | "Sell" | "Stand aside"; fresh: boolean; rule?: string; since?: string; reasons: string[]; stop?: number; exit?: string };
  btst: { call: "Buy" | "Sell" | "No trade"; reasons: string[] };
  overnight: { label: string; n: number; avg: number; winRate: number; now: boolean }[];
  rules: IndexRuleStat[];
  levels: { name: string; value: number }[];
};
