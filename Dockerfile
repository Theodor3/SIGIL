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
COPY start.sh ./
COPY --from=frontend /build/dist ./web/dist/

RUN chmod +x start.sh

EXPOSE 8000

CMD ["./start.sh"]
