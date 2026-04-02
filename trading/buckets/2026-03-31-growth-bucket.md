# Growth Bucket Scan - 2026-03-31

- Universe size: 503
- Successfully evaluated: 503
- Hard rejects removed: 26
- Passed all filters: 9
- Bucket size written: 75
- Filters are now used as strong preferences, not the only way into the candidate bucket.

## Top Ranked Names (up to 20)

| Rank | Ticker | Preselection | Passed Filters | Growth Score | Valuation | Method | Context | Rev CAGR 3Y | FCF CAGR 3Y | ROIC | FCF Yield | Fwd P/E | EV/EBITDA | Missing Data |
|---:|---|---:|---:|---|---|---:|---:|---:|---:|---:|---:|---|
| 1 | NVDA | 111.53 | yes | 81.47 | 0.338 | enterprise_multiples | industry:SEMICONDUCTORS | 100.05% | 193.91% | 70.17% | 2.41% | 14.86 | 29.74 | none |
| 2 | DECK | 89.67 | no | 61.44 | 0.686 | enterprise_multiples | sector:CONSUMER CYCLICAL | 16.53% | 99.15% | 101.70% | 6.92% | 12.97 | 8.63 | none |
| 3 | APP | 89.45 | yes | 61.28 | 0.181 | enterprise_multiples | sector:COMMUNICATION SERVICES | 24.84% | 112.29% | 112.96% | 3.14% | 18.37 | 29.63 | none |
| 4 | ANET | 86.15 | yes | 58.11 | 0.170 | enterprise_multiples | industry:COMPUTER HARDWARE | 27.15% | 111.70% | 30.61% | 2.91% | 27.22 | 34.43 | none |
| 5 | PLTR | 83.87 | yes | 57.54 | 0.028 | enterprise_multiples | industry:SOFTWARE - INFRASTRUCTURE | 32.92% | 125.29% | 22.51% | 0.64% | 73.66 |  | none |
| 6 | NEM | 83.41 | yes | 49.33 | 0.673 | enterprise_multiples | sector:BASIC MATERIALS | 23.91% | 88.54% | 22.52% | 6.51% | 9.38 | 7.93 | none |
| 7 | IBKR | 81.90 | yes | 50.90 | 0.417 | financial_multiples | industry:CAPITAL MARKETS | 34.60% | 59.24% | 1915.12% | 14.54% | 23.25 |  | none |
| 8 | FIX | 81.02 | yes | 52.62 | 0.200 | enterprise_multiples | industry:ENGINEERING & CONSTRUCTION | 30.03% | 59.71% | 53.24% | 2.30% | 28.74 | 30.37 | none |
| 9 | RMD | 75.57 | no | 51.17 | 0.367 | enterprise_multiples | industry:MEDICAL INSTRUMENTS & SUPPLIES | 12.88% | 103.77% | 25.11% | 5.14% | 18.07 | 15.55 | none |
| 10 | UBER | 74.49 | no | 45.10 | 0.783 | enterprise_multiples | industry:SOFTWARE - APPLICATION | 17.73% | 192.53% | 13.73% | 6.79% | 16.28 | 23.70 | none |
| 11 | DELL | 73.18 | no | 47.28 | 0.740 | enterprise_multiples | industry:COMPUTER HARDWARE | 3.53% | 147.81% | 39.43% | 7.84% | 11.38 | 11.09 | none |
| 12 | DHI | 68.97 | no | 40.97 | 0.667 | enterprise_multiples | industry:RESIDENTIAL CONSTRUCTION | 0.76% | 99.49% | 12.41% | 8.51% | 10.76 | 9.42 | none |
| 13 | NFLX | 68.62 | no | 47.52 | 0.092 | enterprise_multiples | industry:ENTERTAINMENT | 12.64% | 80.14% | 35.89% | 2.40% | 24.13 | 29.32 | none |
| 14 | XYZ | 67.28 | no | 40.42 | 0.780 | enterprise_multiples | industry:SOFTWARE - INFRASTRUCTURE | 11.33% | 681.09% | 11.85% | 7.00% | 12.07 | 17.34 | none |
| 15 | EME | 67.08 | no | 39.08 | 0.667 | enterprise_multiples | industry:ENGINEERING & CONSTRUCTION | 15.32% | 38.40% | 38.27% | 3.79% | 22.21 | 17.33 | none |
| 16 | DASH | 66.49 | no | 45.15 | 0.190 | enterprise_multiples | sector:CONSUMER CYCLICAL | 27.73% | 343.02% | 8.04% | 2.84% | 19.37 | 50.98 | none |
| 17 | JBL | 66.26 | no | 37.26 | 0.750 | enterprise_multiples | sector:TECHNOLOGY | -3.80% | 63.94% | 35.88% | 4.43% | 16.99 | 12.12 | none |
| 18 | CTVA | 66.22 | no | 39.73 | 0.542 | enterprise_multiples | sector:BASIC MATERIALS | -0.10% | 119.27% | 8.41% | 5.05% | 20.50 | 14.34 | none |
| 19 | INCY | 65.21 | no | 33.21 | 1.000 | enterprise_multiples | industry:BIOTECHNOLOGY | 14.84% | 14.23% | 49.19% | 7.40% | 10.44 | 10.04 | none |
| 20 | LULU | 64.88 | no | 34.90 | 0.832 | enterprise_multiples | sector:CONSUMER CYCLICAL | 19.17% | 16.77% | 45.05% | 9.26% | 10.99 | 6.22 | none |

## Missing Data Flags

- fcf_cagr_3y: 106
- roic: 56
- debt_to_ebitda: 55
- fcf_margin: 35
- revenue_cagr_3y: 1

## Notes

- Source: normalized fundamentals provider client with Yahoo fallback and Finnhub hooks. Bucket capped at top 75 scored names.
- This is a candidate bucket for manual review, not investment advice.