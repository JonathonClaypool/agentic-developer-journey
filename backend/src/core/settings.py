import os

DEPLOYMENTS_ENABLED = os.getenv("ENABLE_AZURE_DEPLOYMENTS", "false").lower() == "true"
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://127.0.0.1:5173")
