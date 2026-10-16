.PHONY: setup db seed api web test lint eval load licenses

setup:            ## install backend + frontend deps and git hooks
	cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
	cd frontend && npm ci
	pre-commit install

db:               ## apply migrations
	cd backend && .venv/bin/alembic upgrade head

seed:             ## appointment slots (+ demo user if DEMO_USER_EMAIL/PASSWORD set)
	cd backend && .venv/bin/python -m scripts.seed $(if $(DEMO_USER_EMAIL),--demo-user,)

api:
	cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

web:
	cd frontend && npm run dev

test:             ## backend (pytest, >=80% coverage) + frontend (jest, >=80% lines)
	cd backend && .venv/bin/pytest
	cd frontend && npm test

lint:
	cd backend && .venv/bin/ruff check . && .venv/bin/ruff format --check .
	cd frontend && npm run lint && npm run typecheck

eval:             ## OCR golden + holdout, intent coverage, adversarial cases
	cd backend && .venv/bin/python ../eval/run_eval.py

load:             ## k6: 20 VUs for 60s against BASE_URL (default http://localhost:8000)
	k6 run -e BASE_URL=$(or $(BASE_URL),http://localhost:8000) -e INVITE_CODE=$(INVITE_CODE) k6/load.js

licenses:         ## regenerate LICENSES.md
	./scripts/license_audit.sh
