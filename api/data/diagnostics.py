"""Safe provider outcome logs; never include response bodies or exception messages."""
import json


def provider_outcome(source, ticker, outcome, *, status=None):
    try:
        print("[provider_outcome] " + json.dumps({
            "source": source, "ticker": ticker, "outcome": outcome,
            "http_status": status,
        }), flush=True)
    except Exception:
        # Observability must never change provider results.
        pass
