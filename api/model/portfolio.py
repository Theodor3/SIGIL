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


_EPS = 1e-9

# Sentinel used when sector lookup fails. It is not a sector, so it is exempt from
# the sector cap: capping it would clamp the whole book to max_sector_pct on missing
# reference data rather than on any real concentration.
#
# Callers now resolve sectors from the persisted screening cache (api/data/sectors),
# so in normal operation few names land here — where they used to land here almost
# always, because the old source was a 10-minute in-memory cache written only during
# a pipeline run. The exemption stays regardless: a lookup failure is still not a
# concentration, and it is the whole reason a reference-data outage can't force a
# sell-off.
UNCLASSIFIED_SECTOR = "Unknown"


def _sector_totals(weights: dict[str, float], sector_of: dict[str, str]) -> dict[str, float]:
    totals: dict[str, float] = {}
    for ticker, w in weights.items():
        sector = sector_of[ticker]
        totals[sector] = totals.get(sector, 0.0) + w
    return totals


def _apply_caps(
    weights: dict[str, float],
    sector_of: dict[str, str],
    constraints: PortfolioConstraints,
    max_passes: int = 25,
) -> dict[str, float]:
    """Project weights onto the position and sector caps, keeping the sum at 1.0.

    Clipping alone leaves the book short of fully invested, and the obvious repair
    -- dividing through by the new sum -- scales every weight back up, which is how
    positions used to end up above max_position_pct and sectors above
    max_sector_pct despite both being clipped moments earlier. Instead the shortfall
    is pushed only into names that still have room under both caps, and the whole
    pass repeats until nothing is violated.
    """
    max_pos = constraints.max_position_pct
    max_sec = constraints.max_sector_pct
    w = dict(weights)

    # Clip once, then only ever add -- and never add more than the remaining room
    # under either cap. That keeps the whole loop monotone, so it converges instead
    # of oscillating between overshooting a sector and being scaled back down.
    for ticker in w:
        w[ticker] = min(w[ticker], max_pos)
    for sector, total in _sector_totals(w, sector_of).items():
        if sector == UNCLASSIFIED_SECTOR:
            continue
        if total > max_sec + _EPS:
            scale = max_sec / total
            for ticker in w:
                if sector_of[ticker] == sector:
                    w[ticker] *= scale

    for _ in range(max_passes):
        deficit = 1.0 - sum(w.values())
        if deficit <= _EPS:
            break

        sec_room = {
            sector: (float("inf") if sector == UNCLASSIFIED_SECTOR
                     else max_sec - total)
            for sector, total in _sector_totals(w, sector_of).items()
        }
        candidates = {
            t: w[t] for t in w
            if max_pos - w[t] > _EPS and sec_room[sector_of[t]] > _EPS
        }
        base = sum(candidates.values())
        if base <= _EPS:
            break

        # Heaviest first, so when sector room is scarce the top-ranked names get it
        placed = 0.0
        for ticker in sorted(candidates, key=lambda t: -w[t]):
            sector = sector_of[ticker]
            want = deficit * (candidates[ticker] / base)
            take = min(want, max_pos - w[ticker], sec_room[sector])
            if take <= _EPS:
                continue
            w[ticker] += take
            sec_room[sector] -= take
            placed += take
        if placed <= _EPS:
            break

    unclassified = sum(
        v for t, v in w.items() if sector_of[t] == UNCLASSIFIED_SECTOR
    )
    if unclassified > 0.10:
        print(
            f"[portfolio] {unclassified:.1%} of the book has no sector; the "
            f"{max_sec:.0%} sector cap is unenforced on that share. Either "
            f"enforce_sector_cap is off, or those tickers have no sector on file "
            f"in screening_cache — GET /api/portfolio/sector-preview says which."
        )

    shortfall = 1.0 - sum(w.values())
    if shortfall > 1e-4:
        print(
            f"[portfolio] Caps leave the book underinvested: {len(w)} names at "
            f"max_position={max_pos:.1%} / max_sector={max_sec:.1%} reach "
            f"{sum(w.values()):.4f}; {shortfall:.2%} stays in cash"
        )
    return w


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

    total_score = sum(s.final_score for s in eligible)
    if total_score <= _EPS:
        return []
    raw_weights = {s.ticker: s.final_score / total_score for s in eligible}
    sector_of = {s.ticker: (sectors.get(s.ticker) or "Unknown") for s in eligible}

    # Project onto the caps BEFORE applying the floor. Clipping the big names frees
    # weight that flows to the small ones, so a name that looks unholdably small
    # against raw scores is often well above the floor once the caps have bound --
    # dropping first would throw away most of a skewed book.
    for _ in range(8):
        raw_weights = _apply_caps(raw_weights, sector_of, constraints)
        if len(raw_weights) <= 1:
            break
        below = {t: w for t, w in raw_weights.items()
                 if w < constraints.min_position_pct - _EPS}
        if not below:
            break
        # One at a time: removing the smallest lifts the rest, which can carry the
        # others back over the floor.
        del raw_weights[min(below, key=lambda t: below[t])]
        total = sum(raw_weights.values())
        if total <= _EPS:
            return []
        raw_weights = {t: v / total for t, v in raw_weights.items()}
    # Idempotent when the caps already hold; guarantees the last word is a projection
    raw_weights = _apply_caps(raw_weights, sector_of, constraints)

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
