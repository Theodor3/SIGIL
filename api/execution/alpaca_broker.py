"""Alpaca broker bridge — paper/live trading via alpaca-py SDK."""
from __future__ import annotations

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
        self, ticker: str, qty: int, side: str = "buy"
    ) -> OrderResult:
        if self._demo:
            import uuid
            return OrderResult(
                order_id=str(uuid.uuid4()),
                ticker=ticker,
                side=side,
                qty=qty,
                status="demo_filled",
                filled_price=None,
            )
        from alpaca.trading.requests import MarketOrderRequest
        from alpaca.trading.enums import OrderSide, TimeInForce
        client = self._get_client()
        order_side = OrderSide.BUY if side == "buy" else OrderSide.SELL
        request = MarketOrderRequest(
            symbol=ticker,
            qty=qty,
            side=order_side,
            time_in_force=TimeInForce.DAY,
        )
        order = client.submit_order(request)
        return OrderResult(
            order_id=str(order.id),
            ticker=ticker,
            side=side,
            qty=qty,
            status=str(order.status),
            filled_price=float(order.filled_avg_price) if order.filled_avg_price else None,
        )

    async def get_prices(self, tickers: list[str]) -> dict[str, float]:
        """Get latest prices for position sizing."""
        if self._demo:
            import hashlib
            prices = {}
            for t in tickers:
                seed = int(hashlib.md5(t.encode()).hexdigest()[:8], 16)
                prices[t] = 50 + (seed % 400)
            return prices
        try:
            from alpaca.data.requests import StockLatestQuoteRequest
            from alpaca.data.historical import StockHistoricalDataClient
            data_client = StockHistoricalDataClient(
                settings.alpaca_api_key, settings.alpaca_secret_key
            )
            request = StockLatestQuoteRequest(symbol_or_symbols=tickers)
            quotes = data_client.get_stock_latest_quote(request)
            return {
                symbol: float(quote.ask_price or quote.bid_price or 0)
                for symbol, quote in quotes.items()
            }
        except Exception:
            import hashlib
            return {
                t: 50 + (int(hashlib.md5(t.encode()).hexdigest()[:8], 16) % 400)
                for t in tickers
            }
