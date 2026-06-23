"""Background server-side download manager."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Any, Protocol

from yt_dlp import YoutubeDL

from backend.app.utils.validation import validate_youtube_url

TMP_ROOT = Path(tempfile.gettempdir()) / "yt-video-downloader"
TMP_ROOT.mkdir(parents=True, exist_ok=True)
TASK_TTL_SECONDS = int(os.getenv("DOWNLOAD_TASK_TTL_SECONDS", str(24 * 60 * 60)))
REDIS_URL = os.getenv("REDIS_URL")


class JobTracker(Protocol):
    def create(self, task_id: str, task: dict[str, Any]) -> None: ...

    def get(self, task_id: str) -> dict[str, Any] | None: ...

    def update(self, task_id: str, values: dict[str, Any]) -> None: ...

    def delete(self, task_id: str) -> None: ...


class InMemoryJobTracker:
    def __init__(self) -> None:
        self._tasks: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    def create(self, task_id: str, task: dict[str, Any]) -> None:
        with self._lock:
            self._tasks[task_id] = task.copy()

    def get(self, task_id: str) -> dict[str, Any] | None:
        with self._lock:
            task = self._tasks.get(task_id)
            return task.copy() if task else None

    def update(self, task_id: str, values: dict[str, Any]) -> None:
        with self._lock:
            if task_id in self._tasks:
                self._tasks[task_id].update(values)

    def delete(self, task_id: str) -> None:
        with self._lock:
            self._tasks.pop(task_id, None)


class RedisJobTracker:
    def __init__(self, redis_url: str, ttl_seconds: int) -> None:
        from redis import Redis

        self._client = Redis.from_url(redis_url, decode_responses=True)
        from redis import WatchError

        self._ttl_seconds = ttl_seconds
        self._watch_error = WatchError
        self._client.ping()

    @staticmethod
    def _key(task_id: str) -> str:
        return f"yt-video-downloader:download:{task_id}"

    def create(self, task_id: str, task: dict[str, Any]) -> None:
        self._client.set(self._key(task_id), json.dumps(task), ex=self._ttl_seconds)

    def get(self, task_id: str) -> dict[str, Any] | None:
        raw = self._client.get(self._key(task_id))
        if raw is None:
            return None
        return json.loads(raw)

    def update(self, task_id: str, values: dict[str, Any]) -> None:
        key = self._key(task_id)
        with self._client.pipeline() as pipe:
            while True:
                try:
                    pipe.watch(key)
                    raw = pipe.get(key)
                    if raw is None:
                        pipe.unwatch()
                        return
                    task = json.loads(raw)
                    task.update(values)
                    pipe.multi()
                    pipe.set(key, json.dumps(task), ex=self._ttl_seconds)
                    pipe.execute()
                    return
                except self._watch_error:
                    continue
                finally:
                    pipe.reset()

    def delete(self, task_id: str) -> None:
        self._client.delete(self._key(task_id))


def _build_tracker() -> JobTracker:
    if REDIS_URL:
        return RedisJobTracker(REDIS_URL, TASK_TTL_SECONDS)
    return InMemoryJobTracker()


TRACKER = _build_tracker()


def _safe_filename(name: str, ext: str) -> str:
    clean = "".join(
        ch for ch in name if ch.isalnum() or ch in (" ", "-", "_", ".")
    ).strip()[:120]
    return f"{clean or 'download'}.{ext}"


def create_download(
    url: str,
    format_id: str,
    download_type: str = "video",
    audio_format: str = "original",
) -> str:
    task_id = uuid.uuid4().hex
    task_dir = TMP_ROOT / task_id
    task_dir.mkdir(parents=True, exist_ok=True)
    TRACKER.create(
        task_id,
        {
            "status": "queued",
            "progress": 0,
            "phase": "Queued",
            "error": None,
            "file": None,
            "filename": None,
        },
    )
    thread = threading.Thread(
        target=_run_download,
        args=(
            task_id,
            validate_youtube_url(url),
            format_id,
            download_type,
            audio_format,
            task_dir,
        ),
        daemon=True,
    )
    thread.start()
    return task_id


def _update_task(task_id: str, values: dict[str, Any]) -> None:
    TRACKER.update(task_id, values)


def _run_download(
    task_id: str,
    url: str,
    format_id: str,
    download_type: str,
    audio_format: str,
    task_dir: Path,
) -> None:
    def hook(event: dict[str, Any]) -> None:
        if event.get("status") == "downloading":
            total = event.get("total_bytes") or event.get("total_bytes_estimate") or 0
            downloaded = event.get("downloaded_bytes") or 0
            pct = int(downloaded * 100 / total) if total else 0
            _update_task(
                task_id,
                {
                    "status": "downloading",
                    "phase": "Downloading media",
                    "progress": min(pct, 95),
                    "speed": event.get("speed"),
                    "eta": event.get("eta"),
                },
            )
        elif event.get("status") == "finished":
            _update_task(task_id, {"phase": "Preparing file...", "progress": 96})

    try:
        selector = (
            f"{format_id}+bestaudio/best" if download_type == "video" else format_id
        )
        ext = (
            "mp3"
            if audio_format == "mp3"
            else ("mp4" if download_type == "video" else "%(ext)s")
        )
        opts: dict[str, Any] = {
            "format": selector,
            "outtmpl": str(task_dir / "%(title).160B.%(ext)s"),
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "progress_hooks": [hook],
            "merge_output_format": "mp4" if download_type == "video" else None,
            "restrictfilenames": True,
            "socket_timeout": 20,
        }
        if download_type == "audio" and audio_format == "mp3":
            opts["postprocessors"] = [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "192",
                }
            ]
        _update_task(
            task_id, {"status": "running", "phase": "Fetching metadata", "progress": 2}
        )
        with YoutubeDL({k: v for k, v in opts.items() if v is not None}) as ydl:
            info = ydl.extract_info(url, download=True)
        files = [
            p
            for p in task_dir.iterdir()
            if p.is_file() and not p.name.endswith((".part", ".ytdl"))
        ]
        if not files:
            raise RuntimeError("The media file could not be prepared.")
        final = max(files, key=lambda p: p.stat().st_size)
        filename = _safe_filename(
            info.get("title") or "download", final.suffix.lstrip(".")
        )
        _update_task(
            task_id,
            {
                "status": "ready",
                "phase": "Starting download...",
                "progress": 100,
                "file": str(final),
                "filename": filename,
                "filesize": final.stat().st_size,
            },
        )
    except Exception:
        _update_task(
            task_id,
            {
                "status": "error",
                "phase": "Failed",
                "error": "Download failed. Please try another format or mode.",
                "progress": 0,
            },
        )


def get_status(task_id: str) -> dict[str, Any] | None:
    task = TRACKER.get(task_id)
    if not task:
        return None
    return {k: v for k, v in task.items() if k != "file"}


def get_file(task_id: str) -> tuple[Path, str] | None:
    task = TRACKER.get(task_id)
    if not task or task.get("status") != "ready" or not task.get("file"):
        return None
    return Path(task["file"]), task.get("filename") or "download"


def cleanup(task_id: str) -> bool:
    TRACKER.delete(task_id)
    shutil.rmtree(TMP_ROOT / task_id, ignore_errors=True)
    return True
