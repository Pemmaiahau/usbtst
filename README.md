# Overnight & Swing Desk

A screener for BTST (buy today, sell tomorrow) and swing trades in US large caps (S&P 500 + Nasdaq-100).
It is a static website: a script downloads free data and writes JSON, and the pages read that JSON.
It works on a laptop and on a phone, and can be added to the iPhone home screen (Safari → Share → Add to Home Screen).

It screens and explains; it does not place trades and is not tied to any broker. It is not financial advice.

## Run it on your computer

```
npm install
npm run scan      # downloads data, scores stocks, backtests (about 1-3 minutes)
npm run dev       # open http://localhost:3000
```

Run `npm run scan` again whenever you want fresh data. `npm run universe` refreshes the stock list and the upload templates (do it every few months).

## Screens

| Screen | What it answers |
| --- | --- |
| Pulse | Should I trade long today? Index trend, VIX, breadth, futures and overseas markets, rates/dollar/oil, US data and Fed events, earnings this week. |
| BTST | Buy list and sell list for the close-to-open trade, each with written reasons and position size. |
| Swing | Four buy setups and four sell setups with entry, stop, target, time limit, size and six confluence checks. |
| Futures | Buy / sell / stand-aside calls for ES, NQ, YM and RTY (swing and overnight), with reasons, levels and the 20-year record of each rule. |
| Upload | Re-rank BTST with fresher prices from a CSV you download yourself. |
| Backtest | How every rule performed over about four years, including the bad years. |
| Journal | Your own trades (stored in the browser on that device only). |

## Free hosting (GitHub Pages)

1. Put this folder in its own GitHub repository (public; free Pages needs a public repo) and push to `main`.
2. In the repository: Settings → Pages → Source → **GitHub Actions**.
3. The workflow in `.github/workflows/scan-deploy.yml` publishes when you start it by hand (Actions tab → Run workflow).
   (before the open, twice near the close to cover summer/winter time, and after the close).
   You can also start it by hand from the Actions tab ("Run workflow").

The site will be at `https://<your-user>.github.io/<repo-name>/`.
Any other static host works too: run `npm run scan && npm run build` and upload the `out` folder.

## Data sources (all free, no keys)

- Prices: Yahoo Finance chart endpoint (daily bars; intraday bar lags about 15 minutes).
- Earnings dates and US economic calendar: Nasdaq.com.
- Headlines: Yahoo Finance RSS, for the top-ranked stocks only, with simple keyword tone.
- Stock list: S&P 500 from the `datasets/s-and-p-500-companies` GitHub dataset, Nasdaq-100 from Nasdaq.com.

These are unofficial public endpoints and can change or rate-limit. If more than 20% of stocks fail to download the scan stops and the previous site stays up.

Not included: short interest, insider trades, pre-market and after-hours quotes (the stock page links to Yahoo and Finviz for those), and US market holidays (the calendar logic treats every weekday as a session).

## Manual live quotes

The Upload screen accepts any CSV with a Symbol/Ticker column and a Last/Price column; Open, High, Low and Volume are used when present.
Templates are in `public/templates/`:

- `google-sheets-live-quotes.csv`: import into Google Sheets once; it fills prices with `GOOGLEFINANCE`. Download it as CSV near the close and upload.
- `manual-quotes-template.csv`: blank template for data copied from a broker or charting platform.

The Nasdaq.com screener "Download CSV" file also works as-is (price and volume only).

## How the strategies were chosen

`scripts/scan.ts` backtests every rule on each run and the Backtest screen shows the result.
The first BTST idea (strong close on high volume) showed no edge over about 5,000 trades, so the score was rebuilt
from the factors that did predict the close-to-open return in this universe:
volatility rank, a habit of gapping up, weak intraday trading, and oversold dips in long-term uptrends.
The remaining edge is small (well under 0.1% per trade after 0.05% costs) and the weights were fitted on the same period
they are tested on, so expect less in live trading. A broker that charges more than about 0.05% per round trip removes it.

## Sell side and index futures

The same backtest covers the sell side, and it is reported as it came out: shorting S&P 500 / Nasdaq-100 stocks, overnight or on swing setups,
lost money over the test period, so the stock sell lists are labelled as "avoid or exit" lists rather than short ideas.
Index futures are different: over about 20 years, buying sharp dips above the 200-day average and selling sharp rallies below it both had a
positive record on all four indexes. Each index rule is used for a call only when its own record is positive.

## Code map

- `src/lib/indexSignals.ts`: index futures rules and their backtest.

- `src/lib/btst.ts`, `src/lib/swing.ts`, `src/lib/indicators.ts`: scoring rules, shared by the scan script and the browser.
- `scripts/scan.ts`: download, score, backtest, write `public/data/`.
- `scripts/universe.ts`: stock list and templates. `scripts/check-upload.ts`: sanity check (`npm run check`).
- `src/app/*`: the screens.
