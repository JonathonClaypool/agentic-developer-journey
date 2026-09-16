import os
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
INFRASTRUCTURE_ROOT = Path(
    os.getenv(
        "INFRASTRUCTURE_ROOT",
        REPOSITORY_ROOT / "catalog" / "templates" / "existing-resource-checkout",
    )
).resolve()
APP_DATA_ROOT = Path(
    os.getenv("APP_DATA_ROOT", REPOSITORY_ROOT / ".runtime")
).resolve()
GENERATED_PACKAGES_ROOT = APP_DATA_ROOT / "generated-packages"
PACKAGE_ARTIFACT_BACKEND = os.getenv("PACKAGE_ARTIFACT_BACKEND", "blob")
PACKAGE_ARTIFACT_CONTAINER_URL = os.getenv("PACKAGE_ARTIFACT_CONTAINER_URL", "")
