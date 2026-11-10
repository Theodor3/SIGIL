"""Observation-only pipeline timers; never log provider payloads or exceptions."""
from __future__ import annotations

import asyncio
import json
from time import perf_counter


async def timed_source(run_id, source, operation):
    started = perf_counter()
    status = "ok"
    count = None
    try:
        result = await operation
        if isinstance(result, (dict, list, tuple)):
            count = len(result)
        return result
    except asyncio.CancelledError:
        status = "cancelled"
        raise
    except Exception:
        status = "error"
        raise
    finally:
        # Instrumentation must not change a provider's result or error behavior.
        try:
            print("[pipeline_timing] " + json.dumps({
                "run_id": run_id, "source": source, "status": status,
                "seconds": round(perf_counter() - started, 3),
                "result_entries": count,
            }), flush=True)
        except Exception:
            pass
