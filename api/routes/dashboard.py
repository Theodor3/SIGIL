from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["dashboard"])


@router.get("/dashboard-data")
async def get_dashboard_data():
    """Main dashboard payload — consumed by the React frontend."""
    from api.signals.registry import get_registry

    signals = get_registry()
    signal_info = [
        {"name": s.name, "version": s.version, "weight": s.default_weight, "description": s.describe()}
        for s in signals.values()
    ]

    return {
        "status": "ok",
        "signals": signal_info,
        "regime": {
            "regime_id": "risk_on",
            "confidence": 0.5,
            "exposure": 0.75,
        },
        "top_ideas": [],
        "portfolio": {
            "holdings_count": 0,
            "total_value": 0,
        },
        "pipeline": {
            "last_run": None,
            "status": "no_runs_yet",
        },
    }


@router.get("/signals")
async def list_signals():
    from api.signals.registry import get_registry

    signals = get_registry()
    return [
        {
            "name": s.name,
            "version": s.version,
            "weight": s.default_weight,
            "description": s.describe(),
        }
        for s in signals.values()
    ]
