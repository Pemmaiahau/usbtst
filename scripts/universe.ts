// Refreshes data/universe.json (S&P 500 + Nasdaq-100) and the upload templates.
// Run occasionally: npm run universe
import { mkdirSync, writeFileSync } from "node:fs";
import { getText, normSym } from "./net";

type U = { sym: string; name: string; sector: string; idx: string[] };

const NASDAQ_SECTOR: Record<string, string> = {
  Technology: "Information Technology",
  "Health Care": "Health Care",
  "Consumer Discretionary": "Consumer Discretionary",
  "Consumer Staples": "Consumer Staples",
  Finance: "Financials",
  Telecommunications: "Communication Services",
  Industrials: "Industrials",
  Energy: "Energy",
  Utilities: "Utilities",
  "Real Estate": "Real Estate",
  "Basic Materials": "Materials",
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") out.push(cur), (cur = "");
    else cur += ch;
  }
  out.push(cur);
  return out;
}

async function main() {
  const map = new Map<string, U>();
  const sp = await getText("https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv");
  for (const line of sp.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const [sym, name, sector] = parseCsvLine(line);
    map.set(normSym(sym), { sym: normSym(sym), name, sector, idx: ["SP500"] });
  }
  const spCount = map.size;

  const ndx = JSON.parse(await getText("https://api.nasdaq.com/api/quote/list-type/nasdaq100")).data.data.rows as { symbol: string; companyName: string }[];
  const missing: U[] = [];
  for (const r of ndx) {
    const sym = normSym(r.symbol);
    const ex = map.get(sym);
    if (ex) ex.idx.push("NDX");
    else {
      const u = { sym, name: r.companyName.replace(/ (Common Stock|Class [A-C].*|American Depositary.*|Ordinary Shares.*)$/i, "").trim(), sector: "Other", idx: ["NDX"] };
      map.set(sym, u);
      missing.push(u);
    }
  }
  if (missing.length) {
    const scr = JSON.parse(await getText("https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25&download=true")).data.rows as { symbol: string; sector: string }[];
    const sec = new Map(scr.map((r) => [normSym(r.symbol), r.sector]));
    for (const u of missing) u.sector = NASDAQ_SECTOR[sec.get(u.sym) ?? ""] ?? "Other";
  }

  const list = [...map.values()].sort((a, b) => a.sym.localeCompare(b.sym));
  if (spCount < 480 || ndx.length < 95) throw new Error(`Universe looks incomplete (S&P ${spCount}, NDX ${ndx.length}); not overwriting.`);
  mkdirSync("data", { recursive: true });
  writeFileSync("data/universe.json", JSON.stringify(list, null, 0).replace(/\},\{/g, "},\n{"));

  // --- upload templates
  mkdirSync("public/templates", { recursive: true });
  const header = "Symbol,Last,Open,High,Low,Volume";
  const gf = (attr: string, row: number) => `"=IFERROR(GOOGLEFINANCE(A${row},""${attr}""),"""")"`;
  const sheet = [header, ...list.map((u, i) => [u.sym.replace("-", "."), gf("price", i + 2), gf("priceopen", i + 2), gf("high", i + 2), gf("low", i + 2), gf("volume", i + 2)].join(","))];
  writeFileSync("public/templates/google-sheets-live-quotes.csv", sheet.join("\n") + "\n");
  writeFileSync("public/templates/manual-quotes-template.csv", [header, "AAPL,356.27,355.90,360.83,355.76,39099985", ...list.slice(0, 5).map((u) => `${u.sym},,,,,`)].join("\n") + "\n");
  console.log(`universe: ${list.length} symbols (S&P ${spCount}, Nasdaq-100 ${ndx.length}, NDX-only ${missing.length})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
