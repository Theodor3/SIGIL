import pytest
from datetime import date, timedelta
from api.data.edgar import EdgarProvider

TODAY = date(2026, 9, 28)

@pytest.mark.parametrize("form", ["NT 10-K", "NT 10-Q"])
@pytest.mark.parametrize("age", [-1, 0, 120, 121])
def test_nt_filings(form, age):
    filed = TODAY - timedelta(days=age)
    recent = {
        "form": [form],
        "filingDate": [filed.isoformat()],
        "items": [""]
    }
    result = EdgarProvider._scan_filings(recent, TODAY)
    expected = {"nt_filings": [], "auditor_changes": [], "restatements": []}
    if 0 <= age <= 120:
        expected["nt_filings"].append({"form": form, "date": filed.isoformat()})
    assert result == expected

@pytest.mark.parametrize("item_val,key", [("4.01", "auditor_changes"), ("4.02", "restatements")])
@pytest.mark.parametrize("age", [-1, 0, 180, 181])
def test_8k_filings(item_val, key, age):
    filed = TODAY - timedelta(days=age)
    recent = {
        "form": ["8-K"],
        "filingDate": [filed.isoformat()],
        "items": [item_val]
    }
    result = EdgarProvider._scan_filings(recent, TODAY)
    expected = {"nt_filings": [], "auditor_changes": [], "restatements": []}
    if 0 <= age <= 180:
        expected[key].append({"form": "8-K", "date": filed.isoformat()})
    assert result == expected

@pytest.mark.parametrize("invalid_date", [None, "not-a-date", "2026-02-30"])
def test_invalid_dates(invalid_date):
    recent = {
        "form": ["8-K"],
        "filingDate": [invalid_date] if invalid_date is not None else [None],
        "items": ["4.02"]
    }
    result = EdgarProvider._scan_filings(recent, TODAY)
    expected = {"nt_filings": [], "auditor_changes": [], "restatements": []}
    assert result == expected

def test_simultaneous_items():
    filed = TODAY - timedelta(days=5)
    recent = {
        "form": ["8-K"],
        "filingDate": [filed.isoformat()],
        "items": ["4.01, 4.02"]
    }
    result = EdgarProvider._scan_filings(recent, TODAY)
    expected = {"nt_filings": [], "auditor_changes": [], "restatements": [{"form": "8-K", "date": filed.isoformat()}]}
    assert result == expected
