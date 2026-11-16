"use client";
import Link from "next/link";
import { useState } from "react";
import { Badge, Card } from "@/components/ui";
import { BASE, timeAgo, useData, useUpload } from "@/lib/client";
import { parseQuotes, type ParseResult } from "@/lib/csv";
import type { Snapshot } from "@/lib/types";

const SOURCES = [
  {
    name: "Google Sheets (recommended, free)",
    badge: "All columns",
    steps: [
      "Download the Google Sheets template below.",
      "In Google Sheets choose File → Import → Upload, pick the file, and keep “Convert text to numbers, dates and formulas” ticked. Do this once and keep the sheet.",
      "Near the US close, open the sheet, wait for prices to fill in, then File → Download → Comma-separated values (.csv).",
      "Upload that CSV here.",
    ],
    note: "Google’s prices can lag up to 20 minutes for some exchanges, and volume is the running day total.",
    template: "google-sheets-live-quotes.csv",
  },
  {
    name: "Nasdaq.com stock screener (free, no login)",
    badge: "Price only",
    steps: ["Open nasdaq.com/market-activity/stocks/screener.", "Press “Download CSV” (it covers every US stock; extra rows are ignored).", "Upload the file here."],
    note: "This export has last price and volume but no open, high or low, so the intraday part of the score falls back to the daily change.",
    link: "https://www.nasdaq.com/market-activity/stocks/screener",
  },
  {
    name: "Your broker or charting platform",
    badge: "Varies",
    steps: [
      "Export a watchlist or screener to CSV from any platform that allows it (TradingView and Finviz need a paid plan to export; Barchart allows a few downloads per day on a free account).",
      "Make sure it has a Symbol/Ticker column and a Last/Price column. Open, High, Low and Volume are used when present.",
      "Upload the file here. Column names are matched automatically.",
    ],
    note: "If a file is not recognised, copy its columns into the blank template.",
    template: "manual-quotes-template.csv",
  },
];

export default function DataPage() {
  const { data: snap } = useData<Snapshot>("snapshot.json");
  const [upload, setUpload] = useUpload();
  const [result, setResult] = useState<(ParseResult & { file: string; matched: number }) | null>(null);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const r = parseQuotes(text);
    const matched = snap ? Object.keys(r.quotes).filter((s) => snap.stocks[s]).length : r.rows;
    setResult({ ...r, file: file.name, matched });
    if (!r.error && matched >= 50) {
      const quotes = snap ? Object.fromEntries(Object.entries(r.quotes).filter(([s]) => snap.stocks[s])) : r.quotes;
      setUpload({ at: new Date().toISOString(), source: file.name, quotes });
    }
  };

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold">Upload live quotes</h1>
        <p className="mt-1 text-sm text-muted">
          The automatic scan uses free prices that lag about 15 minutes and only refreshes when the scan runs. To rank BTST candidates on fresher prices, download a quote file from one of the sources below and upload it. The file is read in your browser and stays on this device.
        </p>
      </div>

      <Card title="Upload a CSV">
        <div className="grid gap-3 p-4">
          <label
            className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed border-line bg-panel2 px-4 py-8 text-center text-sm hover:border-accent"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handle(e.dataTransfer.files[0]);
            }}
          >
            <span className="font-medium">Choose a CSV file or drop it here</span>
            <span className="text-xs text-muted">Needs a Symbol column and a Last/Price column. Open, High, Low and Volume are optional.</span>
            <input type="file" accept=".csv,.tsv,.txt,text/csv" className="sr-only" onChange={(e) => handle(e.target.files?.[0])} />
          </label>

          {result &&
            (result.error ? (
              <div className="rounded-lg border border-down/40 bg-down/10 p-3 text-sm">{result.file}: {result.error}</div>
            ) : result.matched < 50 ? (
              <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
                {result.file}: only {result.matched} of the scanned stocks were found ({result.rows} rows read). At least 50 are needed because scores are relative to the whole universe. Nothing was changed.
              </div>
            ) : (
              <div className="rounded-lg border border-up/40 bg-up/10 p-3 text-sm">
                <b>{result.matched} stocks loaded</b> from {result.file} (columns used: {result.columns.join(", ")}).
                {result.missing.length > 0 && <span className="text-warn"> Not in the file: {result.missing.join(", ")}, so parts of the score use fallbacks.</span>}{" "}
                <Link href="/btst/" className="font-medium text-accent underline">See the re-ranked BTST list</Link>
              </div>
            ))}

          {upload && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted">Active upload: {upload.source}, {Object.keys(upload.quotes).length} stocks, {timeAgo(upload.at)}</span>
              <button onClick={() => { setUpload(null); setResult(null); }} className="rounded-md border border-line bg-panel2 px-2.5 py-1">Remove</button>
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {SOURCES.map((s) => (
          <Card key={s.name} title={s.name} right={<Badge kind={s.badge === "All columns" ? "up" : "muted"}>{s.badge}</Badge>}>
            <div className="grid gap-2 p-4 text-sm">
              <ol className="list-decimal space-y-1 pl-5">
                {s.steps.map((t) => <li key={t}>{t}</li>)}
              </ol>
              <p className="text-xs text-muted">{s.note}</p>
              {s.template && (
                <a href={`${BASE}/templates/${s.template}`} download className="mt-1 w-fit rounded-lg bg-accent px-3 py-1.5 font-medium text-bg">
                  Download {s.template.includes("google") ? "Google Sheets template" : "blank template"}
                </a>
              )}
              {s.link && <a href={s.link} target="_blank" rel="noreferrer" className="w-fit text-accent underline">Open the Nasdaq screener</a>}
            </div>
          </Card>
        ))}
      </div>

      <Card title="File format">
        <div className="grid gap-2 p-4 text-sm">
          <pre className="overflow-x-auto rounded-lg bg-panel2 p-3 font-mono text-xs">{"Symbol,Last,Open,High,Low,Volume\nAAPL,356.27,355.90,360.83,355.76,39099985\nMSFT,512.40,509.10,514.22,507.80,18230011"}</pre>
          <p className="text-xs text-muted">
            Accepted column names: Symbol/Ticker; Last/Last Sale/Price/Close; Open; High; Low; Volume. Dollar signs, commas and suffixes such as 1.2M are handled. Class shares can be written BRK.B or BRK-B. Upload during or after a US session: the scores compare your prices with the previous close.
          </p>
        </div>
      </Card>
    </div>
  );
}
