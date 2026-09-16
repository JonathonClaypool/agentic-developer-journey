# Agentic Developer Journey

Two-application monorepo for the AI Launchpad experience.

## Repository layout

- `frontend/` — independently buildable React, TypeScript, and Vite application.
- `backend/src/` — FastAPI application source, with a thin composition root in `main.py`.
- `backend/tests/` — backend tests, separate from production source.
- `catalog/templates/existing-resource-checkout/` — Bicep templates for creating
  workload-scoped child assets in backend-configured platform resources.
- `.runtime/` — ignored local artifact storage used only when the explicit
  filesystem development/test backend is enabled.

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

Update the local environment files with the platform resource profile and the
dedicated package-artifact Blob container. The backend identity must have Blob
data access and the Azure permissions required to run what-if and create the
approved child resources.

## Run

Run the applications in separate terminals:

```bash
cd frontend && npm run dev
cd backend && ../.venv/bin/python -m uvicorn main:app --app-dir src --host 127.0.0.1 --port 3001 --reload
```

The frontend runs on Vite's default port and the API runs at `http://127.0.0.1:3001`.

### Windows local development

Create `backend/.env` from `backend/.env.example`, set
`PACKAGE_ARTIFACT_BACKEND=filesystem`, and keep
`ENABLE_AZURE_DEPLOYMENTS=false`. Then run:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
npm --prefix frontend install
```

Start each service in its own PowerShell terminal:

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --app-dir backend\src --host 127.0.0.1 --port 3001 --reload
npm --prefix frontend run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173`. The local filesystem mode exercises package
generation without Blob credentials. Azure what-if still requires real values in
the backend-owned platform profile; resource creation remains unavailable until
the backend-only deployment switch is deliberately enabled.

The backend uses `catalog/templates/existing-resource-checkout/` as immutable
package templates. It does not scan the Azure subscription for resources: Foundry,
Storage, Cosmos DB, Azure AI Search, and managed identity are supplied by the
backend-owned platform profile. Packages create a Foundry project and model
deployments, a Blob container, and a Cosmos SQL container. The configured Search
index is reused without schema changes.

Generated package source, compiled templates, deployment evidence, and starter-kit
archives are stored in the platform-owned Blob container configured by
`PACKAGE_ARTIFACT_CONTAINER_URL`. Local disk is used only for bounded Bicep
compilation and ZIP assembly. Set `PACKAGE_ARTIFACT_BACKEND=filesystem` only for
local development or tests.

Backend responsibilities are separated into `routers/` (HTTP endpoints), `models/`
(request and response contracts), `services/` (use-case orchestration), `domain/`
(business rules), `connectors/` (Azure and external-system adapters), and `core/`
(configuration and observability). `main.py` only configures middleware and routers.

## Validate

```bash
cd frontend && npm run build && npm run lint && npm test
cd backend && ../.venv/bin/python -m pytest -q
```
