import json
import logging
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

correlation_id_context: ContextVar[str] = ContextVar("correlation_id", default="-")


class JsonFormatter(logging.Formatter):
    """Render application diagnostics as one searchable JSON object per line."""

    _standard_fields = set(logging.makeLogRecord({}).__dict__)

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "correlationId": getattr(record, "correlationId", correlation_id_context.get()),
        }
        for key, value in record.__dict__.items():
            if key not in self._standard_fields and key not in payload and key != "message":
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, separators=(",", ":"))


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger("launchpad")
    logger.handlers.clear()
    logger.addHandler(handler)
    logger.setLevel(level.upper())
    logger.propagate = False


def begin_correlation(requested_id: str | None = None) -> tuple[str, object]:
    correlation_id = requested_id or str(uuid4())
    return correlation_id, correlation_id_context.set(correlation_id)


def end_correlation(token: object) -> None:
    correlation_id_context.reset(token)  # type: ignore[arg-type]
