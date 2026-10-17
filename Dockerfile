# syntax=docker/dockerfile:1
# --- frontend build ---
# Behind a TLS-intercepting proxy, pass its CA without baking it into the image:
#   docker build --secret id=proxy_ca,src=/path/to/ca.crt .
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=secret,id=proxy_ca,required=false \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# --- API + OCR runtime ---
FROM python:3.13-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
# Tesseract (Apache-2.0) runs as a separate process; no GPL code is linked into the app.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Exact versions with hashes: the image gets the same packages CI tested and the licence audit saw.
COPY backend/requirements.lock ./
RUN --mount=type=secret,id=proxy_ca,required=false \
    if [ -f /run/secrets/proxy_ca ]; then export PIP_CERT=/run/secrets/proxy_ca; fi; \
    pip install --require-hashes --no-deps -r requirements.lock
COPY backend/ ./
COPY --from=web /web/dist ./static
# Code stays root-owned and read-only to the app user; it needs no writable paths.
RUN useradd --system --uid 10001 app
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/health')" || exit 1
CMD ["sh", "-c", "alembic upgrade head && python -m scripts.seed ${DEMO_USER_EMAIL:+--demo-user} && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2 --no-access-log"]
