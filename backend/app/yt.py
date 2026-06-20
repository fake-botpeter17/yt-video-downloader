from flask import Blueprint, request
from yt_dlp import YoutubeDL

yt_bp = Blueprint(__name__, "yt_bp", url_prefix="/yt")


@yt_bp.route("/get-formats")
def get_video_formats():
    url = request.get_json().get("url")

    with YoutubeDL({"quiet": True}) as ydl:
        info = ydl.extract_info(url, download=False)

        formats = [
            {
                "id": f["format_id"],
                "ext": f.get("ext"),
                "height": f.get("height"),
                "fps": f.get("fps"),
            }
            for f in info["formats"]
        ]

        return formats


def get_video_download_link():
    