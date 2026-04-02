# Growth Bucket Scan - 2026-04-01

- Universe size: 503
- Successfully evaluated: 503
- Hard rejects removed: 21
- Passed all filters: 9
- Bucket size written: 75
- Filters are now used as strong preferences, not the only way into the candidate bucket.

## Top Ranked Names (up to 20)

| Rank | Ticker | Preselection | Passed Filters | Growth Score | Valuation | Method | Context | Rev CAGR 3Y | FCF CAGR 3Y | ROIC | FCF Yield | Fwd P/E | EV/EBITDA | Missing Data |
|---:|---|---:|---:|---|---|---:|---:|---:|---:|---:|---:|---|
| 1 | NVDA | 111.35 | yes | 81.47 | 0.323 | enterprise_multiples | industry:SEMICONDUCTORS | 100.05% | 193.91% | 70.17% | 2.26% | 15.81 | 31.43 | none |
| 2 | APP | 89.56 | yes | 61.28 | 0.190 | enterprise_multiples | sector:COMMUNICATION SERVICES | 24.84% | 112.29% | 112.96% | 3.01% | 19.14 | 30.88 | none |
| 3 | DECK | 89.42 | no | 61.44 | 0.665 | enterprise_multiples | sector:CONSUMER CYCLICAL | 16.53% | 99.15% | 101.70% | 6.52% | 13.78 | 9.25 | none |
| 4 | ANET | 85.79 | yes | 58.11 | 0.140 | enterprise_multiples | industry:COMPUTER HARDWARE | 27.15% | 111.70% | 30.61% | 2.70% | 29.21 | 37.22 | none |
| 5 | PLTR | 83.85 | yes | 57.54 | 0.026 | enterprise_multiples | industry:SOFTWARE - INFRASTRUCTURE | 32.92% | 125.29% | 22.51% | 0.60% | 78.70 |  | none |
| 6 | NEM | 82.77 | yes | 49.33 | 0.620 | enterprise_multiples | sector:BASIC MATERIALS | 23.91% | 88.54% | 22.52% | 5.90% | 10.48 | 8.77 | none |
| 7 | IBKR | 81.90 | yes | 50.90 | 0.417 | financial_multiples | industry:CAPITAL MARKETS | 34.60% | 59.24% | 1915.12% | 13.64% | 24.64 |  | none |
| 8 | FIX | 81.02 | yes | 52.62 | 0.200 | enterprise_multiples | industry:ENGINEERING & CONSTRUCTION | 30.03% | 59.71% | 53.24% | 2.05% | 32.25 | 34.12 | none |
| 9 | RMD | 75.28 | no | 51.17 | 0.343 | enterprise_multiples | industry:MEDICAL INSTRUMENTS & SUPPLIES | 12.88% | 103.77% | 25.11% | 5.08% | 18.30 | 15.87 | none |
| 10 | UBER | 73.10 | no | 45.10 | 0.667 | enterprise_multiples | sector:TECHNOLOGY | 17.73% | 192.53% | 13.73% | 6.62% | 14.73 | 24.29 | none |
| 11 | DELL | 72.06 | no | 47.28 | 0.647 | enterprise_multiples | industry:COMPUTER HARDWARE | 3.53% | 147.81% | 39.43% | 7.62% | 11.68 | 11.36 | none |
| 12 | NFLX | 68.46 | no | 47.52 | 0.079 | enterprise_multiples | industry:ENTERTAINMENT | 12.64% | 80.14% | 35.89% | 2.33% | 24.80 | 30.30 | none |
| 13 | XYZ | 67.38 | no | 40.42 | 0.788 | enterprise_multiples | industry:SOFTWARE - INFRASTRUCTURE | 11.33% | 681.09% | 11.85% | 6.70% | 12.60 | 18.07 | none |
| 14 | DHI | 67.37 | no | 40.97 | 0.533 | enterprise_multiples | industry:RESIDENTIAL CONSTRUCTION | 0.76% | 99.49% | 12.41% | 8.16% | 11.23 | 9.79 | none |
| 15 | EME | 67.08 | no | 39.08 | 0.667 | enterprise_multiples | industry:ENGINEERING & CONSTRUCTION | 15.32% | 38.40% | 38.27% | 3.50% | 24.06 | 18.81 | none |
| 16 | DASH | 66.58 | no | 45.15 | 0.198 | enterprise_multiples | sector:CONSUMER CYCLICAL | 27.73% | 343.02% | 8.04% | 2.79% | 19.69 | 51.75 | none |
| 17 | CTVA | 66.36 | no | 39.73 | 0.553 | enterprise_multiples | sector:BASIC MATERIALS | -0.10% | 119.27% | 8.41% | 4.99% | 20.72 | 14.50 | none |
| 18 | JBL | 65.92 | no | 37.26 | 0.722 | enterprise_multiples | sector:TECHNOLOGY | -3.80% | 63.94% | 35.88% | 4.03% | 18.67 | 13.21 | none |
| 19 | INCY | 65.21 | no | 33.21 | 1.000 | enterprise_multiples | industry:BIOTECHNOLOGY | 14.84% | 14.23% | 49.19% | 7.08% | 10.90 | 10.59 | none |
| 20 | TTD | 64.22 | yes | 26.22 | 1.000 | enterprise_multiples | industry:MEDIA | 22.44% | 19.67% | 17.53% | 7.48% | 24.36 | 13.90 | none |

## Missing Data Flags

- fcf_cagr_3y: 106
- roic: 51
- debt_to_ebitda: 50
- fcf_margin: 30
- revenue_cagr_3y: 1

## Notes

- Source: normalized fundamentals provider client with Yahoo fallback and Finnhub hooks. Bucket capped at top 75 scored names.
- This is a candidate bucket for manual review, not investment advice.