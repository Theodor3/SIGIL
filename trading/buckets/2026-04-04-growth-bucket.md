# Growth Bucket Scan - 2026-04-04

- Universe size: 503
- Successfully evaluated: 503
- Hard rejects removed: 21
- Passed all filters: 9
- Bucket size written: 75
- Filters are now used as strong preferences, not the only way into the candidate bucket.

## Top Ranked Names (up to 20)

| Rank | Ticker | Preselection | Passed Filters | Growth Score | Valuation | Method | Context | Rev CAGR 3Y | FCF CAGR 3Y | ROIC | FCF Yield | Fwd P/E | EV/EBITDA | Missing Data |
|---:|---|---:|---:|---|---|---:|---:|---:|---:|---:|---:|---|
| 1 | NVDA | 111.47 | yes | 81.47 | 0.333 | enterprise_multiples | industry:SEMICONDUCTORS | 100.05% | 193.91% | 70.17% | 2.24% | 15.96 | 31.97 | none |
| 2 | DECK | 89.56 | no | 61.44 | 0.676 | enterprise_multiples | sector:CONSUMER CYCLICAL | 16.53% | 99.15% | 101.70% | 6.69% | 13.43 | 8.98 | none |
| 3 | APP | 89.44 | yes | 61.28 | 0.180 | enterprise_multiples | sector:COMMUNICATION SERVICES | 24.84% | 112.29% | 112.96% | 3.02% | 19.07 | 30.76 | none |
| 4 | ANET | 85.55 | yes | 58.11 | 0.120 | enterprise_multiples | industry:COMPUTER HARDWARE | 27.15% | 111.70% | 30.61% | 2.67% | 29.64 | 37.80 | none |
| 5 | PLTR | 83.87 | yes | 57.54 | 0.028 | enterprise_multiples | industry:SOFTWARE - INFRASTRUCTURE | 32.92% | 125.29% | 22.51% | 0.59% | 79.76 |  | none |
| 6 | NEM | 82.77 | yes | 49.33 | 0.620 | enterprise_multiples | sector:BASIC MATERIALS | 23.91% | 88.54% | 22.52% | 5.88% | 10.52 | 8.79 | none |
| 7 | IBKR | 81.90 | yes | 50.90 | 0.417 | financial_multiples | industry:CAPITAL MARKETS | 34.60% | 59.24% | 1915.12% | 13.67% | 24.58 |  | none |
| 8 | FIX | 81.02 | yes | 52.62 | 0.200 | enterprise_multiples | industry:ENGINEERING & CONSTRUCTION | 30.03% | 59.71% | 53.24% | 2.06% | 31.99 | 35.62 | none |
| 9 | RMD | 74.77 | no | 51.17 | 0.300 | enterprise_multiples | industry:MEDICAL INSTRUMENTS & SUPPLIES | 12.88% | 103.77% | 25.11% | 5.05% | 18.40 | 15.84 | none |
| 10 | UBER | 74.40 | no | 45.10 | 0.776 | enterprise_multiples | industry:SOFTWARE - APPLICATION | 17.73% | 192.53% | 13.73% | 6.60% | 16.73 | 24.33 | none |
| 11 | DELL | 71.50 | no | 47.28 | 0.600 | enterprise_multiples | industry:COMPUTER HARDWARE | 3.53% | 147.81% | 39.43% | 7.40% | 12.03 | 11.64 | none |
| 12 | NFLX | 68.61 | no | 47.52 | 0.090 | enterprise_multiples | industry:ENTERTAINMENT | 12.64% | 80.14% | 35.89% | 2.26% | 25.60 | 31.07 | none |
| 13 | JBL | 67.66 | no | 37.26 | 0.867 | enterprise_multiples | industry:ELECTRONIC COMPONENTS | -3.80% | 63.94% | 35.88% | 4.09% | 18.44 | 13.05 | none |
| 14 | XYZ | 67.39 | no | 40.42 | 0.789 | enterprise_multiples | industry:SOFTWARE - INFRASTRUCTURE | 11.33% | 681.09% | 11.85% | 6.67% | 12.63 | 18.14 | none |
| 15 | DHI | 67.37 | no | 40.97 | 0.533 | enterprise_multiples | industry:RESIDENTIAL CONSTRUCTION | 0.76% | 99.49% | 12.41% | 8.07% | 11.34 | 9.88 | none |
| 16 | DIS | 67.27 | no | 36.64 | 1.000 | enterprise_multiples | industry:MEDIA | 4.51% | 111.38% | 7.33% | 5.88% | 13.80 | 11.27 | none |
| 17 | EME | 67.08 | no | 39.08 | 0.667 | enterprise_multiples | industry:ENGINEERING & CONSTRUCTION | 15.32% | 38.40% | 38.27% | 3.51% | 24.17 | 18.73 | none |
| 18 | DASH | 66.25 | no | 45.15 | 0.170 | enterprise_multiples | sector:CONSUMER CYCLICAL | 27.73% | 343.02% | 8.04% | 2.69% | 20.48 | 53.99 | none |
| 19 | CTVA | 65.97 | no | 39.73 | 0.520 | enterprise_multiples | sector:BASIC MATERIALS | -0.10% | 119.27% | 8.41% | 4.90% | 21.13 | 14.79 | none |
| 20 | INCY | 65.21 | no | 33.21 | 1.000 | enterprise_multiples | industry:BIOTECHNOLOGY | 14.84% | 14.23% | 49.19% | 6.96% | 11.09 | 10.81 | none |

## Missing Data Flags

- fcf_cagr_3y: 106
- roic: 51
- debt_to_ebitda: 50
- fcf_margin: 30
- revenue_cagr_3y: 1

## Notes

- Source: normalized fundamentals provider client with Yahoo fallback and Finnhub hooks. Bucket capped at top 75 scored names.
- This is a candidate bucket for manual review, not investment advice.