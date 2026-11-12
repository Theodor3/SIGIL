"""Offline forecast diagnostics. No downloads, broker access, or model fitting.

Caller must freeze the candidate and holdout boundary before seeing outcomes.
This validates record consistency, not the truth of supplied provenance.
"""
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
import math


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError("timestamp must include timezone")
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("timestamp must include timezone")
    return result.astimezone(timezone.utc)


def screen(rows, *, candidate, frozen_at, holdout_at, horizon_days=20, purge_days=20, costs_bps=(10, 25, 50)):
    """Assess one preregistered candidate with date-equal-weight summaries.

    Required evidence: immutable candidate/version ID, original source receipt,
    recorded availability, actual stock/SPY entry and exit timestamps, returns,
    direction (+1/-1). Same-ticker overlapping windows are excluded globally,
    so dense daily reruns cannot inflate the number of retained forecasts.
    No annualized Sharpe, significance claim, or automatic acceptance is emitted.
    """
    if not isinstance(candidate, str) or not candidate.strip():
        raise ValueError("candidate must identify a frozen signal/version")
    split = timestamp(holdout_at)
    frozen = timestamp(frozen_at)
    if frozen >= split:
        raise ValueError("candidate must be frozen before holdout")
    if type(horizon_days) is not int or horizon_days <= 0:
        raise ValueError("horizon_days must be a positive integer")
    if type(purge_days) is not int or purge_days < 0:
        raise ValueError("purge_days must be a nonnegative integer")
    costs = tuple(costs_bps)
    if not costs or any(type(c) not in (int, float) or not math.isfinite(c) or c < 0 for c in costs):
        raise ValueError("costs must be finite nonnegative bps")
    rejected = Counter()
    valid = []
    rows = list(rows)
    ids = Counter(row.get("forecast_id") for row in rows if isinstance(row, dict) and isinstance(row.get("forecast_id"), str))
    total_input = len(rows)
    for row in rows:
        try:
            if row["candidate"] != candidate:
                rejected["other_candidate"] += 1
                continue
            if not all(isinstance(row[k], str) and row[k].strip() for k in ("ticker", "receipt", "forecast_id")):
                raise ValueError("missing identity/evidence")
            if ids[row["forecast_id"]] > 1:
                rejected["duplicate_id_all_rows"] += 1
                continue
            available, entry, exit_ = (timestamp(row[k]) for k in ("available_at", "entry_at", "exit_at"))
            created = timestamp(row["forecast_created_at"])
            if not available <= created < entry < exit_ or (entry >= split and created < frozen):
                raise ValueError("source and forecast must precede entry")
            if (exit_.date() - entry.date()).days != horizon_days:
                raise ValueError("holding horizon mismatch")
            if timestamp(row["benchmark_entry_at"]) != entry or timestamp(row["benchmark_exit_at"]) != exit_:
                raise ValueError("benchmark dates mismatch")
            if type(row["direction"]) is not int or row["direction"] not in (-1, 1):
                raise ValueError("direction must be +1/-1")
            if any(type(row[k]) not in (int, float) or not math.isfinite(row[k]) or row[k] < -1
                   for k in ("stock_return", "benchmark_return")):
                raise ValueError("invalid simple returns")
            # Purge all pre-holdout labels reaching the boundary and embargo
            # the chosen number of calendar days on the training side.
            if entry < split and exit_ >= split - timedelta(days=purge_days):
                rejected["purged_boundary"] += 1
                continue
            valid.append((entry, exit_, row))
        except (KeyError, ValueError, TypeError, OverflowError):
            rejected["invalid_or_duplicate"] += 1
    valid.sort(key=lambda x: (x[0], x[2]["ticker"], x[2]["forecast_id"]))
    last_exit = {}
    periods = {"development": [], "holdout": []}
    for entry, exit_, row in valid:
        ticker = row["ticker"].strip().upper()
        if ticker in last_exit and entry <= last_exit[ticker]:
            rejected["overlapping_ticker"] += 1
            continue
        last_exit[ticker] = exit_
        alpha = row["direction"] * (row["stock_return"] - row["benchmark_return"])
        periods["holdout" if entry >= split else "development"].append((entry.date().isoformat(), alpha, row["direction"]))

    def summarize(records):
        dates = defaultdict(list)
        for day, alpha, _ in records:
            dates[day].append(alpha)
        daily = [math.fsum(value / len(values) for value in values) for values in dates.values()]
        mean = math.fsum(value / len(daily) for value in daily) if daily else None
        return {
            "forecasts": len(records), "entry_dates": len(dates),
            "longs": sum(direction == 1 for _, _, direction in records),
            "shorts": sum(direction == -1 for _, _, direction in records),
            "date_equal_weight_gross_alpha": mean,
            "date_equal_weight_net_alpha": {str(cost): mean - cost / 10000 if mean is not None else None for cost in costs},
            "positive_date_fraction": sum(a > 0 for a in daily) / len(daily) if daily else None,
            "worst_date_alpha": min(daily) if daily else None,
        }
    return {
        "candidate": candidate, "frozen_at": frozen.isoformat(), "holdout_at": split.isoformat(), "horizon_calendar_days": horizon_days, "purge_calendar_days": purge_days, "input_rows": total_input,
        "excluded": dict(rejected), "periods": {key: summarize(value) for key, value in periods.items()},
        "accepted_as_alpha": False,
        "limits": ["Supplied timestamps/receipts require independent source verification.",
                   "Holdout is out-of-sample only if candidate/boundary were frozen before outcomes were inspected.",
                   "Equal-weight forecast diagnostics are not portfolio returns; dates can remain dependent.",
                   "Costs are assumed, not measured fills; borrow, capacity and delisting coverage need separate evidence.",
                   "Strict calendar-date horizon requires matching observed sessions; mismatched windows are excluded, not shifted.",
                   "No multiple-testing correction or confidence interval; positive means do not establish an edge."],
    }


