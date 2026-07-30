"""Alpaca broker bridge — paper/live trading via alpaca-py SDK."""
from __future__ import annotations

import asyncio
import hashlib
from dataclasses import dataclass
from datetime import datetime

from api.config.settings import settings


@dataclass
class AccountInfo:
    equity: float
    cash: float
    buying_power: float
    portfolio_value: float
    currency: str = "USD"


@dataclass
class Position:
    ticker: str
    qty: int
    side: str
    avg_entry: float
    current_price: float
    market_value: float
    unrealized_pnl: float
    unrealized_pnl_pct: float


@dataclass
class OrderResult:
    order_id: str
    ticker: str
    side: str
    qty: int
    status: str
    filled_price: float | None = None


@dataclass
class Quote:
    """A two-sided quote. Cost measurement needs both sides: a buy lifts the ask and
    a sell hits the bid, so benchmarking both against one side makes a clean fill
    look free on one and a full spread's loss on the other."""
    ticker: str
    bid: float | None = None
    ask: float | None = None
    ts: datetime | None = None

    @property
    def mid(self) -> float | None:
        if self.bid and self.ask and self.bid > 0 and self.ask > 0:
            return (self.bid + self.ask) / 2
        # One-sided book: the side we do have is the best reference available
        return self.ask or self.bid or None

    @property
    def spread_bps(self) -> float | None:
        if not (self.bid and self.ask) or self.bid <= 0 or self.ask <= 0:
            return None
        mid = (self.bid + self.ask) / 2
        return (self.ask - self.bid) / mid * 10_000 if mid > 0 else None


def _demo_price(ticker: str) -> float:
    """Deterministic stand-in price, unchanged from the original demo path."""
    seed = int(hashlib.md5(ticker.encode()).hexdigest()[:8], 16)
    return 50 + (seed % 400)


