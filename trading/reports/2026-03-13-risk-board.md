# Portfolio Risk Board - 2026-03-13

- Account size (configured): $14508.25
- Equity sleeve (actual): $8225.25 (target $8225.25)
- Crypto sleeve (actual): $2171.78 (target $2171.78)
- Cash sleeve (configured): $4111.00
- Cash/other implied drift: $0.22

## Guardrails

| Metric | Value | Status | Note |
|---|---:|---|---|
| Largest single position | 8.42% | OK | Target <= 12% of equity sleeve |
| Top-5 concentration | 33.06% | OK | Target <= 50% |
| Concentration index (HHI) | 0.042 | OK | Lower is better diversified |
| Leveraged ETF exposure | 1.21% | OK | Keep small due to path dependency |
| Tiny-position drag (<$100) | 18 names / 12.46% | OK | Too many tiny lots can dilute focus |

## Largest Positions

| Ticker | Equity | Weight |
|---|---:|---:|
| ARGT | $692.56 | 8.42% |
| AVGO | $667.90 | 8.12% |
| XME | $563.43 | 6.85% |
| RTX | $408.27 | 4.96% |
| FSLR | $387.06 | 4.71% |

## Crypto Sleeve

| Symbol | Equity | Weight of Crypto |
|---|---:|---:|
| ETH | $1489.63 | 68.59% |
| BTC | $675.01 | 31.08% |
| DOGE | $7.14 | 0.33% |

## Options Risk Budget

- Max risk per options trade: $150.00
- Suggested concurrent options trades: <= 4
- Prefer defined-risk structures while account size is small (debit spreads / protective puts).