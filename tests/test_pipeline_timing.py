import asyncio
import json

import pytest

from api.pipeline.timing import timed_source


def test_timing_preserves_identity_and_reports_safe_metadata(capsys):
    payload = {"private-value": object()}

    async def operation():
        return payload

    assert asyncio.run(timed_source("run", "source", operation())) is payload
    output = capsys.readouterr().out
    record = json.loads(output.split("[pipeline_timing] ")[1])
    assert record["status"] == "ok"
    assert record["result_entries"] == 1
    assert record["seconds"] >= 0
    assert "private-value" not in output


@pytest.mark.parametrize("error", [RuntimeError("secret-url"), asyncio.CancelledError()])
def test_timing_preserves_exceptions_and_cancellation(error, capsys):
    async def operation():
        raise error

    with pytest.raises(type(error)) as raised:
        asyncio.run(timed_source("run", "source", operation()))
    assert raised.value is error
    output = capsys.readouterr().out
    assert "secret-url" not in output
    assert ('"status": "cancelled"' if isinstance(error, asyncio.CancelledError)
            else '"status": "error"') in output


def test_broken_log_sink_does_not_change_result(monkeypatch):
    def broken(*args, **kwargs):
        raise OSError("closed log")

    async def operation():
        return 42

    monkeypatch.setattr("builtins.print", broken)
    assert asyncio.run(timed_source("run", "source", operation())) == 42


def test_timing_keeps_gather_order_and_partial_failures():
    async def check():
        event = asyncio.Event()

        async def slow():
            await event.wait()
            return "first"

        async def fast():
            event.set()
            return "second"

        async def fail():
            raise ValueError("third")

        results = await asyncio.gather(
            timed_source("run", "slow", slow()),
            timed_source("run", "fast", fast()),
            timed_source("run", "fail", fail()), return_exceptions=True)
        assert results[:2] == ["first", "second"]
        assert isinstance(results[2], ValueError)

    asyncio.run(check())
