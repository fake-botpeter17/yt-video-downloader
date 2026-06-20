"""Backward-compatible blueprint wrapper for legacy imports."""

from __future__ import annotations

from flask import Blueprint, jsonify, request

from backend.app.services.youtube_service import extract_info
from backend.app.utils.rate_limit import rate_limit

yt_bp = Blueprint("yt_bp", __name__, url_prefix="/yt")


@yt_bp.post("/get-formats")
@rate_limit(20, 60)
def get_video_formats():
    """Return formats using the historical /yt/get-formats route."""
    try:
        info = extract_info((request.get_json(silent=True) or {}).get("url"))
        return jsonify(info["formats"])
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        return jsonify({"error": "Could not fetch formats."}), 502
