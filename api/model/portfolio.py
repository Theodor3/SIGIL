"""Portfolio constructor — size positions from scored universe with constraints."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class PortfolioTarget:
    ticker: str
    weight: float
    shares: int
    side: str
    signal_scores: dict[str, float]
    final_score: float
    confidence: float


@dataclass
class PortfolioConstraints:
    max_positions: int = 20
    max_position_pct: float = 0.08
    min_position_pct: float = 0.02
    max_sector_pct: float = 0.30
    min_confidence: float = 0.58
    long_only: bool = True


def construct_portfolio(
    scored: list,
    total_capital: float,
    prices: dict[str, float],
    sectors: dict[str, str],
    constraints: PortfolioConstraints | None = None,
) -> list[PortfolioTarget]:
    constraints = constraints or PortfolioConstraints()

    eligible = [s for s in scored if s.eligible and s.final_score > 0]
    eligible = eligible[: constraints.max_positions]

    if not eligible:
        return []

    raw_weights = {}
    total_score = sum(s.final_score for s in eligible)
    for s in eligible:
        raw_weights[s.ticker] = s.final_score / max(total_score, 1e-9)

    # Apply position caps
    for ticker in raw_weights:
        raw_weights[ticker] = min(raw_weights[ticker], constraints.max_position_pct)
        raw_weights[ticker] = max(raw_weights[ticker], constraints.min_position_pct)

    # Apply sector caps
    sector_totals: dict[str, float] = {}
    for ticker, w in raw_weights.items():
        sector = sectors.get(ticker, "Unknown")
        sector_totals[sector] = sector_totals.get(sector, 0) + w

    for sector, total in sector_totals.items():
        if total > constraints.max_sector_pct:
            scale = constraints.max_sector_pct / total
            for ticker in raw_weights:
                if sectors.get(ticker, "Unknown") == sector:
                    raw_weights[ticker] *= scale

    # Re-normalize to sum to 1.0
    weight_sum = sum(raw_weights.values())
    if weight_sum > 0:
        for ticker in raw_weights:
            raw_weights[ticker] /= weight_sum

    targets = []
    for s in eligible:
        if s.ticker not in raw_weights:
            continue
        weight = raw_weights[s.ticker]
        price = prices.get(s.ticker, 0)
        shares = int((total_capital * weight) / price) if price > 0 else 0
        if shares == 0:
            continue
        targets.append(PortfolioTarget(
            ticker=s.ticker,
            weight=round(weight, 6),
            shares=shares,
            side="long",
            signal_scores=s.signal_scores,
            final_score=s.final_score,
            confidence=s.confidence,
        ))

    targets.sort(key=lambda t: t.weight, reverse=True)
    return targets
