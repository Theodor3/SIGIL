#!/bin/sh
python -c "
from alembic.config import Config; from alembic import command
try:
    cfg = Config('alembic.ini'); command.upgrade(cfg, 'head'); print('[startup] Alembic migrations applied')
except Exception as e:
    print(f'[startup] Alembic skipped ({e}), falling back to create_all')
"
exec uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1
