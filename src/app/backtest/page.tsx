"use client";
import { CurveChart } from "@/components/charts";
import { Card, Status } from "@/components/ui";
import { pct, tone, useData } from "@/lib/client";
import { SWING_LABEL } from "@/lib/swing";
import type { Backtest } from "@/lib/types";

const r = (x: number, d = 2) => `${x > 0 ? "+" : ""}${x.toFixed(d)}R`;

export default function BacktestPage() {
  const { data: b, error } = useData<Backtest>("backtest.json");
  if (!b) return <Status error={error} loading />;
  const best = b.btst.variants[1];
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold">Backtest: do these rules actually work?</h1>
        <p className="mt-1 text-sm text-muted">
          Every rule on this site replayed over {b.from} to {b.to} on the current S&amp;P 500 and Nasdaq-100 members, after 0.05% costs per trade. Recomputed on every scan.
        </p>
      </div>

      <div className="rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm">
        <b>Read this first.</b> The edges are small. The best BTST variant averaged {pct(best.stats.avg, 3)} per trade with {best.stats.winRate.toFixed(0)}% winners and a worst drawdown of {best.stats.maxDD.toFixed(0)}%. That is a slight statistical tilt, not a reliable income, and some years lost money.
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-text/90">
          {b.caveats.map((c) => <li key={c}>{c}</li>)}
          <li>The BTST score weights were chosen after studying this same period, so future results will probably be weaker than shown.</li>
        </ul>
      </div>

      <Card title="BTST: buy the close, sell the next open">
        <p className="px-4 pt-3 text-xs text-muted">{b.btst.rules}</p>
        <CurveChart series={b.btst.variants.map((v) => ({ name: v.name, points: v.curve }))} />
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Variant (equal weight, compounded)</th>
                <th className="text-right">Trades</th>
                <th className="text-right">Winners</th>
                <th className="text-right">Avg / trade</th>
                <th className="text-right">Avg win</th>
                <th className="text-right">Avg loss</th>
                <th className="text-right" title="Gross profit divided by gross loss">Profit factor</th>
                <th className="text-right">Total return</th>
                <th className="text-right">Worst drawdown</th>
              </tr>
            </thead>
            <tbody>
              {b.btst.variants.map((v) => (
                <tr key={v.name}>
                  <td className="whitespace-normal">{v.name}</td>
                  <td className="num text-right">{v.stats.n.toLocaleString("en-US")}</td>
                  <td className="num text-right">{v.stats.winRate.toFixed(1)}%</td>
                  <td className={`num text-right ${tone(v.stats.avg)}`}>{pct(v.stats.avg, 3)}</td>
                  <td className="num text-right">{pct(v.stats.avgWin)}</td>
                  <td className="num text-right">{pct(v.stats.avgLoss)}</td>
                  <td className="num text-right">{v.stats.profitFactor.toFixed(2)}</td>
                  <td className={`num text-right ${tone(v.stats.total)}`}>{pct(v.stats.total, 0)}</td>
                  <td className="num text-right">-{v.stats.maxDD.toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {b.btstSell && (
        <Card title="BTST sell list: short the close, cover the next open">
          <p className="px-4 pt-3 text-xs text-muted">{b.btstSell.rules}</p>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Variant</th>
                  <th className="text-right">Trades</th>
                  <th className="text-right">Winners</th>
                  <th className="text-right">Avg / trade</th>
                  <th className="text-right">Profit factor</th>
                  <th className="text-right">Total return</th>
                  <th className="text-right">Worst drawdown</th>
                </tr>
              </thead>
              <tbody>
                {b.btstSell.variants.map((v) => (
                  <tr key={v.name}>
                    <td className="whitespace-normal">{v.name}</td>
                    <td className="num text-right">{v.stats.n.toLocaleString("en-US")}</td>
                    <td className="num text-right">{v.stats.winRate.toFixed(1)}%</td>
                    <td className={`num text-right ${tone(v.stats.avg)}`}>{pct(v.stats.avg, 3)}</td>
                    <td className="num text-right">{v.stats.profitFactor.toFixed(2)}</td>
                    <td className={`num text-right ${tone(v.stats.total)}`}>{pct(v.stats.total, 0)}</td>
                    <td className="num text-right">-{v.stats.maxDD.toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-xs text-muted">A negative average means the sell list is useful for avoiding or exiting overnight holds, not for shorting.</p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Does a higher score mean a better night?">
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Score</th>
                  <th className="text-right">Stock-nights</th>
                  <th className="text-right">Avg overnight</th>
                  <th className="text-right">Winners</th>
                </tr>
              </thead>
              <tbody>
                {b.btst.buckets.map((x) => (
                  <tr key={x.bucket}>
                    <td>{x.bucket}</td>
                    <td className="num text-right">{x.n.toLocaleString("en-US")}</td>
                    <td className={`num text-right ${tone(x.avg)}`}>{pct(x.avg, 3)}</td>
                    <td className="num text-right">{x.winRate.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="BTST top 5 (score 70+) by year">
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Year</th>
                  <th className="text-right">Trades</th>
                  <th className="text-right">Winners</th>
                  <th className="text-right">Avg / trade</th>
                  <th className="text-right" title="Sum of nightly returns with 5 equal positions">Year total</th>
                </tr>
              </thead>
              <tbody>
                {b.btst.byYear.map((y) => (
                  <tr key={y.year}>
                    <td>{y.year}</td>
                    <td className="num text-right">{y.n}</td>
                    <td className="num text-right">{y.winRate.toFixed(1)}%</td>
                    <td className={`num text-right ${tone(y.avg)}`}>{pct(y.avg, 3)}</td>
                    <td className={`num text-right ${tone(y.total)}`}>{pct(y.total, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card title="Swing setups (results in R: 1R = the amount risked to the stop)">
        <CurveChart series={b.swing.filter((s) => s.side !== "short").map((s) => ({ name: SWING_LABEL[s.setup], points: s.curve }))} suffix="R" />
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Setup</th>
                <th className="text-right">Trades</th>
                <th className="text-right">Winners</th>
                <th className="text-right">Avg result</th>
                <th className="text-right">Avg %</th>
                <th className="text-right">Profit factor</th>
                <th className="text-right">Avg hold</th>
                <th className="text-right" title="Largest peak-to-trough fall in cumulative R, taking every signal">Worst run</th>
                <th className="text-right" title="Buys: only on days when most stocks were above their 50-day average. Sells: only when most were below.">Market aligned</th>
                <th className="text-right" title="Market aligned and the stock's 6-month relative strength on the trade's side (top 40% for buys, bottom 40% for sells)">Aligned + strength</th>
              </tr>
            </thead>
            <tbody>
              {b.swing.map((s) => (
                <tr key={s.setup}>
                  <td><span className={s.side === "short" ? "text-down" : "text-up"}>{s.side === "short" ? "Sell" : "Buy"}</span> · {SWING_LABEL[s.setup]}</td>
                  <td className="num text-right">{s.all.n.toLocaleString("en-US")}</td>
                  <td className="num text-right">{s.all.winRate.toFixed(1)}%</td>
                  <td className={`num text-right ${tone(s.all.avg)}`}>{r(s.all.avg, 3)}</td>
                  <td className={`num text-right ${tone(s.avgPct)}`}>{pct(s.avgPct)}</td>
                  <td className="num text-right">{s.all.profitFactor.toFixed(2)}</td>
                  <td className="num text-right">{s.avgHold.toFixed(1)} d</td>
                  <td className="num text-right">-{s.all.maxDD.toFixed(0)}R</td>
                  <td className={`num text-right ${tone(s.riskOn.avg)}`}>{r(s.riskOn.avg, 3)} · {s.riskOn.winRate.toFixed(0)}%</td>
                  <td className={`num text-right ${tone(s.checked?.avg)}`}>{s.checked ? `${r(s.checked.avg, 3)} · ${s.checked.winRate.toFixed(0)}%` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="overflow-x-auto border-t border-line">
          <table>
            <thead>
              <tr>
                <th>Avg result by year</th>
                {b.swing[0]?.byYear.map((y) => <th key={y.year} className="text-right">{y.year}</th>)}
              </tr>
            </thead>
            <tbody>
              {b.swing.map((s) => (
                <tr key={s.setup}>
                  <td>{SWING_LABEL[s.setup]}</td>
                  {b.swing[0].byYear.map((y0) => {
                    const y = s.byYear.find((v) => v.year === y0.year);
                    return <td key={y0.year} className={`num text-right ${tone(y?.avg)}`}>{y ? `${r(y.avg)} · ${y.winRate.toFixed(0)}%` : "–"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="grid gap-1 border-t border-line p-4 text-xs text-muted">
          {b.swing.map((s) => <li key={s.setup}><b className="text-text">{SWING_LABEL[s.setup]}:</b> {s.rules}</li>)}
        </ul>
      </Card>
    </div>
  );
}


