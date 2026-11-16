"use client";
import { useState } from "react";
import { Card } from "@/components/ui";
import { fmt, money, newId, pct, tone, useJournal, type Trade } from "@/lib/client";

const today = () => new Date().toISOString().slice(0, 10);
const blank = () => ({ sym: "", kind: "BTST" as Trade["kind"], qty: "", entryDate: today(), entry: "", exitDate: "", exit: "", note: "" });

export default function JournalPage() {
  const [trades, setTrades] = useJournal();
  const [f, setF] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const list = [...(trades ?? [])].sort((a, b) => b.entryDate.localeCompare(a.entryDate));
  const closed = list.filter((t) => t.exit != null);
  const pnl = (t: Trade) => (t.exit! - t.entry) * t.qty;
  const ret = (t: Trade) => (t.exit! / t.entry - 1) * 100;
  const wins = closed.filter((t) => pnl(t) > 0);
  const total = closed.reduce((a, t) => a + pnl(t), 0);
  const valid = f.sym.trim() && Number(f.qty) > 0 && Number(f.entry) > 0 && f.entryDate;

  const save = () => {
    if (!valid) return;
    const t: Trade = {
      id: editing ?? newId(),
      sym: f.sym.trim().toUpperCase(),
      kind: f.kind,
      qty: Number(f.qty),
      entryDate: f.entryDate,
      entry: Number(f.entry),
      exitDate: Number(f.exit) > 0 ? f.exitDate || today() : undefined,
      exit: Number(f.exit) > 0 ? Number(f.exit) : undefined,
      note: f.note.trim() || undefined,
    };
    setTrades(editing ? list.map((x) => (x.id === editing ? t : x)) : [...list, t]);
    setF(blank());
    setEditing(null);
  };
  const edit = (t: Trade) => {
    setEditing(t.id);
    setF({ sym: t.sym, kind: t.kind, qty: String(t.qty), entryDate: t.entryDate, entry: String(t.entry), exitDate: t.exitDate ?? "", exit: t.exit != null ? String(t.exit) : "", note: t.note ?? "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const exportCsv = () => {
    const rows = [["Symbol", "Type", "Qty", "Entry date", "Entry", "Exit date", "Exit", "P&L", "Note"], ...list.map((t) => [t.sym, t.kind, t.qty, t.entryDate, t.entry, t.exitDate ?? "", t.exit ?? "", t.exit != null ? pnl(t).toFixed(2) : "", `"${(t.note ?? "").replace(/"/g, '""')}"`])];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" }));
    a.download = `trade-journal-${today()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const field = (label: string, node: React.ReactNode) => (
    <label className="grid gap-1 text-xs text-muted">
      {label}
      {node}
    </label>
  );

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold">Trade journal</h1>
        <p className="mt-1 text-sm text-muted">Log what you actually traded and compare it with the backtest. Entries are stored only in this browser on this device; export a CSV to back them up.</p>
      </div>

      <Card title={editing ? "Edit trade" : "Add a trade"}>
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          {field("Symbol", <input value={f.sym} onChange={(e) => setF({ ...f, sym: e.target.value })} placeholder="AAPL" autoCapitalize="characters" />)}
          {field("Type", <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Trade["kind"] })}><option>BTST</option><option>Swing</option></select>)}
          {field("Shares", <input type="number" inputMode="decimal" min={0} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />)}
          {field("Entry price", <input type="number" inputMode="decimal" min={0} step="0.01" value={f.entry} onChange={(e) => setF({ ...f, entry: e.target.value })} />)}
          {field("Entry date", <input type="date" value={f.entryDate} onChange={(e) => setF({ ...f, entryDate: e.target.value })} />)}
          {field("Exit price (blank if open)", <input type="number" inputMode="decimal" min={0} step="0.01" value={f.exit} onChange={(e) => setF({ ...f, exit: e.target.value })} />)}
          {field("Exit date", <input type="date" value={f.exitDate} onChange={(e) => setF({ ...f, exitDate: e.target.value })} />)}
          {field("Note", <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Why this trade?" />)}
          <div className="col-span-2 flex gap-2 sm:col-span-4">
            <button onClick={save} disabled={!valid} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg disabled:opacity-40">{editing ? "Save changes" : "Add trade"}</button>
            {editing && <button onClick={() => { setEditing(null); setF(blank()); }} className="rounded-lg border border-line bg-panel2 px-4 py-2 text-sm">Cancel</button>}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Closed trades", String(closed.length), ""],
          ["Winners", closed.length ? `${((wins.length / closed.length) * 100).toFixed(0)}%` : "–", ""],
          ["Avg return", closed.length ? pct(closed.reduce((a, t) => a + ret(t), 0) / closed.length) : "–", ""],
          ["Total P&L", closed.length ? `${total < 0 ? "-" : ""}${money(Math.abs(total))}` : "–", tone(total)],
        ].map(([k, v, cls]) => (
          <div key={k} className="rounded-xl border border-line bg-panel px-4 py-3">
            <div className="text-xs text-muted">{k}</div>
            <div className={`num text-xl font-semibold ${cls}`}>{v}</div>
          </div>
        ))}
      </div>

      <Card title={`Trades (${list.length})`} right={list.length > 0 && <button onClick={exportCsv} className="rounded-md border border-line bg-panel2 px-2.5 py-1 text-xs">Export CSV</button>}>
        {list.length === 0 ? (
          <p className="p-4 text-sm text-muted">No trades logged yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Stock</th>
                  <th>Type</th>
                  <th className="text-right">Shares</th>
                  <th>Entry</th>
                  <th>Exit</th>
                  <th className="text-right">Return</th>
                  <th className="text-right">P&amp;L</th>
                  <th>Note</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((t) => (
                  <tr key={t.id}>
                    <td className="font-semibold">{t.sym}</td>
                    <td>{t.kind}</td>
                    <td className="num text-right">{t.qty}</td>
                    <td className="num">{fmt(t.entry)} <span className="text-xs text-muted">{t.entryDate.slice(5)}</span></td>
                    <td className="num">{t.exit != null ? <>{fmt(t.exit)} <span className="text-xs text-muted">{t.exitDate?.slice(5)}</span></> : <span className="text-warn">Open</span>}</td>
                    <td className={`num text-right ${t.exit != null ? tone(ret(t)) : ""}`}>{t.exit != null ? pct(ret(t)) : "–"}</td>
                    <td className={`num text-right ${t.exit != null ? tone(pnl(t)) : ""}`}>{t.exit != null ? `${pnl(t) < 0 ? "-" : ""}${money(Math.abs(pnl(t)))}` : "–"}</td>
                    <td className="max-w-48 truncate text-xs text-muted">{t.note}</td>
                    <td className="text-right text-xs">
                      <button onClick={() => edit(t)} className="mr-3 text-accent underline">Edit</button>
                      <button onClick={() => confirm(`Delete the ${t.sym} trade?`) && setTrades(list.filter((x) => x.id !== t.id))} className="text-down underline">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
