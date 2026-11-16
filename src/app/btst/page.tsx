"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Card, ScoreBar, SettingsBar, Status, StockLink } from "@/components/ui";
import { scoreBtstDay } from "@/lib/btst";
import { DEFAULT_SETTINGS, fmt, money, nyNow, pct, RISK, timeAgo, tone, useData, useSettings, useUpload } from "@/lib/client";
import type { Backtest, BtstInput, BtstRow, Meta, Pulse, Snapshot } from "@/lib/types";

type SnapFile = Snapshot & { next: Snapshot["stocks"] | null };

export default function BtstPage() {
  const { data: scan, error } = useData<{ meta: Meta; rows: BtstRow[] }>("btst.json");
  const { data: snap } = useData<SnapFile>("snapshot.json");
  const { data: pulse } = useData<Pulse>("pulse.json");
  const { data: bt } = useData<Backtest>("backtest.json");
  const [upload, setUpload] = useUpload();
  const [settings] = useSettings();
  const [showAll, setShowAll] = useState(false);
  const [hideEarnings, setHideEarnings] = useState(true);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const cfg = RISK[(settings ?? DEFAULT_SETTINGS).risk];
  const account = (settings ?? DEFAULT_SETTINGS).account;

  // Re-score with the user's uploaded quotes when present.
  const live = useMemo(() => {
    if (!upload || !snap) return null;
    const uploadDay = nyDateOf(upload.at);
    // After the close the snapshot also carries context for the NEXT session.
    const useNext = snap.next && uploadDay > snap.meta.barDate;
    const ctxs = useNext ? snap.next! : snap.stocks;
    const inputs: BtstInput[] = [];
    for (const [sym, q] of Object.entries(upload.quotes)) {
      const s = ctxs[sym];
      if (s) inputs.push({ sym, name: s.name, sector: s.sector, ctx: s.ctx, bar: q });
    }
    if (inputs.length < 50) return { rows: [] as BtstRow[], matched: inputs.length, unchanged: false };
    const now = nyNow();
    const frac = uploadDay === now.date && now.open ? now.frac : 1;
    const rows = scoreBtstDay(inputs, frac)
      .map((r) => ({ ...r, earnings: ctxs[r.sym].earnings, earningsRisk: snap.stocks[r.sym]?.earningsRisk && !useNext }))
      .sort((a, b) => b.score - a.score);
    const unchanged = rows.filter((r) => Math.abs(r.chg) < 0.005).length > rows.length * 0.8;
    return { rows, matched: inputs.length, unchanged };
  }, [upload, snap]);

  if (!scan) return <Status error={error} loading />;
  const usingLive = !!live && live.rows.length > 0;
  const sell = side === "sell";
  const sc = (r: BtstRow) => (sell ? r.sellScore : r.score);
  const rows = (usingLive ? live!.rows : scan.rows).filter((r) => r.liquid).sort((a, b) => sc(b) - sc(a));
  const visible = rows.filter((r) => (showAll || sc(r) >= cfg.minScore) && !(hideEarnings && r.earningsRisk)).slice(0, showAll ? 150 : 40);
  const picks = new Set(visible.filter((r) => sc(r) >= cfg.minScore && !r.earningsRisk).slice(0, cfg.btstMax).map((r) => r.sym));
  const sellBt = bt?.btstSell?.variants[0];
  const filtered = bt?.btst.variants[1];
  const plain = bt?.btst.variants[0];

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold">BTST: {sell ? "sell at the close, buy back at the next open" : "buy at the close, sell at the next open"}</h1>
        <p className="mt-1 text-sm text-muted">
          {sell
            ? "Ranked by the overnight sell score: the stocks most likely to open lower. Each row says why."
            : "Ranked by the overnight buy score. Place the buy in the last minutes of the US session (or as a market-on-close order) and sell at the next open. Each row says why."}
        </p>
        <div className="mt-2 inline-flex overflow-hidden rounded-lg border border-line text-sm">
          <button onClick={() => setSide("buy")} className={`px-4 py-1.5 ${!sell ? "bg-up/20 font-medium text-up" : "bg-panel2 text-muted"}`}>Buy list</button>
          <button onClick={() => setSide("sell")} className={`px-4 py-1.5 ${sell ? "bg-down/20 font-medium text-down" : "bg-panel2 text-muted"}`}>Sell list</button>
        </div>
      </div>

      {sell && sellBt && (
        <div className="rounded-xl border border-down/40 bg-down/10 p-3 text-sm">
          <b>{sellBt.stats.avg > 0 ? "Backtest of shorting this list:" : "Do not short this list blindly."}</b> Shorting the top 5 at the close and covering at the next open averaged{" "}
          <b>{pct(sellBt.stats.avg, 3)}</b> per trade over {sellBt.stats.n.toLocaleString("en-US")} trades ({sellBt.stats.winRate.toFixed(0)}% winners) after costs.{" "}
          {sellBt.stats.avg > 0 ? "The edge is small." : "US large caps drift up overnight, so the short side lost money. Use this list to decide what not to hold overnight and which longs to sell before the close, not as short ideas."}
        </div>
      )}

      {pulse && (
        <div className={`rounded-xl border p-3 text-sm ${pulse.label === "Risk-off" ? "border-down/40 bg-down/10" : pulse.label === "Neutral" ? "border-warn/40 bg-warn/10" : "border-up/40 bg-up/10"}`}>
          <b>Market pulse: {pulse.label} ({pulse.score > 0 ? "+" : ""}{pulse.score}).</b> {pulse.advice}{" "}
          {filtered && plain && (
            <span className="text-muted">
              In the backtest, trading only when most stocks were above their 50-day average ({pulse.breadth.above50}% now) earned {pct(filtered.stats.avg, 3)} per trade versus {pct(plain.stats.avg, 3)} without that filter.
            </span>
          )}
        </div>
      )}

      <Card>
        <div className="p-3">
          <SettingsBar />
        </div>
      </Card>

      <div className={`rounded-xl border p-3 text-sm ${usingLive ? "border-accent/50 bg-accent/10" : "border-line bg-panel"}`}>
        {usingLive ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>
              <b>Using your uploaded quotes</b> ({live!.matched} stocks, {upload!.source}, {timeAgo(upload!.at)}).
            </span>
            <button onClick={() => setUpload(null)} className="rounded-md border border-line bg-panel2 px-2.5 py-1">Back to the automatic scan</button>
            {live!.unchanged && <span className="text-warn">These prices equal the last close, so they are probably not from a live session.</span>}
          </div>
        ) : (
          <span>
            Automatic scan of {scan.meta.barDate} ({scan.meta.session === "live" ? `intraday, about ${Math.round(scan.meta.volFrac * 100)}% of the session done` : "final close"}), run {timeAgo(scan.meta.generatedAt)}. Free prices lag about 15 minutes.{" "}
            <Link href="/data/" className="text-accent underline">Upload live quotes</Link> to re-rank with fresher prices.
            {upload && live && live.rows.length === 0 && <span className="text-warn"> Your last upload matched only {live.matched} stocks, so it is ignored.</span>}
          </span>
        )}
      </div>

      <Card
        title={`${showAll ? "All liquid stocks" : `${sell ? "Sell" : "Buy"} candidates scoring ${cfg.minScore}+`} (${visible.length})`}
        right={
          <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-xs text-muted">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={hideEarnings} onChange={(e) => setHideEarnings(e.target.checked)} /> Hide earnings tonight
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all
            </label>
          </div>
        }
      >
        {visible.length === 0 ? (
          <p className="p-4 text-sm text-muted">Nothing scores {cfg.minScore}+ on the {side} side right now. No trade is a valid outcome; tick “Show all” to see the full ranking.</p>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Stock</th>
                  <th>Score</th>
                  <th className="text-right">Price</th>
                  <th className="text-right">Day</th>
                  <th className="text-right" title="Open to now">Intraday</th>
                  <th className="text-right" title="Average true range as % of price: the typical daily swing">Daily swing</th>
                  <th className="text-right" title="Sum of the last 60 overnight moves">60 nights</th>
                  <th className="text-right">RSI</th>
                  <th className="text-right" title="Volume versus the 20-day average">Vol</th>
                  <th className="text-right">Size</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const dollars = (account * cfg.btstPosPct) / 100;
                  const shares = Math.floor(dollars / r.price);
                  return (
                    <tr key={r.sym} className={picks.has(r.sym) ? (sell ? "bg-down/5" : "bg-up/5") : ""}>
                      <td>
                        <StockLink sym={r.sym} />
                        <div className="max-w-36 truncate text-xs text-muted">{r.name}</div>
                      </td>
                      <td><ScoreBar score={sc(r)} /></td>
                      <td className="num text-right">{fmt(r.price)}</td>
                      <td className={`num text-right ${tone(r.chg)}`}>{pct(r.chg)}</td>
                      <td className={`num text-right ${tone(r.intraday)}`}>{pct(r.intraday)}</td>
                      <td className="num text-right">{fmt(r.atrPct, 1)}%</td>
                      <td className={`num text-right ${tone(r.ovn60)}`}>{pct(r.ovn60, 1)}</td>
                      <td className="num text-right">{fmt(r.rsi, 0)}</td>
                      <td className="num text-right">{r.rvol == null ? "–" : `${r.rvol.toFixed(1)}x`}</td>
                      <td className="num text-right">{shares > 0 ? `${shares} sh · ${money(shares * r.price)}` : "–"}</td>
                      <td className="min-w-72 whitespace-normal">
                        <ul className="list-disc pl-4 text-xs text-text/90">
                          {(sell ? r.sellReasons : r.reasons)?.map((x) => <li key={x}>{x}</li>)}
                        </ul>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {picks.has(r.sym) && <Badge kind={sell ? "down" : "up"}>{sell ? "Top sell" : "Top pick"}</Badge>}
                          {r.earningsRisk && <Badge kind="warn">Earnings tonight</Badge>}
                          {!r.earningsRisk && r.earnings && <Badge>Earnings {r.earnings.slice(5, 10)}</Badge>}
                          {!sell && r.chased && <Badge kind="down">Chased</Badge>}
                          {!sell && !r.above200 && <Badge>Below 200d</Badge>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-muted">
        Overnight positions cannot be protected by a stop: a stock can open well below your entry. Size is capped at {cfg.btstPosPct}% of the account per stock for that reason. The backtested edge is small (see{" "}
        <Link href="/backtest/" className="underline">Backtest</Link>) and disappears if your broker charges more than about 0.05% per round trip. This is a screening tool, not financial advice.
      </p>
    </div>
  );
}

function nyDateOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(iso));
}
