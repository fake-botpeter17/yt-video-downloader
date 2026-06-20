"""yt-dlp metadata and stream extraction service."""

from __future__ import annotations

from typing import Any

from yt_dlp import YoutubeDL

from backend.app.utils.validation import validate_youtube_url

BASE_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "skip_download": True,
    "noplaylist": True,
    "socket_timeout": 20,
}


def _filesize(fmt: dict[str, Any]) -> int | None:
    return fmt.get("filesize") or fmt.get("filesize_approx")


def _video_label(fmt: dict[str, Any]) -> str:
    height = fmt.get("height")
    ext = (fmt.get("ext") or "media").upper()
    return (
        f"{height}p {ext}" if height else fmt.get("format_note") or fmt.get("format_id")
    )


def _audio_label(fmt: dict[str, Any]) -> str:
    abr = fmt.get("abr")
    codec = (fmt.get("acodec") or "audio").split(".")[0]
    return f"{round(abr)}kbps {codec}" if abr else codec


def extract_info(url: str) -> dict[str, Any]:
    safe_url = validate_youtube_url(url)
    with YoutubeDL(BASE_OPTS) as ydl:
        info = ydl.extract_info(safe_url, download=False)
    formats = info.get("formats", [])
    videos = []
    audios = []
    for fmt in formats:
        if not fmt.get("format_id") or not fmt.get("url"):
            continue
        item = {
            "format_id": fmt.get("format_id"),
            "label": (
                _video_label(fmt) if fmt.get("vcodec") != "none" else _audio_label(fmt)
            ),
            "ext": fmt.get("ext"),
            "container": fmt.get("ext"),
            "filesize": _filesize(fmt),
            "url": None,
        }
        if fmt.get("vcodec") != "none" and fmt.get("height"):
            videos.append(
                item
                | {
                    "resolution": f"{fmt.get('height')}p",
                    "height": fmt.get("height"),
                    "fps": fmt.get("fps"),
                    "codec": fmt.get("vcodec"),
                    "has_audio": fmt.get("acodec") != "none",
                }
            )
        elif fmt.get("acodec") != "none" and fmt.get("vcodec") == "none":
            audios.append(
                item
                | {
                    "bitrate": fmt.get("abr"),
                    "codec": fmt.get("acodec"),
                }
            )
    videos.sort(key=lambda f: (f.get("height") or 0, f.get("fps") or 0), reverse=True)
    audios.sort(key=lambda f: f.get("bitrate") or 0, reverse=True)
    return {
        "id": info.get("id"),
        "title": info.get("title"),
        "thumbnail": info.get("thumbnail"),
        "duration": info.get("duration"),
        "uploader": info.get("uploader"),
        "formats": {"video": videos, "audio": audios},
    }


def prepare_streams(
    url: str,
    format_id: str,
    download_type: str = "video",
    audio_format: str = "original",
) -> dict[str, Any]:
    safe_url = validate_youtube_url(url)
    selector = f"{format_id}+bestaudio/best" if download_type == "video" else format_id
    with YoutubeDL(BASE_OPTS | {"format": selector}) as ydl:
        info = ydl.extract_info(safe_url, download=False)
    requested = info.get("requested_formats") or [info]
    streams = []
    for fmt in requested:
        streams.append(
            {
                "format_id": fmt.get("format_id"),
                "url": fmt.get("url"),
                "ext": fmt.get("ext"),
                "codec": (
                    fmt.get("vcodec")
                    if fmt.get("vcodec") != "none"
                    else fmt.get("acodec")
                ),
                "kind": "video" if fmt.get("vcodec") != "none" else "audio",
                "filesize": _filesize(fmt),
            }
        )
    return {
        "title": info.get("title"),
        "thumbnail": info.get("thumbnail"),
        "duration": info.get("duration"),
        "download_type": download_type,
        "audio_format": audio_format,
        "streams": streams,
    }
