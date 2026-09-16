from fastapi import APIRouter, HTTPException, status
from fastapi.responses import Response

from models.schemas import AgentStarterKitRequest, ArchitecturePackageRequest
from services.agent_starter_generator import create_agent_starter_kit, get_agent_starter_archive
from services.package_generator import PackageError, create_package, get_package

router = APIRouter(prefix="/api/packages", tags=["packages"])


@router.post("", status_code=status.HTTP_201_CREATED)
def generate_package(request: ArchitecturePackageRequest) -> dict[str, object]:
    try:
        return create_package(request)
    except PackageError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/{package_id}")
def read_package(package_id: str) -> dict[str, object]:
    try:
        return get_package(package_id)
    except PackageError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("/{package_id}/agent-starter-kits", status_code=status.HTTP_201_CREATED)
def generate_agent_starter_kit(package_id: str, request: AgentStarterKitRequest) -> dict[str, object]:
    try:
        return create_agent_starter_kit(package_id, request)
    except PackageError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/{package_id}/agent-starter-kits/{kit_id}/download")
def download_agent_starter_kit(package_id: str, kit_id: str) -> Response:
    try:
        archive, filename = get_agent_starter_archive(package_id, kit_id)
        return Response(
            archive,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except PackageError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
