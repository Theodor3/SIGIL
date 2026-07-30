"""Alpha decay curves from the forward-evaluation record.

Cumulative alpha always grows with horizon, which tells you nothing on its own.
What matters is the *shape*: a signal whose alpha nearly doubles from 5d to 20d has
front-loaded information and wants a short hold, while one that quadruples is still
accruing and wants a long one. This module turns the per-horizon grades the
evaluator already produces into a half-life per signal.

Model: a(t) = A * (1 - exp(-t / tau))

  A    total alpha the signal eventually delivers
  tau  time constant; half-life = tau * ln(2)

Under this model a(20)/a(5) approaches 4.0 as tau grows (alpha accruing linearly,
no decay yet) and falls toward 1.0 as tau shrinks (everything already realised by
day 5). A ratio at or above 4.0 cannot be represented at all -- the signal is
accelerating, meaning its peak lies beyond the measurement window. That is reported
as such rather than fitted, because forcing a tau there would invent a number.

Three honesty guards, because the current record supports far less than it looks
like it does:

  - Horizons below MIN_SAMPLE are ignored. A handful of grades can produce any
    shape at all.
  - With two usable horizons the fit is *exactly determined*: two parameters, two
    observations, zero residual, nothing to validate against. `exactly_determined`
    says so. Only the 60d horizon makes the fit testable, and that horizon cannot
    grade anything until the prediction record is 60 days deep.
  - `extrapolation_ratio` is tau divided by the longest horizon observed. A tau of
    138 days fitted from data at 5 and 20 days is a 7x reach past the evidence; the
    bucket ("slow") is trustworthy, the number is not.
"""
from __future__ import annotations

import math

# Minimum graded predictions at a horizon before it is used in a fit
MIN_SAMPLE = 2_000

# a(t_long)/a(t_short) under linear accumulation, i.e. the no-decay limit
def _linear_ratio(t_short: float, t_long: float) -> float:
    return t_long / t_short


# tau search bounds, in days
_TAU_MIN = 0.25
_TAU_MAX = 2_000.0

# Bucket edges on half-life, in days
_FAST_BELOW = 10.0
_SLOW_ABOVE = 30.0


def _saturation(t: float, tau: float) -> float:
    return 1.0 - math.exp(-t / tau)


def _fit_tau(points: list[tuple[float, float]]) -> tuple[float, float, float]:
    """Least-squares fit of (tau, A) to (horizon, cumulative_alpha) points.

    For any candidate tau, the best A is linear least squares, so only tau needs
    searching. Returns (tau, A, sum_squared_residual).
    """
    best = (_TAU_MAX, 0.0, float("inf"))
    # Geometric sweep then local refinement -- the objective is smooth in log(tau)
    lo, hi = math.log(_TAU_MIN), math.log(_TAU_MAX)
    for _ in range(4):
        step = (hi - lo) / 80.0
        for i in range(81):
            tau = math.exp(lo + i * step)
            gs = [_saturation(t, tau) for t, _ in points]
            denom = sum(g * g for g in gs)
            if denom <= 0:
                continue
            a_hat = sum(g * a for g, (_, a) in zip(gs, points)) / denom
            ssr = sum((a - a_hat * g) ** 2 for g, (_, a) in zip(gs, points))
            if ssr < best[2]:
                best = (tau, a_hat, ssr)
        centre = math.log(best[0])
        lo, hi = max(centre - step * 2, math.log(_TAU_MIN)), min(
            centre + step * 2, math.log(_TAU_MAX)
        )
    return best


def _bucket(half_life: float) -> str:
    if half_life < _FAST_BELOW:
        return "fast"
    if half_life > _SLOW_ABOVE:
        return "slow"
    return "medium"


def fit_signal_decay(horizon_stats: dict) -> dict:
    """Decay characteristics for one signal.

    `horizon_stats` is the per-signal mapping the evaluator already builds:
    {"5d": {"n": int, "hit_rate": float, "avg_alpha": float}, "20d": {...}, ...}
    avg_alpha is a fraction (0.0219 == 2.19%).
    """
    usable: list[tuple[float, float]] = []
    skipped_thin: list[str] = []
    for key, stats in (horizon_stats or {}).items():
        if not isinstance(stats, dict) or not key.endswith("d"):
            continue
        try:
            days = float(key[:-1])
        except ValueError:
            continue
        n = stats.get("n") or 0
        alpha = stats.get("avg_alpha")
        if alpha is None:
            continue
        if n < MIN_SAMPLE:
            skipped_thin.append(key)
            continue
        usable.append((days, float(alpha)))

    out: dict = {
        "half_life_days": None,
        "tau_days": None,
        "asymptote_alpha_pct": None,
        "classification": "insufficient_data",
        "horizons_used": [f"{int(t)}d" for t, _ in sorted(usable)],
        "horizons_skipped_thin": sorted(skipped_thin),
        "exactly_determined": None,
        "extrapolation_ratio": None,
        "min_sample": MIN_SAMPLE,
    }
    if len(usable) < 2:
        return out

    usable.sort()
    (t_short, a_short), (t_long, a_long) = usable[0], usable[-1]

    # Decay is only meaningful for a signal that earns something. Fitting a curve
    # to a signal whose alpha is negative describes how fast it loses money, which
    # is not what this is for.
    if a_long <= 0 or a_short <= 0:
        out["classification"] = "negative_alpha"
        return out

    ratio = a_long / a_short
    out["alpha_ratio"] = round(ratio, 3)
    out["linear_ratio"] = round(_linear_ratio(t_short, t_long), 3)

    # At or above linear accumulation the saturating model has no solution: the
    # signal has not peaked inside the window.
    if ratio >= out["linear_ratio"] - 1e-9:
        out["classification"] = "accelerating"
        out["exactly_determined"] = len(usable) <= 2
        return out

    tau, a_total, ssr = _fit_tau(usable)
    half_life = tau * math.log(2)

    out.update({
        "half_life_days": round(half_life, 1),
        "tau_days": round(tau, 1),
        "asymptote_alpha_pct": round(a_total * 100, 3),
        "classification": _bucket(half_life),
        # Two parameters fitted to two points: no degrees of freedom left
        "exactly_determined": len(usable) <= 2,
        "extrapolation_ratio": round(tau / t_long, 2),
        "residual": round(ssr, 12),
    })
    return out


def fit_all(stats: dict) -> dict:
    """Apply fit_signal_decay across the get_signal_stats() mapping.

    Returns {signal_name: decay_dict}. Non-dict entries and the bookkeeping keys the
    evaluator adds (current_version, prior_versions) are ignored.
    """
    out = {}
    for name, entry in (stats or {}).items():
        if not isinstance(entry, dict):
            continue
        horizons = {
            k: v for k, v in entry.items()
            if k.endswith("d") and isinstance(v, dict)
        }
        out[name] = fit_signal_decay(horizons)
    return out
