from datetime import datetime, timezone
from swarm import claude_code as cc

def test_renewed_window_is_fixed_and_bounded():
    assert cc.NO_NEW_AFTER == datetime.fromisoformat("2026-10-28T12:20:00-04:00")
    assert cc.STOP_AT == datetime.fromisoformat("2026-10-28T12:25:00-04:00")
    assert 0 < (cc.STOP_AT-cc.NO_NEW_AFTER).total_seconds() <= 300
    assert cc.NO_NEW_AFTER.tzinfo is not None
