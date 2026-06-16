from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import get_db
from api.pipeline.runner import run_pipeline

router = APIRouter(prefix="/api", tags=["pipeline"])


@router.post("/pipeline/run")
async def trigger_pipeline(db: AsyncSession = Depends(get_db)):
    """Trigger a full pipeline run."""
    result = await run_pipeline(db)
    return result
