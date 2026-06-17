FROM node:22-alpine AS frontend

WORKDIR /build
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ .
RUN npm run build

FROM python:3.11-slim

WORKDIR /app

COPY api/requirements.txt .
RUN pip install --no-cache-dir numpy pandas && \
    pip install --no-cache-dir -r requirements.txt

COPY api/ ./api/
COPY alembic.ini ./
COPY --from=frontend /build/dist ./web/dist/

EXPOSE 8000

CMD python -c "
from alembic.config import Config
from alembic import command
try:
    cfg = Config('alembic.ini')
    command.upgrade(cfg, 'head')
    print('[startup] Alembic migrations applied')
except Exception as e:
    print(f'[startup] Alembic skipped ({e}), falling back to create_all')
" && uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1
