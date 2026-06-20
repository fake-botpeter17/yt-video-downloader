"""Background server-side download manager."""

from __future__ import annotations

import shutil
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Any

from yt_dlp import YoutubeDL

from backend.app.utils.validation import validate_youtube_url

TMP_ROOT = Path(tempfile.gettempdir()) / "yt-video-downloader"
TMP_ROOT.mkdir(parents=True, exist_ok=True)
TASKS: dict[str, dict[str, Any]] = {}


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
    TASKS[task_id] = {
        "status": "queued",
        "progress": 0,
        "phase": "Queued",
        "error": None,
        "file": None,
        "filename": None,
    }
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


def _run_download(
    task_id: str,
    url: str,
    format_id: str,
    download_type: str,
    audio_format: str,
    task_dir: Path,
) -> None:
    task = TASKS[task_id]

    def hook(event: dict[str, Any]) -> None:
        if event.get("status") == "downloading":
            total = event.get("total_bytes") or event.get("total_bytes_estimate") or 0
            downloaded = event.get("downloaded_bytes") or 0
            pct = int(downloaded * 100 / total) if total else 0
            task.update(
                {
                    "status": "downloading",
                    "phase": "Downloading media",
                    "progress": min(pct, 95),
                    "speed": event.get("speed"),
                    "eta": event.get("eta"),
                }
            )
        elif event.get("status") == "finished":
            task.update({"phase": "Preparing file...", "progress": 96})

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
        task.update({"status": "running", "phase": "Fetching metadata", "progress": 2})
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
        task.update(
            {
                "status": "ready",
                "phase": "Starting download...",
                "progress": 100,
                "file": str(final),
                "filename": filename,
                "filesize": final.stat().st_size,
            }
        )
    except Exception:
        task.update(
            {
                "status": "error",
                "phase": "Failed",
                "error": "Download failed. Please try another format or mode.",
                "progress": 0,
            }
        )


def get_status(task_id: str) -> dict[str, Any] | None:
    task = TASKS.get(task_id)
    if not task:
        return None
    return {k: v for k, v in task.items() if k != "file"}


def get_file(task_id: str) -> tuple[Path, str] | None:
    task = TASKS.get(task_id)
    if not task or task.get("status") != "ready" or not task.get("file"):
        return None
    return Path(task["file"]), task.get("filename") or "download"


def cleanup(task_id: str) -> bool:
    TASKS.pop(task_id, None)
    shutil.rmtree(TMP_ROOT / task_id, ignore_errors=True)
    return True
