"use client";
import Link from "next/link";
import { useState } from "react";
import { Badge, Card, SettingsBar, Status, StockLink } from "@/components/ui";
import { DEFAULT_SETTINGS, fmt, money, RISK, useData, useSettings } from "@/lib/client";
import { SWING_LABEL, SWING_RULES, SWING_SIDE } from "@/lib/swing";
import type { Backtest, Meta, Pulse, SwingSetup, SwingSignal } from "@/lib/types";

const ORDER: SwingSetup[] = ["bounce", "gap", "pullback", "breakout", "fade", "rally", "breakdown", "gapdown"];

const passed = (x: SwingSignal) => x.checks.filter((c) => c.ok).length;

export default function SwingPage() {
  const { data, error } = useData<{ meta: Meta; signals: SwingSignal[] }>("swing.json");
  const { data: bt } = useData<Backtest>("backtest.json");
  const { data: pulse } = useData<Pulse>("pulse.json");
  const [settings] = useSettings();
  const [setup, setSetup] = useState<SwingSetup | "all">("all");
  const [todayOnly, setTodayOnly] = useState(false);
  const [side, setSide] = useState<"long" | "short">("long");
  if (!data) return <Status error={error} loading />;
  const s = settings ?? DEFAULT_SETTINGS;
  const cfg = RISK[s.risk];
  const stat = (k: SwingSetup) => bt?.swing.find((x) => x.setup === k);
  // newest signal per stock and setup, best-backtested setups first
  const seen = new Set<string>();
  const signals = data.signals
    .filter((x) => x.side === side && (setup === "all" || x.setup === setup) && (!todayOnly || x.date === data.meta.barDate))
    .filter((x) => !seen.has(x.sym + x.setup) && !!seen.add(x.sym + x.setup))
    .sort((a, b) => passed(b) - passed(a) || ORDER.indexOf(a.setup) - ORDER.indexOf(b.setup) || b.date.localeCompare(a.date));
  const short = side === "short";
  const shortStats = bt?.swing.filter((x) => x.side === "short") ?? [];

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold">Swing setups (3 to 15 sessions)</h1>
        <p className="mt-1 text-sm text-muted">Signals from the last three sessions that are still valid, strongest confluence first. Enter at the next open, place the stop immediately, and exit at the target, the stop or the time limit.</p>
        <div className="mt-2 inline-flex overflow-hidden rounded-lg border border-line text-sm">
          <button onClick={() => (setSide("long"), setSetup("all"))} className={`px-4 py-1.5 ${!short ? "bg-up/20 font-medium text-up" : "bg-panel2 text-muted"}`}>Buy setups</button>
          <button onClick={() => (setSide("short"), setSetup("all"))} className={`px-4 py-1.5 ${short ? "bg-down/20 font-medium text-down" : "bg-panel2 text-muted"}`}>Sell setups</button>
        </div>
      </div>

      {short && shortStats.length > 0 && (
        <div className="rounded-xl border border-down/40 bg-down/10 p-3 text-sm">
          <b>Sell setups have not paid as short trades.</b> In the backtest: {shortStats.map((x) => `${SWING_LABEL[x.setup]} ${x.all.avg >= 0 ? "+" : ""}${x.all.avg.toFixed(2)}R`).join(", ")} per trade after costs.
          Treat these as warnings: reasons to sell or avoid a stock you hold, or to hedge. Short them only with small size and a hard stop.
        </div>
      )}

      {pulse && pulse.label !== "Risk-on" && (
        <div className={`rounded-xl border p-3 text-sm ${pulse.label === "Risk-off" ? "border-down/40 bg-down/10" : "border-warn/40 bg-warn/10"}`}>
          <b>Market pulse: {pulse.label}.</b> {pulse.advice}
        </div>
      )}

      <Card>
        <div className="p-3">
          <SettingsBar />
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ORDER.filter((k) => SWING_SIDE[k] === side).map((k) => {
          const st = stat(k);
          const n = new Set(data.signals.filter((x) => x.setup === k).map((x) => x.sym)).size;
          return (
            <button key={k} onClick={() => setSetup(setup === k ? "all" : k)} className={`rounded-xl border p-3 text-left ${setup === k ? "border-accent bg-accent/10" : "border-line bg-panel"}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{SWING_LABEL[k]}</span>
                <Badge kind={n ? "accent" : "muted"}>{n} now</Badge>
              </div>
              {st && (
                <div className="num mt-2 text-xs text-muted">
                  Backtest: {st.all.winRate.toFixed(0)}% wins · {st.all.avg >= 0 ? "+" : ""}{st.all.avg.toFixed(2)}R avg · {st.all.n} trades
                </div>
              )}
              <p className="mt-1.5 text-xs text-muted">{SWING_RULES[k]}</p>
            </button>
          );
        })}
      </div>

      <Card
        title={`${setup === "all" ? "All setups" : SWING_LABEL[setup]} (${signals.length})`}
        right={
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={todayOnly} onChange={(e) => setTodayOnly(e.target.checked)} /> Latest session only
          </label>
        }
      >
        {signals.length === 0 ? (
          <p className="p-4 text-sm text-muted">No valid signals for this filter. Waiting is part of the method.</p>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Stock</th>
                  <th>Setup</th>
                  <th>Signal day</th>
                  <th className="text-right">Close</th>
                  <th className="text-right">Stop</th>
                  <th className="text-right">Target</th>
                  <th className="text-right">Risk</th>
                  <th className="text-right" title={`Shares so that hitting the stop loses ${cfg.riskPct}% of the account, capped at ${cfg.maxPosPct}% of the account`}>Size</th>
                  <th className="text-right">Exit by</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((x) => {
                  const perShare = Math.abs(x.close - x.stop);
                  const ma5 = x.setup === "bounce" || x.setup === "fade";
                  const shares = Math.max(0, Math.floor(Math.min((s.account * cfg.riskPct) / 100 / perShare, (s.account * cfg.maxPosPct) / 100 / x.close)));
                  return (
                    <tr key={x.sym + x.setup + x.date}>
                      <td>
                        <StockLink sym={x.sym} params={`&stop=${x.stop}${ma5 ? "" : `&target=${x.target}`}`} />
                        <div className="max-w-36 truncate text-xs text-muted">{x.name}</div>
                      </td>
                      <td>
                        <Badge kind={short ? "down" : "up"}>{short ? "Sell" : "Buy"}</Badge> {SWING_LABEL[x.setup]}
                      </td>
                      <td className="num">
                        {x.date.slice(5)} {x.date === data.meta.barDate && <Badge kind="accent">New</Badge>}
                      </td>
                      <td className="num text-right">{fmt(x.close)}</td>
                      <td className="num text-right text-down">{fmt(x.stop)}</td>
                      <td className="num text-right text-up">{ma5 ? `Close ${short ? "<" : ">"} 5d avg` : fmt(x.target)}</td>
                      <td className="num text-right">{fmt(x.riskPct, 1)}%</td>
                      <td className="num text-right">{shares > 0 ? `${shares} sh · ${money(shares * x.close)}` : "–"}</td>
                      <td className="num text-right">{x.holdDays} sessions</td>
                      <td className="min-w-72 whitespace-normal">
                        <div className="text-xs">{x.note}</div>
                        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]">
                          <b className={passed(x) >= 5 ? "text-up" : passed(x) >= 3 ? "text-warn" : "text-down"}>{passed(x)}/{x.checks.length} checks</b>
                          {x.checks.map((c) => (
                            <span key={c.name} className={c.ok ? "text-muted" : "text-down"}>
                              {c.ok ? "✓" : "✗"} {c.text}
                            </span>
                          ))}
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
        Stops and targets are measured from the signal-day close; recompute them from your actual entry price and skip the trade if the stock opens more than one risk-unit beyond the close. The checks (market direction, 6-month relative strength, sector trend, 200-day trend, volume, earnings) show how many conditions line up behind the trade. “R” means one unit of risk (entry minus stop). Full statistics are on the{" "}
        <Link href="/backtest/" className="underline">Backtest</Link> page. This is a screening tool, not financial advice.
      </p>
    </div>
  );
}
