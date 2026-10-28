import importlib.util
import json
from pathlib import Path
import sqlite3
import hashlib
import pytest

spec = importlib.util.spec_from_file_location("exporter", Path(__file__).with_name("export_forecasts.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture(path):
    conn = sqlite3.connect(path)
    conn.executescript("""
      CREATE TABLE pipeline_runs (id TEXT,started_at TEXT,finished_at TEXT,status TEXT);
      CREATE TABLE signal_predictions (id INTEGER,run_id TEXT,run_date TEXT,signal_name TEXT,signal_version TEXT,ticker TEXT,score REAL,confidence REAL,metadata TEXT);
      CREATE TABLE signal_evaluations (id INTEGER,prediction_id INTEGER,horizon_days INTEGER,actual_return REAL,signal_correct INTEGER,alpha_vs_benchmark REAL,evaluated_at TEXT);
      CREATE TABLE trades (secret TEXT);
      INSERT INTO trades VALUES ('never-export-account-data');
      INSERT INTO pipeline_runs VALUES ('r','2026-01-01 12:00:00','2026-01-01 13:00:00','completed');
      INSERT INTO signal_predictions VALUES (1,'r','2026-01-01','value','1.0','AAA',0.8,0.9,'{}');
      INSERT INTO signal_predictions VALUES (2,'missing','2026-01-01','value','1.0','BBB',0.8,0.9,'{}');
      INSERT INTO signal_evaluations VALUES (1,999,20,NULL,NULL,NULL,'2026-02-01 00:00:00');
    """)
    conn.close()


def test_readonly_export_preserves_raw_records_and_excludes_account_tables(tmp_path):
    source=tmp_path/'input.sqlite'; fixture(source)
    before=source.read_bytes()
    result=module.export_forecasts(source,tmp_path/'output')
    data=Path(result['file']).read_bytes(); payload=json.loads(data)
    assert hashlib.sha256(data).hexdigest()==result['sha256']
    assert source.read_bytes()==before
    assert b'never-export-account-data' not in data
    assert payload['tables']['pipeline_runs'][0]['finished_at']=='2026-01-01 13:00:00'
    assert payload['coverage']['orphan_predictions']==1
    assert payload['coverage']['orphan_evaluations']==1
    assert payload['point_in_time_eligible'] is False


def test_size_bounds_fail_without_output(tmp_path):
    source=tmp_path/'input.sqlite'; fixture(source)
    for options in ({'max_rows':1},{'max_bytes':1}):
        with pytest.raises(ValueError,match='bound exceeded'):
            module.export_forecasts(source,tmp_path/'output',**options)
        assert not (tmp_path/'output').exists()


def test_missing_database_is_not_created(tmp_path):
    source=tmp_path/'missing.sqlite'
    with pytest.raises(ValueError): module.export_forecasts(source,tmp_path/'output')
    assert not source.exists()
