from fastapi import APIRouter

from api.data.registry import DataSource, SourceStatus, get_sources, register_source, update_source_status

router = APIRouter(prefix="/api/data", tags=["data"])


@router.get("/sources")
async def list_sources():
    """List all registered data sources with their status."""
    sources = get_sources()
    return [
        {
            "name": s.name,
            "provider": s.provider,
            "description": s.description,
            "category": s.category,
            "requires_key": s.requires_key,
            "key_env_var": s.key_env_var,
            "status": s.status.value,
            "last_fetch": s.last_fetch.isoformat() if s.last_fetch else None,
            "last_fetch_count": s.last_fetch_count,
            "last_error": s.last_error,
            "config": s.config,
        }
        for s in sources.values()
    ]


@router.post("/sources/{name}/test")
async def test_source(name: str):
    """Test a data source connection."""
    sources = get_sources()
    source = sources.get(name)
    if not source:
        return {"error": f"Unknown source: {name}"}

    if source.name == "yahoo_fundamentals":
        try:
            from api.data.yahoo import YahooProvider
            provider = YahooProvider(demo_mode=False)
            data = await provider.fetch(["AAPL"])
            if data:
                update_source_status(name, SourceStatus.ACTIVE, fetch_count=len(data))
                return {"status": "ok", "tickers_fetched": len(data), "sample": list(data.keys())}
            else:
                update_source_status(name, SourceStatus.ERROR, error="No data returned")
                return {"status": "error", "error": "No data returned (rate limited?)"}
        except Exception as e:
            update_source_status(name, SourceStatus.ERROR, error=str(e))
            return {"status": "error", "error": str(e)}

    if source.requires_key and source.status == SourceStatus.NO_KEY:
        return {"status": "no_key", "message": f"Set {source.key_env_var} in .env to enable"}

    return {"status": source.status.value, "message": "Test not implemented for this source yet"}


@router.post("/sources/add")
async def add_custom_source(body: dict):
    """Register a custom data source."""
    name = body.get("name", "").strip().lower().replace(" ", "_")
    if not name:
        return {"error": "Name is required"}

    register_source(DataSource(
        name=name,
        provider=body.get("provider", "Custom"),
        description=body.get("description", ""),
        category=body.get("category", "custom"),
        requires_key=body.get("requires_key", False),
        key_env_var=body.get("key_env_var", ""),
        status=SourceStatus.PENDING,
        config=body.get("config", {}),
    ))
    return {"status": "ok", "name": name}
