"""Industry-link cross-predictability — score a name by what its customers just did.

Menzly & Ozbas (2010, JF) show supplier and customer industries predict each other's
returns: value-relevant information diffuses slowly across economic links because
investors specialise by industry, so a shock to an industry's customers shows up in
the supplier's price weeks later. Their weights come from BEA input-output tables,
which is what api/research/bea_io.py loads.

Two reasons this belongs in this book specifically.

Every price-based signal here measures negative at 20d -- technical_breakout -1.54%,
alt_momentum -0.96%, peer_relative -0.64%, momentum_decay barely positive. Own-firm
and own-sector price history does not predict. This is a *different* industry's return
predicting yours through information transfer, which is a different mechanism from
trend-following, not a repackaging of it.

And Menzly & Ozbas find the effect shrinks with analyst coverage and institutional
ownership -- it is an inattention effect, largest where few people are looking. This
universe is small and mid caps with thin coverage.

Deliberate choices:

The self-industry link is dropped and the remaining weights renormalised. BEA records
substantial intra-industry flow (semis sell to semis), and including it would make
part of this signal own-industry momentum -- importing exactly the thing that measures
negative here. What is left is purely cross-industry.

Customer returns come from ETF proxies rather than from this universe. Spread over
~145 vendor industries, 260 names is under two per industry: far too thin to compute
an industry return from. The ETF is a coarse stand-in, and that coarseness is the main
thing likely to dilute the published effect.

Ships at default_weight 0.0. It is computed, recorded and graded from day one, but
contributes nothing to the composite until forward evaluations say it earns weight.
Adding an unproven signal at a real weight is how you find out it does not work by
losing money rather than by measuring.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext

_MATRIX_CACHE_KEY = "industry_link:io_matrix"
_ETF_CACHE_KEY = "industry_link:etf_returns"
# The input-output matrix is a committed annual file; an hour is plenty and keeps a
# long pipeline from re-parsing it on every pass.
_MATRIX_TTL = 3600
_ETF_TTL = 1800

# Horizon for the customer-side return. The diffusion in Menzly & Ozbas plays out over
# roughly a month, and 20d is also where this book's own evaluations concentrate.
_RETURN_KEY = "return_20d"

# Below this share of a group's customer weight priced, the score is not trustworthy
# enough to act on and confidence is zeroed rather than scaled down.
_MIN_COVERAGE = 0.40


def _load_matrix():
    """The BEA customer-weight matrix, cached. None when the table is absent."""
    from api import cache as app_cache

    cached = app_cache.get(_MATRIX_CACHE_KEY)
    if cached is not None:
        return cached or None
    try:
        from api.research import bea_io

        matrix = bea_io.load()
        problems = bea_io.validate(matrix)
        if problems:
            print(f"[industry_link] BEA matrix rejected: {problems}")
            app_cache.set(_MATRIX_CACHE_KEY, False, ttl=_MATRIX_TTL)
            return None
        app_cache.set(_MATRIX_CACHE_KEY, matrix, ttl=_MATRIX_TTL)
        return matrix
    except FileNotFoundError as e:
        print(f"[industry_link] {e}")
    except Exception as e:
        print(f"[industry_link] BEA matrix load failed: {e}")
    app_cache.set(_MATRIX_CACHE_KEY, False, ttl=_MATRIX_TTL)
    return None


async def _etf_returns(etfs: list[str]) -> dict[str, float]:
    """Trailing return per ETF proxy, cached across pipeline passes."""
    from api import cache as app_cache

    cached = app_cache.get(_ETF_CACHE_KEY)
    if cached is not None:
        return cached
    out: dict[str, float] = {}
    try:
        from api.data.yahoo import YahooProvider

        data = await YahooProvider().fetch_prices(sorted(set(etfs)))
        for symbol, md in (data or {}).items():
            value = (md or {}).get(_RETURN_KEY)
            if value is not None:
                out[symbol] = float(value)
    except Exception as e:
        print(f"[industry_link] ETF return fetch failed: {e}")
    app_cache.set(_ETF_CACHE_KEY, out, ttl=_ETF_TTL)
    return out


class IndustryLinkSignal(Signal):
    @property
    def name(self) -> str:
        return "industry_link"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        # Zero until forward evaluations earn it weight — see the module docstring
        return 0.0

    @property
    def category(self) -> str:
        return "alternative"

    @property
    def description(self) -> str:
        return (
            "Input-output cross-predictability — scores a name by the BEA-weighted "
            "trailing return of the industries that buy from it, excluding its own"
        )

    @property
    def tags(self) -> list[str]:
        return ["alternative", "cross-sectional", "input-output", "economic-links"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        from api.research.industry_links import GROUPS_BY_KEY, etf_proxies, group_for

        matrix = _load_matrix()
        if matrix is None:
            # No matrix, no signal. Zero confidence everywhere means scorer.py skips
            # this signal entirely rather than folding in a neutral 0.5.
            return [
                SignalOutput(ticker=t, score=0.5, confidence=0.0,
                             metadata={"reason": "no_io_matrix"})
                for t in ctx.universe
            ]

        scorable = matrix.scorable()
        proxies = etf_proxies()
        returns = await _etf_returns(list(proxies.values()))

        # Raw customer-weighted return per ticker, plus why a ticker got none
        raw: dict[str, float] = {}
        detail: dict[str, dict] = {}

        for ticker in ctx.universe:
            industry = (ctx.fundamentals.get(ticker) or {}).get("industry")
            group = group_for(ticker, industry)
            if not group:
                detail[ticker] = {"reason": "industry_unmapped", "industry": industry}
                continue
            if group not in scorable:
                detail[ticker] = {
                    "reason": "group_not_scorable",
                    "group": group,
                    "why": matrix.degenerate_groups.get(group, "unknown"),
                }
                continue

            # Drop the self-link and renormalise: what remains is purely the
            # cross-industry signal, not own-industry momentum wearing a hat.
            customers = {
                c: w for c, w in matrix.customer_weights[group].items() if c != group
            }
            total = sum(customers.values())
            if total <= 0:
                detail[ticker] = {"reason": "self_link_only", "group": group}
                continue

            weighted = 0.0
            priced = 0.0
            for customer, weight in customers.items():
                etf = proxies.get(customer)
                ret = returns.get(etf) if etf else None
                if ret is None:
                    continue
                share = weight / total
                weighted += ret * share
                priced += share

            if priced < _MIN_COVERAGE:
                detail[ticker] = {
                    "reason": "customer_coverage_too_thin",
                    "group": group,
                    "coverage": round(priced, 3),
                }
                continue

            # Rescale to the priced portion so a partly-covered distribution is not
            # dragged toward zero by the customers we could not price
            raw[ticker] = weighted / priced
            detail[ticker] = {
                "group": group,
                "group_label": GROUPS_BY_KEY[group].label,
                "customer_return_20d": round(raw[ticker], 5),
                "coverage": round(priced, 3),
                "top_customers": [
                    {"group": c, "weight": round(w / total, 3),
                     "etf": proxies.get(c), "ret_20d": returns.get(proxies.get(c))}
                    for c, w in sorted(customers.items(), key=lambda kv: -kv[1])[:3]
                ],
            }

        # Cross-sectional percentile: the level of a customer-industry return means
        # little on its own, the ranking against other names is the signal. Matches
        # how peer_relative scores.
        values = sorted(raw.values())
        outputs: list[SignalOutput] = []
        for ticker in ctx.universe:
            if ticker not in raw:
                outputs.append(SignalOutput(
                    ticker=ticker, score=0.5, confidence=0.0,
                    metadata=detail.get(ticker, {"reason": "unknown"}),
                ))
                continue
            if len(values) < 5:
                # Too few mapped names for a percentile to mean anything
                outputs.append(SignalOutput(
                    ticker=ticker, score=0.5, confidence=0.0,
                    metadata={**detail[ticker], "reason": "too_few_mapped",
                              "mapped": len(values)},
                ))
                continue
            below = sum(1 for v in values if v < raw[ticker])
            score = below / len(values)
            meta = detail[ticker]
            outputs.append(SignalOutput(
                ticker=ticker,
                score=round(score, 4),
                # Coverage carries into confidence: a name whose customer mix is only
                # half priced is a weaker read than one fully priced.
                confidence=round(0.55 + 0.35 * meta.get("coverage", 0.0), 4),
                metadata={**meta, "mapped_universe": len(values)},
            ))
        return outputs
