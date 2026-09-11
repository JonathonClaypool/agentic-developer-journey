# Agentic Developer Journey

Two-application monorepo for the AI Launchpad experience.

## Repository layout

- `frontend/` — independently buildable React, TypeScript, and Vite application.
- `backend/src/` — FastAPI application source, with a thin composition root in `main.py`.
- `backend/tests/` — backend tests, separate from production source.
- `infra/` — source-controlled Azure Bicep deployment templates.
- `.runtime/` — ignored local runtime data, including generated deployment packages.

Build output (`dist/`), caches, dependencies, local environment files, and generated
packages are disposable artifacts and are excluded from source control.

## Setup

Requirements: Node.js with npm and Python 3.

```bash
cd frontend
npm install
cd ..
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r backend/requirements.txt
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env
```

Update the local environment files with the required Azure settings.

## Run

Run the applications in separate terminals:

```bash
cd frontend && npm run dev
cd backend && ../.venv/bin/python -m uvicorn main:app --app-dir src --host 127.0.0.1 --port 3001 --reload
```

The frontend runs on Vite's default port and the API runs at `http://127.0.0.1:3001`.

The backend uses `infra/` as immutable package templates and writes
generated files to `.runtime/generated-packages/`. Deployments can override these
locations with `INFRASTRUCTURE_ROOT` and `APP_DATA_ROOT`.

Backend responsibilities are separated into `routers/` (HTTP endpoints), `models/`
(request and response contracts), `services/` (use-case orchestration), `domain/`
(business rules), `connectors/` (Azure and external-system adapters), and `core/`
(configuration and observability). `main.py` only configures middleware and routers.

## Validate

```bash
cd frontend && npm run build && npm run lint && npm test
cd backend && ../.venv/bin/python -m pytest -q
```
