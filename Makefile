.PHONY: setup db seed staff api web test e2e lint eval load licenses

setup:            ## install backend + frontend deps and git hooks
	cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
	cd frontend && npm ci
	pre-commit install

db:               ## apply migrations
	cd backend && .venv/bin/alembic upgrade head

seed:             ## appointment slots (+ demo user if DEMO_USER_EMAIL/PASSWORD set)
	cd backend && .venv/bin/python -m scripts.seed $(if $(DEMO_USER_EMAIL),--demo-user,)

staff:            ## local staff account from STAFF_EMAIL / STAFF_PASSWORD (never on the public demo)
	cd backend && .venv/bin/python -m scripts.create_staff

api:
	cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

web:
	cd frontend && npm run dev

test:             ## backend (pytest, >=80% coverage) + frontend (vitest, >=80% lines)
	cd backend && .venv/bin/pytest
	cd frontend && npm test

e2e:              ## Playwright against the real API + built frontend; needs E2E_DATABASE_URL (an empty database)
	cd frontend && npm run build && npm run e2e

lint:
	cd backend && .venv/bin/ruff check . && .venv/bin/ruff format --check .
	cd frontend && npm run lint && npm run typecheck

eval:             ## OCR golden + holdout, intent coverage, adversarial cases
	cd backend && .venv/bin/python ../eval/run_eval.py

load:             ## k6: 20 VUs for 60s against BASE_URL (default http://localhost:8000)
	k6 run -e BASE_URL=$(or $(BASE_URL),http://localhost:8000) -e INVITE_CODE=$(INVITE_CODE) k6/load.js

licenses:         ## regenerate LICENSES.md
	backend/.venv/bin/python scripts/license_audit.py
