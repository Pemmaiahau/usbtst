"use client";
import { Badge, Card, Status } from "@/components/ui";
import { fmt, pct, tone, useData } from "@/lib/client";
import type { IndexCall, Meta, Pulse } from "@/lib/types";

const callColor = (c: string) => (c === "Buy" ? "text-up" : c === "Sell" ? "text-down" : "text-muted");
const callBox = (c: string) => (c === "Buy" ? "border-up/40 bg-up/10" : c === "Sell" ? "border-down/40 bg-down/10" : "border-line bg-panel2");

export default function FuturesPage() {
  const { data, error } = useData<{ meta: Meta; calls: IndexCall[] }>("index.json");
  const { data: pulse } = useData<Pulse>("pulse.json");
  if (!data) return <Status error={error} loading />;
  if (!data.calls.length) return <Status error="Index data was unavailable in the last scan." loading={false} />;

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold">Index futures: buy, sell or stand aside</h1>
        <p className="mt-1 text-sm text-muted">
          One swing call (days) and one overnight call (today&apos;s close to tomorrow&apos;s open) for each index future. A call appears only when a rule with a positive
          20-year record is triggered; otherwise the answer is to stand aside.
        </p>
      </div>

      {pulse && (
        <div className={`rounded-xl border p-3 text-sm ${pulse.label === "Risk-off" ? "border-down/40 bg-down/10" : pulse.label === "Neutral" ? "border-warn/40 bg-warn/10" : "border-up/40 bg-up/10"}`}>
          <b>Market pulse: {pulse.label} ({pulse.score > 0 ? "+" : ""}{pulse.score}).</b> {pulse.advice}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {data.calls.map((c) => (
          <Card
            key={c.key}
            title={
              <span>
                {c.name} <span className="font-normal text-muted">· {c.contracts}</span>
              </span>
            }
            right={
              <span className="num text-sm">
                <b>{fmt(c.futLast)}</b> <span className={tone(c.futChg)}>{pct(c.futChg)}</span>
              </span>
            }
          >
            <div className="grid gap-3 p-4">
              <div className={`rounded-lg border p-3 ${callBox(c.swing.call)}`}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-xs text-muted">Swing</span>
                  <span className={`text-2xl font-semibold ${callColor(c.swing.call)}`}>{c.swing.call}</span>
                  {c.swing.rule && <span className="text-sm">{c.swing.rule}</span>}
                  {c.swing.call !== "Stand aside" && <Badge kind={c.swing.fresh ? "accent" : "muted"}>{c.swing.fresh ? "New today" : `Open since ${c.swing.since?.slice(5)}`}</Badge>}
                </div>
                {c.swing.stop != null && (
                  <div className="num mt-1 text-sm">
                    <span className="text-down">Stop {fmt(c.swing.stop)}</span> <span className="text-muted">· {c.swing.exit}</span>
                  </div>
                )}
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-text/90">
                  {c.swing.reasons.map((r) => <li key={r}>{r}</li>)}
                </ul>
              </div>

              <div className={`rounded-lg border p-3 ${callBox(c.btst.call)}`}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-xs text-muted">Overnight (BTST)</span>
                  <span className={`text-2xl font-semibold ${callColor(c.btst.call)}`}>{c.btst.call}</span>
                  {c.btst.call !== "No trade" && <span className="text-sm">{c.btst.call === "Buy" ? "Buy the close, sell the next open" : "Sell the close, buy back at the next open"}</span>}
                </div>
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-text/90">
                  {c.btst.reasons.map((r) => <li key={r}>{r}</li>)}
                </ul>
              </div>

              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-line text-xs sm:grid-cols-4">
                {c.levels.map((l) => (
                  <div key={l.name} className="bg-panel px-2 py-1.5">
                    <div className="text-muted">{l.name}</div>
                    <div className={`num font-semibold ${l.value > c.futLast ? "text-down" : "text-up"}`}>{fmt(l.value)}</div>
                  </div>
                ))}
                <div className="bg-panel px-2 py-1.5">
                  <div className="text-muted">Typical daily range</div>
                  <div className="num font-semibold">{fmt(c.facts.atrPct, 1)}%</div>
                </div>
              </div>

              <details className="text-xs">
                <summary className="cursor-pointer text-muted">Rule record since {c.from.slice(0, 4)} (tested on {c.etf})</summary>
                <div className="mt-2 overflow-x-auto">
                  <table>
                    <thead>
                      <tr>
                        <th>Rule</th>
                        <th>Side</th>
                        <th className="text-right">Trades</th>
                        <th className="text-right">Winners</th>
                        <th className="text-right">Avg / trade</th>
                        <th className="text-right">Profit factor</th>
                        <th className="text-right">Avg hold</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.rules.map((r) => (
                        <tr key={r.key} title={r.rules}>
                          <td className="whitespace-normal">
                            {r.name} {r.active && <Badge kind="accent">Triggered</Badge>} {r.avg <= 0 && <Badge kind="down">Not used</Badge>}
                          </td>
                          <td className={r.side === "long" ? "text-up" : "text-down"}>{r.side === "long" ? "Buy" : "Sell"}</td>
                          <td className="num text-right">{r.n}</td>
                          <td className="num text-right">{r.winRate.toFixed(0)}%</td>
                          <td className={`num text-right ${tone(r.avg)}`}>{pct(r.avg)}</td>
                          <td className="num text-right">{r.profitFactor.toFixed(2)}</td>
                          <td className="num text-right">{r.avgDays.toFixed(1)} d</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="mt-2 grid gap-1 text-muted">
                  {c.rules.map((r) => <li key={r.key}><b className="text-text">{r.name}:</b> {r.rules}</li>)}
                </ul>
                <div className="mt-3 overflow-x-auto">
                  <table>
                    <thead>
                      <tr>
                        <th>Close to next open, by kind of day</th>
                        <th className="text-right">Days</th>
                        <th className="text-right">Avg</th>
                        <th className="text-right">Up</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.overnight.map((o) => (
                        <tr key={o.label} className={o.now ? "bg-accent/10" : ""}>
                          <td className="whitespace-normal">{o.label} {o.now && <Badge kind="accent">Today</Badge>}</td>
                          <td className="num text-right">{o.n}</td>
                          <td className={`num text-right ${tone(o.avg)}`}>{pct(o.avg, 3)}</td>
                          <td className="num text-right">{o.winRate.toFixed(0)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted">
        Signals and their records are computed on the matching ETF&apos;s regular-session daily bars (SPY, QQQ, DIA, IWM) after 0.02% costs, then shown at the futures price; moving averages
        are approximate in futures points. Futures are leveraged: one ES point is $50 (MES $5), one NQ point $20 (MNQ $2), one YM point $5 (MYM $0.50), one RTY point $50 (M2K $5).
        Size the position from the stop distance, not from margin. Scans use daily data, so intraday entries are your own judgement. This is a screening tool, not financial advice.
      </p>
    </div>
  );
}
