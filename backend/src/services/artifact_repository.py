from __future__ import annotations

from abc import ABC, abstractmethod
from functools import lru_cache
from pathlib import Path

from azure.identity import DefaultAzureCredential
from azure.storage.blob import ContainerClient

from core.config import (
    GENERATED_PACKAGES_ROOT,
    PACKAGE_ARTIFACT_BACKEND,
    PACKAGE_ARTIFACT_CONTAINER_URL,
)


class ArtifactNotFoundError(FileNotFoundError):
    pass


class ArtifactRepository(ABC):
    @abstractmethod
    def check(self) -> None:
        raise NotImplementedError

    @abstractmethod
    def write(self, path: str, content: bytes, *, overwrite: bool = False) -> None:
        raise NotImplementedError

    @abstractmethod
    def read(self, path: str) -> bytes:
        raise NotImplementedError

    @abstractmethod
    def exists(self, path: str) -> bool:
        raise NotImplementedError


class BlobArtifactRepository(ArtifactRepository):
    def __init__(self, container_url: str) -> None:
        if not container_url:
            raise RuntimeError(
                "PACKAGE_ARTIFACT_CONTAINER_URL is required when PACKAGE_ARTIFACT_BACKEND=blob."
            )
        self._container = ContainerClient.from_container_url(
            container_url, credential=DefaultAzureCredential()
        )

    def check(self) -> None:
        self._container.get_container_properties()

    def write(self, path: str, content: bytes, *, overwrite: bool = False) -> None:
        self._container.upload_blob(path, content, overwrite=overwrite)

    def read(self, path: str) -> bytes:
        blob = self._container.get_blob_client(path)
        if not blob.exists():
            raise ArtifactNotFoundError(path)
        return blob.download_blob().readall()

    def exists(self, path: str) -> bool:
        return self._container.get_blob_client(path).exists()


class FileArtifactRepository(ArtifactRepository):
    """Explicit local-development and test backend; production defaults to Blob."""

    def __init__(self, root: Path) -> None:
        self._root = root.resolve()

    def _path(self, value: str) -> Path:
        path = (self._root / value).resolve()
        if self._root != path and self._root not in path.parents:
            raise ValueError("Invalid artifact path.")
        return path

    def check(self) -> None:
        self._root.mkdir(parents=True, exist_ok=True)

    def write(self, path: str, content: bytes, *, overwrite: bool = False) -> None:
        target = self._path(path)
        if target.exists() and not overwrite:
            raise FileExistsError(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)

    def read(self, path: str) -> bytes:
        target = self._path(path)
        if not target.is_file():
            raise ArtifactNotFoundError(path)
        return target.read_bytes()

    def exists(self, path: str) -> bool:
        return self._path(path).is_file()


def _create_repository() -> ArtifactRepository:
    if PACKAGE_ARTIFACT_BACKEND == "filesystem":
        return FileArtifactRepository(GENERATED_PACKAGES_ROOT)
    if PACKAGE_ARTIFACT_BACKEND == "blob":
        return BlobArtifactRepository(PACKAGE_ARTIFACT_CONTAINER_URL)
    raise RuntimeError(
        "PACKAGE_ARTIFACT_BACKEND must be either 'blob' or 'filesystem'."
    )


@lru_cache
def get_artifact_repository() -> ArtifactRepository:
    return _create_repository()


def package_path(package_id: str, relative_path: str) -> str:
    return f"packages/{package_id}/{relative_path}"
