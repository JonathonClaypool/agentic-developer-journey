import logging
import os
import time
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from core.observability import begin_correlation, configure_logging, end_correlation
from core.settings import FRONTEND_ORIGIN
from routers import architecture, catalog, deployments, governance, health, packages, regions

configure_logging(os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("launchpad.api")

app = FastAPI(title="AI Launchpad Deployment API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)

for router in (
    health.router,
    architecture.router,
    governance.router,
    catalog.router,
    packages.router,
    regions.router,
    deployments.router,
):
    app.include_router(router)


@app.middleware("http")
async def request_diagnostics(request: Request, call_next):
    correlation_id, token = begin_correlation(request.headers.get("X-Correlation-ID"))
    started = time.perf_counter()
    logger.info("api.request.started", extra={"method": request.method, "path": request.url.path})
    try:
        response = await call_next(request)
        response.headers["X-Correlation-ID"] = correlation_id
        logger.info(
            "api.request.completed",
            extra={
                "method": request.method,
                "path": request.url.path,
                "statusCode": response.status_code,
                "elapsedSeconds": round(time.perf_counter() - started, 3),
            },
        )
        return response
    except Exception:
        logger.exception("api.request.failed", extra={"method": request.method, "path": request.url.path})
        raise
    finally:
        end_correlation(token)
