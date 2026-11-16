"use client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
export const dataUrl = (file: string) => `${BASE}/data/${file}`;

export function useData<T>(file: string | null): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ file: string | null; data: T | null; error: string | null }>({ file: null, data: null, error: null });
  useEffect(() => {
    if (!file) return;
    let alive = true;
    fetch(dataUrl(file), { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? "No data yet. Run the scan first (npm run scan)." : `HTTP ${r.status}`))))
      .then((data) => alive && setState({ file, data, error: null }))
      .catch((e) => alive && setState({ file, data: null, error: String(e.message ?? e) }));
    return () => {
      alive = false;
    };
  }, [file]);
  return state.file === file ? { data: state.data, error: state.error } : { data: null, error: null };
}

// ---------- localStorage-backed state (per device) ----------

const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; value: unknown }>();
function read<T>(key: string, fallback: T): T {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {}
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T;
  let value = fallback;
  if (raw != null) {
    try {
      value = JSON.parse(raw) as T;
    } catch {}
  }
  cache.set(key, { raw, value });
  return value;
}
export function useStored<T>(key: string, fallback: T): [T, (v: T) => void] {
  const subscribe = useCallback((cb: () => void) => {
    listeners.add(cb);
    return () => void listeners.delete(cb);
  }, []);
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, fallback),
    () => fallback,
  );
  const set = useCallback(
    (v: T) => {
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {}
      listeners.forEach((l) => l());
    },
    [key],
  );
  return [value, set];
}

export type Settings = { account: number; risk: "medium" | "high" };
export const DEFAULT_SETTINGS: Settings = { account: 10000, risk: "medium" };
export const RISK = {
  medium: { label: "Medium", riskPct: 1, maxPosPct: 20, btstPosPct: 15, btstMax: 4, minScore: 65 },
  high: { label: "High", riskPct: 2, maxPosPct: 33, btstPosPct: 25, btstMax: 5, minScore: 60 },
} as const;
export const useSettings = () => useStored<Settings>("btst.settings", DEFAULT_SETTINGS);

export type LiveQuote = { o?: number; h?: number; l?: number; c: number; v?: number };
export type Upload = { at: string; source: string; quotes: Record<string, LiveQuote> };
export const useUpload = () => useStored<Upload | null>("btst.upload", null);

export type Trade = { id: string; sym: string; kind: "BTST" | "Swing"; qty: number; entryDate: string; entry: number; exitDate?: string; exit?: number; note?: string };
export const useJournal = () => useStored<Trade[]>("btst.journal", []);

// ---------- formatting ----------

export const fmt = (x: number | null | undefined, d = 2) => (x == null || !Number.isFinite(x) ? "–" : x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
export const pct = (x: number | null | undefined, d = 2) => (x == null || !Number.isFinite(x) ? "–" : `${x > 0 ? "+" : ""}${x.toFixed(d)}%`);
export const tone = (x: number | null | undefined) => (x == null || x === 0 ? "text-muted" : x > 0 ? "text-up" : "text-down");
export const money = (x: number) => "$" + Math.round(x).toLocaleString("en-US");

export function nyNow(): { date: string; frac: number; open: boolean } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const mins = (parseInt(g("hour")) % 24) * 60 + parseInt(g("minute"));
  const weekday = !["Sat", "Sun"].includes(g("weekday"));
  const open = weekday && mins >= 570 && mins < 960;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, frac: open ? Math.max(0.05, (mins - 570) / 390) : 1, open };
}

export function timeAgo(iso: string): string {
  const m = Math.round((Date.now() - +new Date(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}

export const olderThan = (iso: string, hours: number) => Date.now() - +new Date(iso) > hours * 3600e3;
export const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
