// Sanity check (npm run check): uploading the scan day's own bars must reproduce the scan's scores,
// and the Nasdaq.com screener format must parse. Run after `npm run scan`.
import { readFileSync } from "node:fs";
import { scoreBtstDay } from "../src/lib/btst";
import { parseQuotes } from "../src/lib/csv";

const snap = JSON.parse(readFileSync("public/data/snapshot.json", "utf8"));
const scan = JSON.parse(readFileSync("public/data/btst.json", "utf8"));
const lines = ["Ticker,Last Sale,Open,High,Low,Volume"];
for (const sym of Object.keys(snap.stocks)) {
  const b = JSON.parse(readFileSync(`public/data/stocks/${sym}.json`, "utf8")).bars.at(-1);
  lines.push([sym.replace("-", "."), `"$` + b[4] + `"`, b[1], b[2], b[3], `"` + b[5].toLocaleString("en-US") + `"`].join(","));
}
const r = parseQuotes(lines.join("\r\n"));
const rows = scoreBtstDay(
  Object.entries(r.quotes).map(([sym, q]) => ({ sym, name: "", sector: snap.stocks[sym].sector, ctx: snap.stocks[sym].ctx, bar: q })),
  snap.meta.volFrac,
);
let maxDiff = 0;
for (const x of rows) maxDiff = Math.max(maxDiff, Math.abs(scan.rows.find((y: { sym: string }) => y.sym === x.sym).score - x.score));
console.log(`parsed ${r.rows} rows, missing columns: [${r.missing}], max score difference vs scan: ${maxDiff.toFixed(2)}`);

const nq = parseQuotes(
  "Symbol,Name,Last Sale,Net Change,% Change,Market Cap,Country,IPO Year,Volume,Sector,Industry\n" +
    "AAPL,Apple Inc. Common Stock,$356.27,1.39,0.39%,5177380481140.00,United States,1980,39099985,Technology,Computer Manufacturing",
);
console.log("nasdaq format:", JSON.stringify(nq.quotes), "missing:", nq.missing.join(","));
if (maxDiff > 1.5 || nq.quotes.AAPL?.c !== 356.27) {
  console.error("CHECK FAILED");
  process.exit(1);
}
