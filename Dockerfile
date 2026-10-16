# --- frontend build ---
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
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
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt
COPY backend/ ./
COPY --from=web /web/dist ./static
RUN useradd --system --uid 10001 app && chown -R app /app
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/health')" || exit 1
CMD ["sh", "-c", "alembic upgrade head && python -m scripts.seed ${DEMO_USER_EMAIL:+--demo-user} && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2 --no-access-log"]
