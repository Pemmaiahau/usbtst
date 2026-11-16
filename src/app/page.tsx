"use client";
import Link from "next/link";
import { Badge, Card, Status } from "@/components/ui";
import { fmt, pct, tone, useData } from "@/lib/client";
import type { EarningsItem, EconEvent, IndexCall, Meta, Pulse } from "@/lib/types";

export default function PulsePage() {
  const { data: p, error } = useData<Pulse>("pulse.json");
  const { data: cal } = useData<{ earnings: EarningsItem[]; econ: EconEvent[] }>("calendar.json");
  const { data: meta } = useData<Meta>("meta.json");
  const { data: ix } = useData<{ calls: IndexCall[] }>("index.json");
  const callColor = (c: string) => (c === "Buy" ? "text-up" : c === "Sell" ? "text-down" : "text-muted");
  if (!p) return <Status error={error} loading />;
  const color = p.label === "Risk-on" ? "text-up" : p.label === "Risk-off" ? "text-down" : "text-warn";
  const pos = ((p.score + 100) / 200) * 100;
  const earnByDate = new Map<string, EarningsItem[]>();
  for (const e of cal?.earnings ?? []) earnByDate.set(e.date, [...(earnByDate.get(e.date) ?? []), e]);

  return (
    <div className="grid gap-4">
      <Card>
        <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:items-center">
          <div>
            <div className="text-xs text-muted">Market pulse · should I trade long today?</div>
            <div className={`mt-1 text-4xl font-semibold ${color}`}>{p.label}</div>
            <div className="num mt-1 text-sm text-muted">Score {p.score > 0 ? "+" : ""}{p.score} on a scale of -100 to +100</div>
            <div className="relative mt-3 h-2 rounded bg-gradient-to-r from-down via-warn to-up">
              <div className="absolute -top-1 h-4 w-1 rounded bg-text" style={{ left: `calc(${pos}% - 2px)` }} />
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-muted">
              <span>Risk-off</span>
              <span>Neutral</span>
              <span>Risk-on</span>
            </div>
          </div>
          <div>
            <p className="text-sm">{p.advice}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <Link href="/btst/" className="rounded-lg bg-accent px-3 py-1.5 font-medium text-bg">BTST candidates</Link>
              <Link href="/swing/" className="rounded-lg border border-line bg-panel2 px-3 py-1.5">Swing setups</Link>
              <Link href="/futures/" className="rounded-lg border border-line bg-panel2 px-3 py-1.5">Index futures</Link>
            </div>
            {meta?.notes?.some((n) => /unavailable/i.test(n)) && <p className="mt-2 text-xs text-warn">{meta.notes.filter((n) => /unavailable/i.test(n)).join(" · ")}</p>}
          </div>
        </div>
      </Card>

      {!!ix?.calls.length && (
        <Card title="Index futures calls" right={<Link href="/futures/" className="text-xs text-accent underline">Reasons and levels</Link>}>
          <div className="grid grid-cols-2 gap-px bg-line lg:grid-cols-4">
            {ix.calls.map((c) => (
              <Link key={c.key} href="/futures/" className="bg-panel px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2 text-xs text-muted">
                  <span className="truncate">{c.name} ({c.contracts.split(" ")[0]})</span>
                  <span className={`num ${tone(c.futChg)}`}>{pct(c.futChg)}</span>
                </div>
                <div className="mt-1 text-sm">
                  Swing: <b className={callColor(c.swing.call)}>{c.swing.call}</b>
                </div>
                <div className="text-sm">
                  Overnight: <b className={callColor(c.btst.call)}>{c.btst.call}</b>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="What is driving the score">
          <ul className="divide-y divide-line">
            {p.components.map((c) => (
              <li key={c.name} className="grid grid-cols-[1fr_auto] gap-x-3 px-4 py-2.5">
                <div className="text-sm font-medium">{c.name}</div>
                <div className={`num text-right text-sm font-semibold ${tone(c.score)}`}>
                  {c.score > 0 ? "+" : ""}
                  {c.score.toFixed(0)} <span className="font-normal text-muted">/ ±{c.max}</span>
                </div>
                <div className="col-span-2 text-xs text-text/90">{c.value}</div>
                <div className="col-span-2 text-xs text-muted">{c.note}</div>
              </li>
            ))}
          </ul>
        </Card>

        <div className="grid content-start gap-4">
          <Card title="Markets">
            <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
              {p.tiles.map((t) => (
                <div key={t.sym} className="bg-panel px-3 py-2">
                  <div className="truncate text-xs text-muted">{t.name}</div>
                  <div className="num text-sm font-semibold">{fmt(t.last)}</div>
                  <div className="num text-xs">
                    <span className={tone(t.chg)}>{pct(t.chg)}</span> <span className="text-muted">· 5d {pct(t.chg5, 1)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Breadth (large caps)">
            <div className="grid grid-cols-3 gap-px bg-line text-center">
              {[
                ["Up / down today", `${p.breadth.adv} / ${p.breadth.dec}`],
                ["Above 20-day", `${p.breadth.above20}%`],
                ["Above 50-day", `${p.breadth.above50}%`],
                ["Above 200-day", `${p.breadth.above200}%`],
                ["New 20-day highs", `${p.breadth.newHigh20}`],
                ["New 20-day lows", `${p.breadth.newLow20}`],
              ].map(([k, v]) => (
                <div key={k} className="bg-panel px-2 py-2">
                  <div className="num text-sm font-semibold">{v}</div>
                  <div className="text-[11px] text-muted">{k}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Sectors">
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Sector</th>
                  <th className="text-right">Today</th>
                  <th className="text-right">5 days</th>
                  <th className="text-right">20 days</th>
                </tr>
              </thead>
              <tbody>
                {p.sectors.map((s) => (
                  <tr key={s.sector}>
                    <td>{s.sector}</td>
                    <td className={`num text-right ${tone(s.chg)}`}>{pct(s.chg)}</td>
                    <td className={`num text-right ${tone(s.chg5)}`}>{pct(s.chg5, 1)}</td>
                    <td className={`num text-right ${tone(s.chg20)}`}>{pct(s.chg20, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="This week: US data and Fed (Eastern time)">
          {p.events.length ? (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {p.events.map((e, i) => (
                <li key={i} className="flex items-start gap-3 px-4 py-2 text-sm">
                  <div className="num w-24 shrink-0 text-xs text-muted">
                    {e.date.slice(5)} {e.time}
                  </div>
                  <div className="min-w-0 flex-1">
                    {e.name} {e.impact === "high" && <Badge kind="warn">High impact</Badge>}
                    {(e.consensus || e.previous || e.actual) && (
                      <div className="text-xs text-muted">
                        {e.actual && `Actual ${e.actual} · `}
                        {e.consensus && `Forecast ${e.consensus} · `}
                        {e.previous && `Previous ${e.previous}`}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-muted">No calendar data. Check an economic calendar before holding overnight.</p>
          )}
        </Card>
      </div>

      <Card title="Earnings in the next sessions (stocks in the scan)">
        {earnByDate.size ? (
          <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
            {[...earnByDate.entries()].sort().map(([date, list]) => (
              <div key={date} className="bg-panel px-4 py-3">
                <div className="text-xs font-medium text-muted">{date}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                  {list.map((e) => (
                    <Link key={e.sym} href={`/stock/?s=${e.sym}`} className="hover:underline" title={`${e.name} · ${e.when}`}>
                      <span className="font-medium text-accent">{e.sym}</span> <span className="text-xs text-muted">{e.when === "after close" ? "after" : e.when === "before open" ? "before" : ""}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="p-4 text-sm text-muted">No earnings from the scanned stocks in the next few sessions, or the calendar was unavailable.</p>
        )}
      </Card>
    </div>
  );
}
