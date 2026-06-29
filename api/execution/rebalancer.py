"""Diff-based portfolio rebalancer.

Compares current positions against target weights and generates
the minimal set of orders to converge, respecting a tolerance band.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class RebalanceOrder:
    ticker: str
    side: str  # "buy" or "sell"
    shares: int
    reason: str  # "new", "add", "trim", "exit"
    current_pct: float
    target_pct: float
    delta_pct: float


@dataclass
class RebalancePlan:
    sells: list[RebalanceOrder]
    buys: list[RebalanceOrder]
    skipped: list[dict]  # within tolerance
    total_sell_value: float
    total_buy_value: float
    net_cash_change: float
    positions_before: int
    positions_after: int


def compute_rebalance(
    current_positions: dict[str, dict],
    target_weights: dict[str, float],
    prices: dict[str, float],
    portfolio_value: float,
    exposure_target: float = 0.75,
    tolerance_pct: float = 0.01,
) -> RebalancePlan:
    """Compute the diff between current holdings and target allocation.

    Args:
        current_positions: {ticker: {"shares": int, "market_value": float}}
        target_weights: {ticker: weight} from portfolio constructor (sums to ~1.0)
        prices: {ticker: current_price}
        portfolio_value: total account equity
        exposure_target: regime-driven gross exposure (e.g. 0.75 for risk_on)
        tolerance_pct: skip trades where |delta| < this (default 1%)
    """
    deployed_capital = portfolio_value * exposure_target

    # Scale target weights by exposure target so they represent % of total equity
    scaled_targets: dict[str, float] = {}
    for ticker, w in target_weights.items():
        scaled_targets[ticker] = w * exposure_target

    # Current allocation as % of portfolio value
    current_alloc: dict[str, float] = {}
    for ticker, pos in current_positions.items():
        current_alloc[ticker] = pos["market_value"] / portfolio_value if portfolio_value else 0

    all_tickers = set(list(scaled_targets.keys()) + list(current_alloc.keys()))

    sells: list[RebalanceOrder] = []
    buys: list[RebalanceOrder] = []
    skipped: list[dict] = []

    for ticker in sorted(all_tickers):
        cur_pct = current_alloc.get(ticker, 0.0)
        tgt_pct = scaled_targets.get(ticker, 0.0)
        delta_pct = tgt_pct - cur_pct

        # Force-exit positions not in target set — don't let tolerance hide them
        is_unwanted = ticker not in scaled_targets and cur_pct > 0

        if not is_unwanted and abs(delta_pct) < tolerance_pct:
            if cur_pct > 0 or tgt_pct > 0:
                skipped.append({
                    "ticker": ticker,
                    "current_pct": round(cur_pct * 100, 2),
                    "target_pct": round(tgt_pct * 100, 2),
                    "delta_pct": round(delta_pct * 100, 2),
                })
            continue

        price = prices.get(ticker, 0)
        if price <= 0:
            continue

        if is_unwanted:
            # Sell entire position
            cur_shares = current_positions.get(ticker, {}).get("shares", 0)
            if cur_shares > 0:
                sells.append(RebalanceOrder(
                    ticker=ticker,
                    side="sell",
                    shares=cur_shares,
                    reason="exit",
                    current_pct=round(cur_pct * 100, 2),
                    target_pct=0.0,
                    delta_pct=round(-cur_pct * 100, 2),
                ))
            continue

        dollar_delta = abs(delta_pct) * portfolio_value
        share_delta = int(dollar_delta / price)
        if share_delta == 0:
            continue

        if delta_pct < 0:
            cur_shares = current_positions.get(ticker, {}).get("shares", 0)
            share_delta = min(share_delta, cur_shares)
            if share_delta == 0:
                continue
            reason = "exit" if tgt_pct == 0 else "trim"
            sells.append(RebalanceOrder(
                ticker=ticker,
                side="sell",
                shares=share_delta,
                reason=reason,
                current_pct=round(cur_pct * 100, 2),
                target_pct=round(tgt_pct * 100, 2),
                delta_pct=round(delta_pct * 100, 2),
            ))
        else:
            reason = "new" if cur_pct == 0 else "add"
            buys.append(RebalanceOrder(
                ticker=ticker,
                side="buy",
                shares=share_delta,
                reason=reason,
                current_pct=round(cur_pct * 100, 2),
                target_pct=round(tgt_pct * 100, 2),
                delta_pct=round(delta_pct * 100, 2),
            ))

    total_sell = sum(o.shares * prices.get(o.ticker, 0) for o in sells)
    total_buy = sum(o.shares * prices.get(o.ticker, 0) for o in buys)

    current_count = len([t for t in current_positions if current_positions[t].get("shares", 0) > 0])
    exits = {o.ticker for o in sells if o.reason == "exit"}
    new_entries = {o.ticker for o in buys if o.reason == "new"}
    after_count = current_count - len(exits) + len(new_entries)

    return RebalancePlan(
        sells=sells,
        buys=buys,
        skipped=skipped,
        total_sell_value=round(total_sell, 2),
        total_buy_value=round(total_buy, 2),
        net_cash_change=round(total_sell - total_buy, 2),
        positions_before=current_count,
        positions_after=after_count,
    )
