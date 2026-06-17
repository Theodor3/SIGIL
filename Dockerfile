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
COPY --from=frontend /build/dist ./web/dist/

EXPOSE 8000

CMD uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1