class AlpacaBroker:
    def __init__(self):
        self._client = None
        self._demo = not (settings.alpaca_api_key and settings.alpaca_secret_key)

    @property
    def is_demo(self) -> bool:
        return self._demo

    def _get_client(self):
        if self._demo:
            return None
        if self._client is None:
            from alpaca.trading.client import TradingClient
            self._client = TradingClient(
                settings.alpaca_api_key,
                settings.alpaca_secret_key,
                paper=True,
            )
        return self._client

    async def get_account(self) -> AccountInfo:
        if self._demo:
            return AccountInfo(
                equity=100_000.0,
                cash=100_000.0,
                buying_power=200_000.0,
                portfolio_value=100_000.0,
            )
        client = self._get_client()
        acct = client.get_account()
        return AccountInfo(
            equity=float(acct.equity),
            cash=float(acct.cash),
            buying_power=float(acct.buying_power),
            portfolio_value=float(acct.portfolio_value),
        )

    async def get_positions(self) -> list[Position]:
        if self._demo:
            return []
        client = self._get_client()
        positions = client.get_all_positions()
        return [
            Position(
                ticker=p.symbol,
                qty=int(p.qty),
                side="long" if int(p.qty) > 0 else "short",
                avg_entry=float(p.avg_entry_price),
                current_price=float(p.current_price),
                market_value=float(p.market_value),
                unrealized_pnl=float(p.unrealized_pl),
                unrealized_pnl_pct=float(p.unrealized_plpc) * 100,
            )
            for p in positions
        ]

    async def submit_order(
        self, ticker: str, qty: int, side: str = "buy",
        limit_price: float | None = None,
    ) -> OrderResult:
        """Submit an order. With limit_price set, a DAY limit order is used —
        a marketable limit (quote ± collar) fills like a market order in a
        liquid name but can't be run over by a wide spread in a thin one."""
        if self._demo:
            import uuid
            prices = await self.get_prices([ticker])
            return OrderResult(
                order_id=str(uuid.uuid4()),
                ticker=ticker,
                side=side,
                qty=qty,
                status="demo_filled",
                filled_price=prices.get(ticker),
            )
        from alpaca.trading.requests import LimitOrderRequest, MarketOrderRequest
        from alpaca.trading.enums import OrderSide, TimeInForce
        client = self._get_client()
        order_side = OrderSide.BUY if side == "buy" else OrderSide.SELL
        if limit_price and limit_price > 0:
            request = LimitOrderRequest(
                symbol=ticker,
                qty=qty,
                side=order_side,
                time_in_force=TimeInForce.DAY,
                limit_price=round(limit_price, 2),
            )
        else:
            request = MarketOrderRequest(
                symbol=ticker,
                qty=qty,
                side=order_side,
                time_in_force=TimeInForce.DAY,
            )
        order = client.submit_order(request)
        order_id = str(order.id)

        # Poll for fill — market orders usually fill within seconds
        filled_price = None
        if order.filled_avg_price:
            filled_price = float(order.filled_avg_price)
        else:
            for _ in range(10):
                await asyncio.sleep(0.5)
                updated = client.get_order_by_id(order_id)
                if updated.filled_avg_price:
                    filled_price = float(updated.filled_avg_price)
                    order = updated
                    break
                if str(updated.status) in ("canceled", "expired", "rejected"):
                    order = updated
                    break

        # Last resort: use current quote as entry price
        if filled_price is None and str(order.status) not in ("canceled", "expired", "rejected"):
            prices = await self.get_prices([ticker])
            filled_price = prices.get(ticker)

        return OrderResult(
            order_id=order_id,
            ticker=ticker,
            side=side,
            qty=qty,
            status=str(order.status),
            filled_price=filled_price,
        )

    async def get_quotes(self, tickers: list[str]) -> dict[str, Quote]:
        """Latest two-sided quotes, keyed by ticker.

        Missing tickers are simply absent — callers treat that as "don't size a
        trade off this one" rather than as a zero price.
        """
        if self._demo:
            now = datetime.utcnow()
            out = {}
            for t in tickers:
                px = _demo_price(t)
                half = px * 0.0005  # 10bps synthetic spread
                out[t] = Quote(ticker=t, bid=px - half, ask=px + half, ts=now)
            return out
        try:
            from alpaca.data.requests import StockLatestQuoteRequest
            from alpaca.data.historical import StockHistoricalDataClient
            data_client = StockHistoricalDataClient(
                settings.alpaca_api_key, settings.alpaca_secret_key
            )
            request = StockLatestQuoteRequest(symbol_or_symbols=tickers)
            quotes = data_client.get_stock_latest_quote(request)
            out = {}
            for symbol, q in quotes.items():
                bid = float(q.bid_price) if q.bid_price else None
                ask = float(q.ask_price) if q.ask_price else None
                out[symbol] = Quote(
                    ticker=symbol, bid=bid, ask=ask,
                    ts=getattr(q, "timestamp", None),
                )
            return out
        except Exception as e:
            # No fabricated prices in live mode
            print(f"[broker] Quote fetch failed for {len(tickers)} tickers: {e}")
            return {}

    async def get_prices(self, tickers: list[str]) -> dict[str, float]:
        """Mid prices, for position sizing and for valuing a position.

        This used to return the *ask* for every ticker regardless of side. That
        overstated the exit price on every sell, so anywhere a sale was valued from
        a quote instead of a fill — `close/{trade_id}`, `close-all`, and the
        exit-price fallback in the rebalancer — realised P&L came out too high by
        roughly the spread. The mid is side-neutral and is the correct reference for
        both sizing and measurement.
        """
        quotes = await self.get_quotes(tickers)
        return {
            ticker: q.mid
            for ticker, q in quotes.items()
            if q.mid is not None and q.mid > 0
        }

    async def cancel_all_orders(self) -> int:
        """Cancel every open order. Rebalancing is cancel-and-replace: the
        planner prices the account as if no orders are in flight, so any
        pending set (e.g. queued pre-market by an earlier click) would
        stack with the new plan and fill on top of it at the open."""
        if self._demo:
            return 0
        client = self._get_client()
        try:
            res = client.cancel_orders()
            return len(res or [])
        except Exception as e:
            print(f"[broker] Cancel open orders failed: {e}")
            return 0

    async def get_order_fill(self, order_id: str) -> dict | None:
        """Current status and fill data for one order. None if unavailable."""
        if self._demo:
            return None
        try:
            client = self._get_client()
            o = client.get_order_by_id(order_id)
            return {
                "status": str(o.status).split(".")[-1].lower(),
                "filled_qty": float(o.filled_qty or 0),
                "filled_price": float(o.filled_avg_price) if o.filled_avg_price else None,
            }
        except Exception as e:
            print(f"[broker] Order lookup failed for {order_id}: {e}")
            return None

    async def get_fills(self, max_orders: int = 3000) -> list[dict]:
        """All filled orders from account history, oldest data included via
        pagination. The order log is the ground truth for what actually
        executed at what price — used to backfill trade P&L the DB lost."""
        if self._demo:
            return []
        from alpaca.trading.requests import GetOrdersRequest
        from alpaca.trading.enums import QueryOrderStatus

        client = self._get_client()
        fills: list[dict] = []
        seen_ids: set[str] = set()
        until = None
        while len(fills) < max_orders:
            req = GetOrdersRequest(
                status=QueryOrderStatus.CLOSED, limit=500, until=until, direction="desc"
            )
            orders = client.get_orders(filter=req)
            if not orders:
                break
            for o in orders:
                oid = str(o.id)
                if oid in seen_ids:
                    continue
                seen_ids.add(oid)
                qty = float(o.filled_qty or 0)
                price = float(o.filled_avg_price) if o.filled_avg_price else 0.0
                if qty > 0 and price > 0 and o.filled_at:
                    fills.append({
                        "ticker": o.symbol,
                        "side": str(o.side).split(".")[-1].lower(),  # buy / sell
                        "qty": qty,
                        "price": price,
                        "filled_at": o.filled_at,
                    })
            if len(orders) < 500:
                break
            until = orders[-1].submitted_at
        return fills

    async def get_equity_history(self, period: str = "3M") -> list[dict]:
        """Daily account equity from Alpaca's portfolio-history endpoint —
        used once to backfill the equity_snapshots table for the account's
        life before SIGIL started recording its own."""
        if self._demo:
            return []
        from alpaca.trading.requests import GetPortfolioHistoryRequest

        client = self._get_client()
        history = client.get_portfolio_history(
            GetPortfolioHistoryRequest(period=period, timeframe="1D")
        )
        timestamps = history.timestamp or []
        equities = history.equity or []
        out = []
        for ts, eq in zip(timestamps, equities):
            if eq is None or eq <= 0:
                continue
            out.append({
                "taken_at": datetime.utcfromtimestamp(int(ts)),
                "equity": float(eq),
            })
        return out

    async def is_market_open(self) -> bool:
        """True when the market is open for trading. Fails closed on errors."""
        if self._demo:
            return True
        try:
            client = self._get_client()
            clock = client.get_clock()
            return bool(clock.is_open)
        except Exception as e:
            print(f"[broker] Market clock check failed: {e}")
            return False

    async def seconds_until_market_open(self) -> float | None:
        """Seconds until the next regular-session open; 0 if open now.
        None when the clock can't be read."""
        if self._demo:
            return 0.0
        try:
            clock = self._get_client().get_clock()
            if clock.is_open:
                return 0.0
            return max(0.0, (clock.next_open - clock.timestamp).total_seconds())
        except Exception as e:
            print(f"[broker] Market clock check failed: {e}")
            return None
