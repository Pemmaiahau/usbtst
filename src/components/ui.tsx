"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { DEFAULT_SETTINGS, olderThan, RISK, timeAgo, useData, useSettings } from "@/lib/client";
import type { Meta } from "@/lib/types";

const TABS = [
  { href: "/", label: "Pulse", icon: "M3 12h4l3-8 4 16 3-8h4" },
  { href: "/btst/", label: "BTST", icon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" },
  { href: "/swing/", label: "Swing", icon: "M3 17l6-6 4 4 8-8M15 7h6v6" },
  { href: "/futures/", label: "Futures", icon: "M4 19h16M7 16V9m5 7V5m5 11v-4" },
  { href: "/data/", label: "Upload", icon: "M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" },
  { href: "/backtest/", label: "Backtest", icon: "M4 20V10m6 10V4m6 16v-7m4 7H2" },
  { href: "/journal/", label: "Journal", icon: "M6 3h11a2 2 0 0 1 2 2v16H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm3 5h6m-6 4h6" },
];

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href.replace(/\/$/, "")));
  return (
    <div className="min-h-dvh pb-20 md:pb-0">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5">
          <Link href="/" className="font-semibold tracking-tight">
            Overnight <span className="text-accent">&amp; Swing</span> Desk
          </Link>
          <nav className="ml-2 hidden gap-0.5 md:flex">
            {TABS.map((t) => (
              <Link key={t.href} href={t.href} className={`rounded-md px-3 py-1.5 text-sm ${active(t.href) ? "bg-panel2 text-text" : "text-muted hover:text-text"}`}>
                {t.label}
              </Link>
            ))}
          </nav>
          <DataAge />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-4">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-7 border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] md:hidden">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className={`flex flex-col items-center gap-0.5 py-2 text-[10px] ${active(t.href) ? "text-accent" : "text-muted"}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={t.icon} />
            </svg>
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function DataAge() {
  const { data } = useData<Meta>("meta.json");
  if (!data) return null;
  const stale = olderThan(data.generatedAt, 26);
  return (
    <div className={`ml-auto text-right text-[11px] leading-tight ${stale ? "text-warn" : "text-muted"}`} title={`Scan ran ${new Date(data.generatedAt).toLocaleString()}`}>
      <div>Prices: {data.barDate}{data.session === "live" ? " (intraday)" : " close"}</div>
      <div>scanned {timeAgo(data.generatedAt)}</div>
    </div>
  );
}

export function Card({ title, right, children, className = "" }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-panel ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Status({ error, loading }: { error: string | null; loading: boolean }) {
  if (error) return <div className="rounded-xl border border-down/40 bg-down/10 p-4 text-sm">Could not load data: {error}</div>;
  if (loading) return <div className="p-6 text-sm text-muted">Loading…</div>;
  return null;
}

export function Badge({ children, kind = "muted" }: { children: ReactNode; kind?: "up" | "down" | "warn" | "muted" | "accent" }) {
  const cls = { up: "bg-up/15 text-up", down: "bg-down/15 text-down", warn: "bg-warn/15 text-warn", muted: "bg-panel2 text-muted", accent: "bg-accent/15 text-accent" }[kind];
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}

export function ScoreBar({ score }: { score: number }) {
  const color = score >= 65 ? "bg-up" : score >= 50 ? "bg-warn" : "bg-muted";
  return (
    <div className="flex items-center gap-2">
      <span className="num w-9 text-right font-semibold">{score.toFixed(0)}</span>
      <div className="h-1.5 w-14 overflow-hidden rounded bg-panel2">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, score)}%` }} />
      </div>
    </div>
  );
}

export function SettingsBar() {
  const [s, set] = useSettings();
  const cur = s ?? DEFAULT_SETTINGS;
  const r = RISK[cur.risk];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-muted">Account $</span>
        <input type="number" inputMode="numeric" min={0} step={500} value={cur.account} onChange={(e) => set({ ...cur, account: Math.max(0, Number(e.target.value) || 0) })} className="num w-28" />
      </label>
      <div className="flex items-center gap-2">
        <span className="text-muted">Risk</span>
        <div className="flex overflow-hidden rounded-lg border border-line">
          {(["medium", "high"] as const).map((k) => (
            <button key={k} onClick={() => set({ ...cur, risk: k })} className={`px-3 py-1.5 ${cur.risk === k ? "bg-accent text-bg font-medium" : "bg-panel2 text-muted"}`}>
              {RISK[k].label}
            </button>
          ))}
        </div>
      </div>
      <span className="text-xs text-muted">
        Swing: risk {r.riskPct}% per trade · BTST: {r.btstPosPct}% of account per stock, up to {r.btstMax} stocks
      </span>
    </div>
  );
}

export function StockLink({ sym, params = "" }: { sym: string; params?: string }) {
  return (
    <Link href={`/stock/?s=${sym}${params}`} className="font-semibold text-accent hover:underline">
      {sym}
    </Link>
  );
}
