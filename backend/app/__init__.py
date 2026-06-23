"""Flask application factory for the YouTube downloader API."""

from __future__ import annotations

from flask import Flask, jsonify, request, send_file

from backend.app.services.download_manager import (
    cleanup,
    create_download,
    get_file,
    get_status,
)
from backend.app.services.youtube_service import extract_info, prepare_streams
from backend.app.utils.rate_limit import rate_limit


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 16 * 1024
    app.config["verbose"] = False

    @app.after_request
    def add_headers(response):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "GET,POST,DELETE,OPTIONS"
        return response

    @app.route("/<path:_>", methods=["OPTIONS"])
    def options(_):
        if app.config.get("verbose", False):
            print("Invalid Request!! ")
        return "", 204

    @app.post("/video/info")
    @rate_limit(20, 60)
    def video_info():
        try:
            url = (request.get_json(silent=True) or {}).get("url")
            if app.config.get("verbose", False):
                print(f"getting video info for video id: {url}")

            return jsonify(
                extract_info(url)
            )
        
        except ValueError as exc:
            if app.config.get("verbose", False):
                print(f"Erorr occured while fetching video info. \n\nVideo ID: {url}")
            return jsonify({"error": str(exc)}), 400
        except Exception:
            return (
                jsonify(
                    {
                        "error": "Could not fetch video details. Please check the link and try again."
                    }
                ),
                502,
            )

    @app.post("/download/prepare")
    @rate_limit(30, 60)
    def prepare_download():
        payload = request.get_json(silent=True) or {}
        try:
            return jsonify(
                prepare_streams(
                    payload.get("url"),
                    payload.get("format_id", "best"),
                    payload.get("download_type", "video"),
                    payload.get("audio_format", "original"),
                )
            )
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        except Exception:
            return (
                jsonify({"error": "Could not prepare direct streams for this format."}),
                502,
            )

    @app.post("/download/server")
    @rate_limit(10, 60)
    def server_download():
        payload = request.get_json(silent=True) or {}
        if app.config.get("verbose", False):
            print(f"starting server download with payload\n {payload}")
        try:
            task_id = create_download(
                payload.get("url"),
                payload.get("format_id", "best"),
                payload.get("download_type", "video"),
                payload.get("audio_format", "original"),
            )

            if app.config.get("verbose", False):
                print(f"created task id: {task_id}")
            
            return jsonify({"download_id": task_id})
        except ValueError as exc:
            if app.config.get("verbose", False):
                print("error creating task id")
            return jsonify({"error": str(exc)}), 400

    @app.get("/download/status/<task_id>")
    def download_status(task_id: str):
        status = get_status(task_id)
        if app.config.get("verbose", False):
            print(f"Checking status of {task_id} : {status}")
        return (
            (jsonify(status), 200)
            if status
            else (jsonify({"error": "Download not found."}), 404)
        )

    @app.get("/download/file/<task_id>")
    def download_file(task_id: str):
        result = get_file(task_id)
        if app.config.get("verbose", False):
            print(f"Downloading file {task_id}")
        if not result:
            return jsonify({"error": "File is not ready."}), 404
        path, filename = result
        return send_file(path, as_attachment=True, download_name=filename, max_age=0)

    @app.delete("/download/<task_id>")
    def delete_download(task_id: str):
        cleanup(task_id)
        return jsonify({"ok": True})

    return app
