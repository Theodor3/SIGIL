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
    cash: float,
    exposure_target: float = 0.75,
    tolerance_pct: float = 0.01,
    sell_proceeds_haircut: float = 0.02,
    ranks: dict[str, int] | None = None,
    keep_rank: int = 50,
    max_turnover_pct: float | None = None,
) -> RebalancePlan:
    """Compute the diff between current holdings and target allocation.

    Args:
        current_positions: {ticker: {"shares": int, "market_value": float}}
        target_weights: {ticker: weight} from portfolio constructor (sums to ~1.0)
        prices: {ticker: current_price}
        portfolio_value: total account equity
        cash: available cash — buys are capped at cash + haircut sell proceeds,
            so negative cash (margin debt) is paid down before new buys
        exposure_target: regime-driven gross exposure (e.g. 0.75 for risk_on)
        tolerance_pct: skip trades where |delta| < this (default 1%)
        sell_proceeds_haircut: discount on expected sell proceeds when budgeting
            buys, absorbing price movement between planning and fills
        ranks: {ticker: 1-based score rank} for every scored ticker. Enables
            hysteresis: a held position that merely slipped out of the target
            top-N is kept until its rank falls past keep_rank, so run-to-run
            ranking noise doesn't churn the book
        keep_rank: worst rank a held position may reach before it's exited
        max_turnover_pct: cap on total traded notional (sells + buys) per
            rebalance as a fraction of portfolio value; None = uncapped
    """

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

        # Hysteresis: held, out of the target set, but still ranked well
        # enough — hold it rather than churn on ranking noise
        if (
            ranks is not None
            and ticker not in scaled_targets
            and cur_pct > 0
            and ranks.get(ticker, 10**9) <= keep_rank
        ):
            skipped.append({
                "ticker": ticker,
                "current_pct": round(cur_pct * 100, 2),
                "target_pct": 0.0,
                "delta_pct": round(-cur_pct * 100, 2),
                "reason": "hysteresis_hold",
            })
            continue

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

        if is_unwanted:
            # Sell entire position — a market sell needs no price, so exits
            # must not be skipped when a quote is missing (price 0)
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

        price = prices.get(ticker, 0)
        if price <= 0:
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

    # Turnover cap: bound total traded notional per rebalance. Exits go
    # first (they shed unwanted risk), worst-ranked first; deferred orders
    # simply wait for the next cycle.
    turnover_budget = (
        max_turnover_pct * portfolio_value if max_turnover_pct else float("inf")
    )
    sells.sort(key=lambda o: (
        0 if o.reason == "exit" else 1,
        -(ranks or {}).get(o.ticker, 10**9),
    ))
    allowed_sells: list[RebalanceOrder] = []
    for order in sells:
        notional = order.shares * prices.get(order.ticker, 0)
        if notional > turnover_budget:
            skipped.append({
                "ticker": order.ticker,
                "current_pct": order.current_pct,
                "target_pct": order.target_pct,
                "delta_pct": order.delta_pct,
                "reason": "turnover_cap",
            })
            continue
        turnover_budget -= notional
        allowed_sells.append(order)
    sells = allowed_sells

    total_sell = sum(o.shares * prices.get(o.ticker, 0) for o in sells)

    # Cap buys at available cash plus discounted sell proceeds. Buys are
    # funded largest-underweight first; anything past the budget is dropped
    # so the account can never be pushed (further) onto margin.
    budget = cash + total_sell * (1 - sell_proceeds_haircut)
    buys.sort(key=lambda o: o.delta_pct, reverse=True)
    funded_buys: list[RebalanceOrder] = []
    for order in buys:
        price = prices.get(order.ticker, 0)
        spendable = min(budget, turnover_budget)
        affordable = int(spendable / price) if price > 0 and spendable > 0 else 0
        shares = min(order.shares, affordable)
        if shares <= 0:
            skipped.append({
                "ticker": order.ticker,
                "current_pct": order.current_pct,
                "target_pct": order.target_pct,
                "delta_pct": order.delta_pct,
                "reason": "insufficient_cash" if budget < turnover_budget else "turnover_cap",
            })
            continue
        order.shares = shares
        budget -= shares * price
        turnover_budget -= shares * price
        funded_buys.append(order)
    buys = funded_buys

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
