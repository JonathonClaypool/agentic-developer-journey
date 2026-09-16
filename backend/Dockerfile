FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app/backend/src \
    INFRASTRUCTURE_ROOT=/app/catalog/templates/existing-resource-checkout \
    AZURE_CONFIG_DIR=/tmp/.azure \
    TMPDIR=/tmp/launchpad

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates curl \
    && curl -sL https://aka.ms/InstallAzureCLIDeb | bash \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN python -m pip install --upgrade pip \
    && python -m pip install -r backend/requirements.txt

COPY backend/src backend/src
COPY catalog catalog

RUN useradd --create-home --uid 10001 launchpad \
    && mkdir -p /tmp/.azure /tmp/launchpad \
    && chown -R launchpad:launchpad /app /tmp/.azure /tmp/launchpad

USER 10001
EXPOSE 3001

CMD ["python", "-m", "uvicorn", "main:app", "--app-dir", "backend/src", "--host", "0.0.0.0", "--port", "3001"]
