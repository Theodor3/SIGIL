import asyncio
from datetime import datetime

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from api.db.models import Base, PipelineRun, SignalPrediction
from api.pipeline.usage import summarize_usage
from api.routes.pipeline import pipeline_usage


def usage(**tokens):
    return {"provider_usage": {"provider": "anthropic", **tokens}}


def test_complete_response_totals_are_not_a_bill():
    result = summarize_usage([usage(input_tokens=10, output_tokens=3),
                              usage(input_tokens=20, output_tokens=4)])
    assert result["status"] == "reported"
    assert result["tokens"]["input_tokens"]["total"] == 30
    assert result["tokens"]["output_tokens"]["total"] == 7
    assert result["tokens"]["cache_read_input_tokens"]["total"] is None
    assert result["cost_usd"] is None
    assert result["billing_complete"] is False


def test_unknown_record_cannot_be_hidden_by_known_subtotal():
    result = summarize_usage([usage(input_tokens=10, output_tokens=3), {}, None,
                              {"reason": "api_error"}])
    assert result["status"] == "partial"
    count = result["tokens"]["input_tokens"]
    assert count == {"total": None, "reported_subtotal": 10,
                     "reported_records": 1, "unknown_records": 3}


@pytest.mark.parametrize("rows", [[], [{}], [None],
    [{"reason": "no_api_key"}], [{"reason": "not_scored"}]])
def test_absent_accounting_never_claims_zero(rows):
    result = summarize_usage(rows)
    assert result["status"] == "unknown"
    assert result["tokens"]["input_tokens"]["total"] is None
    assert result["tokens"]["input_tokens"]["reported_subtotal"] is None
    assert result["cost_usd"] is None


def test_skipped_and_invalid_response_counts():
    result = summarize_usage([
        {"reason": "not_scored"},
        {"reason": "invalid_response", **usage(input_tokens=8, output_tokens=2)},
    ])
    assert result["saved_records"] == 2
    assert result["not_requested_records"] == 1
    assert result["attempted_or_unknown_records"] == 1
    assert result["tokens"]["input_tokens"]["total"] == 8


@pytest.mark.parametrize("value", [True, -1, 2.2, "4"])
def test_malformed_counter_never_enters_total(value):
    result = summarize_usage([usage(input_tokens=value, output_tokens=0)])
    assert result["tokens"]["input_tokens"]["total"] is None
    assert result["tokens"]["output_tokens"]["total"] == 0


def test_read_only_endpoint_scopes_to_run_and_signal():
    async def check():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            async with async_sessionmaker(engine, expire_on_commit=False)() as db:
                db.add_all([PipelineRun(id=name, started_at=datetime(2026, 1, 1),
                                        status="completed") for name in ["one", "two", "legacy"]])
                for run, signal, ticker, amount in [
                    ("one", "llm_conviction", "AAA", 10),
                    ("two", "llm_conviction", "AAA", 99),
                    ("one", "value", "AAA", 99),
                ]:
                    db.add(SignalPrediction(run_id=run, run_date=datetime(2026, 1, 1).date(),
                        signal_name=signal, ticker=ticker, score=.5, confidence=0,
                        metadata_=usage(input_tokens=amount, output_tokens=2)))
                await db.commit()
                result = await pipeline_usage("one", db)
                assert result["run_status"] == "completed"
                assert result["tokens"]["input_tokens"]["total"] == 10
                assert result["saved_records"] == 1
                assert not db.new and not db.dirty and not db.deleted
                assert (await pipeline_usage("legacy", db))["status"] == "unknown"
                with pytest.raises(HTTPException) as error:
                    await pipeline_usage("missing", db)
                assert error.value.status_code == 404
        finally:
            await engine.dispose()
    asyncio.run(check())


@pytest.mark.parametrize("reason", [[], {}, 4])
def test_malformed_reason_remains_unknown(reason):
    result = summarize_usage([{"reason": reason}])
    assert result["status"] == "unknown"
    assert result["attempted_or_unknown_records"] == 1
