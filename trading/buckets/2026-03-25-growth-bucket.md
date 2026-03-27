# Growth Bucket Scan - 2026-03-25

- Universe size: 503
- Successfully evaluated: 503
- Hard rejects removed: 26
- Passed all filters: 9
- Bucket size written: 75
- Filters are now used as strong preferences, not the only way into the candidate bucket.

## Top Ranked Names (up to 20)

| Rank | Ticker | Preselection | Passed Filters | Growth Score | Valuation | Method | Context | Rev CAGR 3Y | FCF CAGR 3Y | ROIC | FCF Yield | Fwd P/E | EV/EBITDA | Missing Data |
|---:|---|---:|---:|---|---|---:|---:|---:|---:|---:|---:|---|
| 1 | NVDA | 111.07 | yes | 81.47 | 0.300 | enterprise_multiples | industry:SEMICONDUCTORS | 100.05% | 193.91% | 70.17% | 2.27% | 15.76 | 31.57 | none |
| 2 | DECK | 89.25 | no | 61.44 | 0.650 | enterprise_multiples | sector:CONSUMER CYCLICAL | 16.53% | 99.15% | 101.70% | 6.49% | 13.85 | 9.30 | none |
| 3 | APP | 89.03 | yes | 61.28 | 0.146 | enterprise_multiples | sector:COMMUNICATION SERVICES | 24.84% | 112.29% | 112.96% | 2.68% | 21.52 | 34.67 | none |
| 4 | ANET | 85.79 | yes | 58.11 | 0.140 | enterprise_multiples | industry:COMPUTER HARDWARE | 27.15% | 111.70% | 30.61% | 2.58% | 30.68 | 39.11 | none |
| 5 | PLTR | 83.87 | yes | 57.54 | 0.028 | enterprise_multiples | industry:SOFTWARE - INFRASTRUCTURE | 32.92% | 125.29% | 22.51% | 0.57% | 82.89 |  | none |
| 6 | NEM | 82.83 | yes | 49.33 | 0.625 | enterprise_multiples | sector:BASIC MATERIALS | 23.91% | 88.54% | 22.52% | 6.75% | 8.90 | 7.61 | none |
| 7 | IBKR | 81.90 | yes | 50.90 | 0.417 | financial_multiples | industry:CAPITAL MARKETS | 34.60% | 59.24% | 1915.12% | 14.01% | 24.14 |  | none |
| 8 | FIX | 81.02 | yes | 52.62 | 0.200 | enterprise_multiples | industry:ENGINEERING & CONSTRUCTION | 30.03% | 59.71% | 53.24% | 2.00% | 32.99 | 34.92 | none |
| 9 | UBER | 80.73 | no | 54.16 | 0.547 | enterprise_multiples | global | 17.73% | 192.53% | 1627.00% | 6.50% | 14.81 | 24.49 | none |
| 10 | RMD | 75.28 | no | 51.17 | 0.343 | enterprise_multiples | industry:MEDICAL INSTRUMENTS & SUPPLIES | 12.88% | 103.77% | 25.11% | 4.96% | 18.74 | 16.14 | none |
| 11 | DELL | 72.06 | no | 47.28 | 0.647 | enterprise_multiples | industry:COMPUTER HARDWARE | 3.53% | 147.81% | 39.43% | 7.29% | 12.22 | 11.78 | none |
| 12 | NFLX | 68.62 | no | 47.52 | 0.092 | enterprise_multiples | industry:ENTERTAINMENT | 12.64% | 80.14% | 35.89% | 2.45% | 23.65 | 28.68 | none |
| 13 | DHI | 68.17 | no | 40.97 | 0.600 | enterprise_multiples | industry:RESIDENTIAL CONSTRUCTION | 0.76% | 99.49% | 12.41% | 8.15% | 11.23 | 9.79 | none |
| 14 | JBL | 67.66 | no | 37.26 | 0.867 | enterprise_multiples | industry:ELECTRONIC COMPONENTS | -3.80% | 63.94% | 35.88% | 3.96% | 19.04 | 13.45 | none |
| 15 | XYZ | 67.12 | no | 40.42 | 0.767 | enterprise_multiples | industry:SOFTWARE - INFRASTRUCTURE | 11.33% | 681.09% | 11.85% | 6.66% | 12.67 | 18.17 | none |
| 16 | EME | 67.08 | no | 39.08 | 0.667 | enterprise_multiples | industry:ENGINEERING & CONSTRUCTION | 15.32% | 38.40% | 38.27% | 3.49% | 24.11 | 18.85 | none |
| 17 | DASH | 66.21 | no | 45.15 | 0.167 | enterprise_multiples | sector:CONSUMER CYCLICAL | 27.73% | 343.02% | 8.04% | 2.72% | 20.25 | 53.38 | none |
| 18 | CTVA | 65.73 | no | 39.73 | 0.500 | enterprise_multiples | sector:BASIC MATERIALS | -0.10% | 119.27% | 8.41% | 5.19% | 19.94 | 13.92 | none |
| 19 | UHS | 65.70 | no | 35.30 | 0.867 | enterprise_multiples | industry:HEALTH CARE | 9.03% | 46.54% | 959.00% | 7.26% | 7.70 | 6.32 | none |
| 20 | INCY | 65.21 | no | 33.21 | 1.000 | enterprise_multiples | industry:BIOTECHNOLOGY | 14.84% | 14.23% | 49.19% | 7.37% | 10.48 | 10.08 | none |

## Missing Data Flags

- fcf_cagr_3y: 106
- debt_to_ebitda: 55
- roic: 47
- fcf_margin: 35
- revenue_cagr_3y: 1

## Notes

- Source: normalized fundamentals provider client with Yahoo fallback and Finnhub hooks. Bucket capped at top 75 scored names.
- This is a candidate bucket for manual review, not investment advice.