import type { LiveQuote } from "./client";

// Column-name aliases, so exports from different sites work without editing.
const ALIASES: Record<keyof LiveQuote | "sym", string[]> = {
  sym: ["symbol", "ticker", "sym", "code"],
  c: ["last", "last sale", "lastsale", "last price", "price", "close", "latest", "last trade"],
  o: ["open", "priceopen", "open price"],
  h: ["high", "day high", "high price"],
  l: ["low", "day low", "low price"],
  v: ["volume", "vol", "volume 1 day", "day volume"],
};

export function parseRows(text: string): string[][] {
  const delim = text.split("\n", 1)[0].includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) row.push(cur), (cur = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

function toNum(s: string | undefined): number | undefined {
  if (s == null) return undefined;
  let t = s.replace(/[$,%\s]/g, "");
  if (!t || /^(n\/?a|#n\/a|-|–|null)$/i.test(t)) return undefined;
  let mult = 1;
  const suffix = t.slice(-1).toUpperCase();
  if ("KMB".includes(suffix)) {
    mult = suffix === "K" ? 1e3 : suffix === "M" ? 1e6 : 1e9;
    t = t.slice(0, -1);
  }
  const n = Number(t) * mult;
  return Number.isFinite(n) ? n : undefined;
}

export const normSym = (s: string) => s.trim().toUpperCase().replace(/^[A-Z]+:/, "").replace(/[./\s]/g, "-");

export type ParseResult = { quotes: Record<string, LiveQuote>; columns: string[]; missing: string[]; rows: number; skipped: number; error?: string };

export function parseQuotes(text: string): ParseResult {
  const rows = parseRows(text.replace(/^﻿/, ""));
  const empty: ParseResult = { quotes: {}, columns: [], missing: [], rows: 0, skipped: 0 };
  if (rows.length < 2) return { ...empty, error: "The file has no data rows." };
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[_*]+/g, " ").replace(/\s+/g, " "));
  const col: Partial<Record<keyof typeof ALIASES, number>> = {};
  for (const key of Object.keys(ALIASES) as (keyof typeof ALIASES)[]) {
    for (const alias of ALIASES[key]) {
      const i = header.indexOf(alias);
      if (i >= 0) {
        col[key] = i;
        break;
      }
    }
  }
  if (col.sym == null || col.c == null) {
    return { ...empty, error: `Could not find a ${col.sym == null ? "Symbol" : "Last/Price"} column. Columns seen: ${rows[0].join(", ")}` };
  }
  const quotes: Record<string, LiveQuote> = {};
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const sym = normSym(r[col.sym] ?? "");
    const c = toNum(r[col.c]);
    if (!sym || c == null || c <= 0) {
      skipped++;
      continue;
    }
    const q: LiveQuote = { c };
    for (const k of ["o", "h", "l", "v"] as const) {
      const v = col[k] != null ? toNum(r[col[k]!]) : undefined;
      if (v != null && v > 0) q[k] = v;
    }
    // guard against junk rows where high/low do not bracket the price
    if (q.h != null && q.l != null && (q.h < q.l || c > q.h * 1.001 || c < q.l * 0.999)) {
      delete q.h;
      delete q.l;
    }
    quotes[sym] = q;
  }
  const names = { o: "Open", h: "High", l: "Low", v: "Volume" } as const;
  return {
    quotes,
    columns: (Object.keys(col) as (keyof typeof ALIASES)[]).map((k) => rows[0][col[k]!].trim()),
    missing: (["o", "h", "l", "v"] as const).filter((k) => col[k] == null).map((k) => names[k]),
    rows: Object.keys(quotes).length,
    skipped,
  };
}
