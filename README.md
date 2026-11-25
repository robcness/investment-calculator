# Investment Calculator

**[Open the calculator](https://robcness.github.io/investment-calculator/)**

A browser-based stock trading calculator for personal use. It works out how many units you can buy or what a sale returns, including the broker fee, tax on the fee and currency conversion, for U.S. and Canadian securities.

Personal tool only. Not financial advice.

## What it does

- Buy and sell calculations with CAD or USD cash, and automatic USD/CAD conversion with a spread.
- Quantity defaults to the maximum your cash allows. Whole units by default, with an option for fractional units.
- Fee: CA$6.95 or US$6.95 per trade, plus 13% HST on CAD trades (0% on USD trades). Both can be changed.
- Target price panel starts at the break-even price, including fees and conversion. Move the slider to see the gain or loss.
- Security details, including CDR ratios from CIBC's CDR directory.

## Prices

| Security | Source | Label |
|---|---|---|
| U.S. stocks | [Finnhub](https://finnhub.io) free plan, through a Supabase Edge Function that keeps the API key server-side | Live |
| CIBC CDRs (e.g., NVDA-CA) | U.S. price × CIBC CDR ratio × FX forward | Estimate |
| Interlisted Canadian shares (XNDU, BB) | U.S. listing price × live USD→CAD rate | Estimate |
| Other TSX / TSXV shares | Starting price from the security list | Not live |

USD→CAD rate: [Coinbase](https://www.coinbase.com/converter/usd/cad) public rates (about every minute), with the [Bank of Canada](https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/) daily rate as reference and fallback.

## Files

- `index.html`, `styles.css`, `app.js`: the app (static, no build step).
- `securities.js`: the security list.
- `config.js`: Supabase function URL and public anon key (browser-safe by design).
- `supabase/functions/quotes/index.ts`: Edge Function that calls Finnhub with the `FINNHUB_API_KEY` secret.

## Run locally

Serve the folder with any static server, for example `npx serve .`, then open the local URL.

## Parked for later

- Searching all markets to add new securities from the dropdown.
- Supabase database: recording executed trades, holdings and sign-in.
