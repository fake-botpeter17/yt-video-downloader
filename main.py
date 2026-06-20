import yt_dlp

url = "https://youtu.be/9FddJ-Gwzmo?si=E-xuXHJMkVQY3YDo"

ydl_opts = {
    "format": "137+140",  # 1080p video + audio
}

with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    info = ydl.download([url])

# for fmt in info["formats"]:
#     print(
#         f"ID: {fmt.get('format_id'):<5} "
#         f"Resolution: {fmt.get('resolution', 'N/A'):<10} "
#         f"Ext: {fmt.get('ext'):<5} "
#         f"FPS: {fmt.get('fps', 'N/A')}"
#     )