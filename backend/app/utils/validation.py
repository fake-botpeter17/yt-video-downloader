"""Input validation helpers for YouTube URLs."""

from __future__ import annotations

from urllib.parse import urlparse

ALLOWED_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}


def validate_youtube_url(raw_url: str | None) -> str:
    """Return a normalized YouTube URL or raise ValueError."""
    if not raw_url or not isinstance(raw_url, str):
        raise ValueError("Paste a YouTube URL to continue.")

    url = raw_url.strip()
    if len(url) > 2048:
        raise ValueError("That URL is too long.")

    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Use a full YouTube URL starting with https://.")

    host = parsed.netloc.lower().split(":", 1)[0]
    if host not in ALLOWED_HOSTS:
        raise ValueError("Only youtube.com and youtu.be links are supported.")

    if host == "youtu.be" and not parsed.path.strip("/"):
        raise ValueError("That YouTube short link is missing a video id.")

    if (
        host != "youtu.be"
        and parsed.path not in {"/watch", "/shorts", "/embed"}
        and not parsed.path.startswith(("/watch/", "/shorts/", "/embed/"))
    ):
        raise ValueError("Paste a direct YouTube video link.")

    return url
