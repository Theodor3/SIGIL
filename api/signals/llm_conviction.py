"""LLM conviction signal — Claude Haiku synthesizes multi-source data into a conviction score."""
from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING

from api.config.settings import settings
from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext

MAX_TICKERS = 30
MODEL = "claude-haiku-4-5-20251001"

SYSTEM_PROMPT = """You are a quantitative equity analyst. Given data about a stock, output a JSON object with:
- "score": float 0.0-1.0 (0=strong sell, 0.5=neutral, 1=strong buy)
- "confidence": float 0.0-1.0 (how confident you are in the score)
- "reasoning": string (1 sentence max)

Consider: earnings momentum, valuation relative to quality, insider activity direction, analyst sentiment shifts, and any red flags. Be contrarian when sentiment is extreme. Weight recent earnings surprises heavily — consistent positive surprises with analyst upgrades is the strongest signal.

Respond with ONLY the JSON object, no other text."""


def _build_ticker_prompt(ticker: str, ctx: PipelineContext) -> str | None:
    """Build a data summary for one ticker. Returns None if insufficient data."""
    f = ctx.fundamentals.get(ticker, {})
    if not f:
        return None

    parts = [f"Ticker: {ticker} | Sector: {f.get('sector', '?')} | Date: {ctx.as_of_date}"]

    # Fundamentals
    fund_items = []
    for key, label in [
        ("trailing_pe", "P/E"), ("ev_to_ebitda", "EV/EBITDA"),
        ("price_to_sales", "P/S"), ("roic", "ROIC"),
        ("fcf_margin", "FCF Margin"), ("debt_to_ebitda", "Debt/EBITDA"),
        ("revenue_cagr_3y", "Rev Growth"), ("roe", "ROE"),
    ]:
        v = f.get(key)
        if v is not None and v != 0:
            fund_items.append(f"{label}: {v:.2f}" if isinstance(v, float) else f"{label}: {v}")
    if fund_items:
        parts.append("Fundamentals: " + ", ".join(fund_items))

    # Market data
    md = ctx.market_data.get(ticker, {})
    if md.get("close"):
        closes = md.get("closes", [])
        price_str = f"Price: ${md['close']:.2f}"
        if len(closes) >= 20:
            ret_20d = (closes[-1] - closes[-20]) / closes[-20]
            price_str += f", 20d return: {ret_20d:+.1%}"
        if len(closes) >= 60:
            ret_60d = (closes[-1] - closes[-60]) / closes[-60]
            price_str += f", 60d return: {ret_60d:+.1%}"
        parts.append(price_str)

    # Earnings
    history = ctx.earnings_history.get(ticker, [])
    if history:
        surprises = [h.get("surprise_pct", 0) for h in history[:4]]
        parts.append(f"Last {len(surprises)} earnings surprises (%): {surprises}")

    next_earn = ctx.earnings_calendar.get(ticker)
    if next_earn:
        days = (next_earn - ctx.as_of_date).days
        if days >= 0:
            parts.append(f"Next earnings in {days} days")

    # Analyst estimates
    analyst = ctx.analyst_estimates.get(ticker, {})
    if analyst:
        buy = analyst.get("buy", 0) + analyst.get("strong_buy", 0)
        sell = analyst.get("sell", 0) + analyst.get("strong_sell", 0)
        hold = analyst.get("hold", 0)
        total = buy + sell + hold
        if total > 0:
            prev_buy = analyst.get("prev_buy", 0)
            direction = "up" if buy > prev_buy else ("down" if buy < prev_buy else "flat")
            parts.append(f"Analysts: {buy}buy/{hold}hold/{sell}sell (trend {direction})")

    # Insider transactions
    insider = ctx.insider_transactions.get(ticker, [])
    if insider:
        buys = sum(1 for t in insider if t.get("change", 0) > 0)
        sells = len(insider) - buys
        parts.append(f"Insider activity (recent): {buys} buys, {sells} sells")

    # Nowcast (Wikipedia + GDELT alt data)
    nc = ctx.nowcast.get(ticker, {})
    if nc:
        nc_items = []
        if nc.get("deviation"):
            nc_items.append(f"attention deviation: {nc['deviation']:+.1%}")
        if nc.get("news_tone_shift"):
            nc_items.append(f"news tone shift: {nc['news_tone_shift']:+.2f}")
        if nc_items:
            parts.append("Alt data: " + ", ".join(nc_items))

    if len(parts) < 3:
        return None

    return "\n".join(parts)


class LLMConvictionSignal(Signal):
    @property
    def name(self) -> str:
        return "llm_conviction"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.12

    @property
    def category(self) -> str:
        return "composite"

    @property
    def description(self) -> str:
        return "Claude Haiku synthesizes fundamentals, earnings, insider activity, and alt data into a conviction score"

    @property
    def tags(self) -> list[str]:
        return ["llm", "composite", "multi-factor"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        if not settings.anthropic_api_key:
            return [SignalOutput(t, 0.0, 0.0, {"reason": "no_api_key"}) for t in ctx.universe]

        try:
            import anthropic
        except ImportError:
            return [SignalOutput(t, 0.0, 0.0, {"reason": "anthropic_not_installed"}) for t in ctx.universe]

        # Build prompts for tickers that have enough data
        ticker_prompts: list[tuple[str, str]] = []
        for ticker in ctx.universe:
            prompt = _build_ticker_prompt(ticker, ctx)
            if prompt:
                ticker_prompts.append((ticker, prompt))

        # Only score top N tickers to manage API costs
        tickers_to_score = ticker_prompts[:MAX_TICKERS]
        scored_tickers: set[str] = set()
        results: dict[str, SignalOutput] = {}

        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

        # Batch in groups of 5 concurrent requests
        for i in range(0, len(tickers_to_score), 5):
            batch = tickers_to_score[i:i + 5]
            tasks = [
                self._score_ticker(client, ticker, prompt)
                for ticker, prompt in batch
            ]
            batch_results = await asyncio.gather(*tasks, return_exceptions=True)
            for (ticker, _), result in zip(batch, batch_results):
                if isinstance(result, Exception):
                    print(f"[llm_conviction] {ticker} failed: {result}")
                    results[ticker] = SignalOutput(ticker, 0.0, 0.0, {"reason": "api_error"})
                else:
                    results[ticker] = result
                scored_tickers.add(ticker)

        # Fill in unscored tickers with neutral
        output = []
        for ticker in ctx.universe:
            if ticker in results:
                output.append(results[ticker])
            else:
                output.append(SignalOutput(ticker, 0.0, 0.0, {"reason": "not_scored"}))

        scored_count = sum(1 for o in output if o.score > 0)
        print(f"[llm_conviction] Scored {len(scored_tickers)} tickers, {scored_count} non-zero")
        return output

    async def _score_ticker(
        self, client, ticker: str, prompt: str
    ) -> SignalOutput:
        resp = await client.messages.create(
            model=MODEL,
            max_tokens=150,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )

        text = resp.content[0].text.strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

        data = json.loads(text)
        score = max(0.0, min(1.0, float(data["score"])))
        confidence = max(0.0, min(1.0, float(data["confidence"])))
        reasoning = data.get("reasoning", "")

        return SignalOutput(
            ticker=ticker,
            score=score,
            confidence=confidence,
            metadata={
                "reasoning": reasoning,
                "model": MODEL,
                "raw_score": data["score"],
            },
        )
