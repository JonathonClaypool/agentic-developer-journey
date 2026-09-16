FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app/backend/src \
    INFRASTRUCTURE_ROOT=/app/catalog/templates/existing-resource-checkout \
    AZURE_CONFIG_DIR=/tmp/.azure \
    AZURE_BICEP_USE_BINARY_FROM_PATH=true \
    DOTNET_BUNDLE_EXTRACT_BASE_DIR=/tmp/.dotnet \
    DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 \
    HOME=/tmp \
    TMPDIR=/tmp/launchpad

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates curl \
    && curl -sL https://aka.ms/InstallAzureCLIDeb | bash \
    && AZURE_BICEP_USE_BINARY_FROM_PATH=false AZURE_CONFIG_DIR=/tmp/azure-cli-build az bicep install \
    && install -m 0755 /tmp/azure-cli-build/bin/bicep /usr/local/bin/bicep \
    && rm -rf /tmp/azure-cli-build \
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
