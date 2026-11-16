"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { PriceChart, SERIES, type BarTuple } from "@/components/charts";
import { Badge, Card, ScoreBar, Status } from "@/components/ui";
import { BTST_PARTS, BTST_WEIGHTS, CHASE_PENALTY, SELL_PARTS, SELL_WEIGHTS } from "@/lib/btst";
import { fmt, pct, timeAgo, tone, useData } from "@/lib/client";
import { SWING_LABEL } from "@/lib/swing";
import type { BtstRow, Meta, SwingSignal } from "@/lib/types";

type StockFile = { sym: string; name: string; sector: string; idx: string[]; bars: BarTuple[] };
type News = Record<string, { title: string; link: string; date: string; tone: "pos" | "neg" | "neutral" }[]>;

export default function Page() {
  return (
    <Suspense fallback={<Status error={null} loading />}>
      <Stock />
    </Suspense>
  );
}

function Stock() {
  const sp = useSearchParams();
  const router = useRouter();
  const sym = (sp.get("s") ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const stop = Number(sp.get("stop")) || undefined;
  const target = Number(sp.get("target")) || undefined;
  const [q, setQ] = useState("");
  const { data: scan } = useData<{ meta: Meta; rows: BtstRow[] }>("btst.json");
  const { data: stock, error } = useData<StockFile>(sym ? `stocks/${sym}.json` : null);
  const { data: swing } = useData<{ signals: SwingSignal[] }>("swing.json");
  const { data: news } = useData<News>("news.json");

  const search = (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const s = q.trim().toUpperCase().replace(".", "-");
        if (s) router.push(`/stock/?s=${s}`);
        setQ("");
      }}
    >
      <input list="syms" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Symbol, e.g. NVDA" className="w-44" aria-label="Symbol" />
      <datalist id="syms">{scan?.rows.map((r) => <option key={r.sym} value={r.sym}>{r.name}</option>)}</datalist>
      <button className="rounded-lg bg-accent px-3 font-medium text-bg">Open</button>
    </form>
  );

  if (!sym) return <div className="grid gap-3"><h1 className="text-xl font-semibold">Stock detail</h1>{search}<p className="text-sm text-muted">Open any S&amp;P 500 or Nasdaq-100 stock.</p></div>;
  if (!stock) return <div className="grid gap-3">{search}<Status error={error ? `${sym} is not in the scanned universe (S&P 500 and Nasdaq-100), or no scan has run yet.` : null} loading={!error} /></div>;

  const row = scan?.rows.find((r) => r.sym === sym);
  const signals = swing?.signals.filter((s) => s.sym === sym) ?? [];
  const items = news?.[sym] ?? [];
  const last = stock.bars[stock.bars.length - 1];
  const prev = stock.bars[stock.bars.length - 2];
  const hi52 = Math.max(...stock.bars.slice(-252).map((b) => b[2]));
  const lo52 = Math.min(...stock.bars.slice(-252).map((b) => b[3]));
  const y = sym.replace("-", ".");

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {sym} <span className="font-normal text-muted">{stock.name}</span>
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span className="num text-2xl font-semibold">{fmt(last[4])}</span>
            <span className={`num ${tone(last[4] - prev[4])}`}>{pct((last[4] / prev[4] - 1) * 100)}</span>
            <Badge>{stock.sector}</Badge>
            {stock.idx.map((i) => <Badge key={i}>{i === "NDX" ? "Nasdaq-100" : "S&P 500"}</Badge>)}
            {row?.earnings && <Badge kind={row.earningsRisk ? "warn" : "muted"}>Earnings {row.earnings}</Badge>}
          </div>
        </div>
        {search}
      </div>

      <Card
        title={`Daily chart to ${last[0]}`}
        right={
          <div className="flex gap-3 text-xs text-muted">
            {["EMA 20", "SMA 50", "SMA 200"].map((n, i) => (
              <span key={n} className="flex items-center gap-1"><span className="inline-block h-0.5 w-3" style={{ background: SERIES[i] }} />{n}</span>
            ))}
          </div>
        }
      >
        <PriceChart bars={stock.bars} stop={stop} target={target} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Overnight (BTST) score" right={row && <ScoreBar score={row.score} />}>
          {row ? (
            <ul className="divide-y divide-line text-sm">
              {Object.entries(BTST_PARTS).map(([k, label]) => {
                const max = k === "chased" ? -CHASE_PENALTY : BTST_WEIGHTS[k as keyof typeof BTST_WEIGHTS];
                const v = row.parts[k] ?? 0;
                if (k === "chased" && !v) return null;
                return (
                  <li key={k} className="flex items-center justify-between gap-3 px-4 py-2">
                    <span>{label}</span>
                    <span className={`num shrink-0 ${v < 0 ? "text-down" : ""}`}>{v.toFixed(0)} <span className="text-muted">/ {max}</span></span>
                  </li>
                );
              })}
              <li className="px-4 py-2.5 text-xs">
                <b>Why buy overnight:</b>
                <ul className="mt-0.5 list-disc pl-4 text-text/90">{row.reasons?.map((x) => <li key={x}>{x}</li>)}</ul>
              </li>
              <li className="px-4 py-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <b>Why sell or avoid overnight:</b>
                  <span className="num text-muted">sell score <b className={row.sellScore >= 60 ? "text-down" : "text-text"}>{row.sellScore?.toFixed(0)}</b> / 100</span>
                </div>
                <ul className="mt-0.5 list-disc pl-4 text-text/90">{row.sellReasons?.map((x) => <li key={x}>{x}</li>)}</ul>
                <div className="mt-1 text-muted">
                  {Object.entries(SELL_PARTS).map(([k, label]) => `${label}: ${(row.sellParts?.[k] ?? 0).toFixed(0)}/${SELL_WEIGHTS[k as keyof typeof SELL_WEIGHTS]}`).join(" · ")}
                </div>
              </li>
              <li className="grid grid-cols-2 gap-x-4 gap-y-1 px-4 py-3 text-xs text-muted sm:grid-cols-3">
                <span>RSI(14): <b className="text-text">{fmt(row.rsi, 0)}</b></span>
                <span>Daily swing: <b className="text-text">{fmt(row.atrPct, 1)}%</b></span>
                <span>Volume: <b className="text-text">{row.rvol == null ? "–" : `${row.rvol.toFixed(1)}x avg`}</b></span>
                <span>60 nights: <b className={tone(row.ovn60)}>{pct(row.ovn60, 1)}</b></span>
                <span>20 days intraday: <b className={tone(row.intr20)}>{pct(row.intr20, 1)}</b></span>
                <span>20-day return: <b className={tone(row.ret20)}>{pct(row.ret20, 1)}</b></span>
                <span>Trend: <b className="text-text">{[row.above20 && "20d", row.above50 && "50d", row.above200 && "200d"].filter(Boolean).join(", ") || "below all"}{row.above20 || row.above50 || row.above200 ? " ✓" : ""}</b></span>
                <span>52-week range: <b className="text-text">{fmt(lo52, 0)}–{fmt(hi52, 0)}</b></span>
                <span>Avg turnover: <b className="text-text">${(row.dollarVol / 1e6).toFixed(0)}M/day</b></span>
              </li>
            </ul>
          ) : (
            <p className="p-4 text-sm text-muted">No score for this stock in the latest scan.</p>
          )}
        </Card>

        <div className="grid content-start gap-4">
          <Card title="Swing setups">
            {signals.length ? (
              <ul className="divide-y divide-line text-sm">
                {signals.map((s) => (
                  <li key={s.setup + s.date} className="px-4 py-2.5">
                    <Badge kind={s.side === "short" ? "down" : "up"}>{s.side === "short" ? "Sell" : "Buy"}</Badge> <b>{SWING_LABEL[s.setup]}</b> <span className="text-muted">on {s.date}</span>
                    <div className="num text-xs">
                      Close {fmt(s.close)} · <span className="text-down">stop {fmt(s.stop)}</span> · <span className="text-up">{s.setup === "bounce" ? "sell on a close above the 5-day average" : s.setup === "fade" ? "cover on a close below the 5-day average" : `target ${fmt(s.target)}`}</span> · exit within {s.holdDays} sessions
                    </div>
                    <div className="text-xs text-muted">{s.note}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px]">
                      {s.checks?.map((c) => <span key={c.name} className={c.ok ? "text-muted" : "text-down"}>{c.ok ? "✓" : "✗"} {c.text}</span>)}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-muted">No active swing setup.</p>
            )}
          </Card>

          <Card title="Recent headlines">
            {items.length ? (
              <ul className="divide-y divide-line text-sm">
                {items.map((n) => (
                  <li key={n.link} className="flex gap-2 px-4 py-2">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.tone === "pos" ? "bg-up" : n.tone === "neg" ? "bg-down" : "bg-muted"}`} title={n.tone === "pos" ? "Positive wording" : n.tone === "neg" ? "Negative wording" : "Neutral"} />
                    <a href={n.link} target="_blank" rel="noreferrer" className="hover:underline">
                      {n.title} <span className="whitespace-nowrap text-xs text-muted">{timeAgo(n.date)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-muted">Headlines are fetched only for the top-ranked stocks. Use the links below for this one.</p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-xs">
              <span className="text-muted">Check elsewhere:</span>
              <a className="text-accent underline" target="_blank" rel="noreferrer" href={`https://finance.yahoo.com/quote/${sym}`}>Yahoo (news, after-hours)</a>
              <a className="text-accent underline" target="_blank" rel="noreferrer" href={`https://finviz.com/quote.ashx?t=${sym}`}>Finviz (short interest, insiders)</a>
              <a className="text-accent underline" target="_blank" rel="noreferrer" href={`https://www.tradingview.com/symbols/${y}/`}>TradingView</a>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
