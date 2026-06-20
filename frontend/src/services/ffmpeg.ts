import type { PreparedStream } from "../types/download";

export async function processWithFfmpeg(streams: PreparedStream[], title: string, audioFormat: "original" | "mp3", onProgress: (message: string, pct: number) => void): Promise<Blob> {
  onProgress("Loading FFmpeg WASM", 2);
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { fetchFile, toBlobURL } = await import("@ffmpeg/util");
  const ffmpeg = new FFmpeg();
  ffmpeg.on("progress", ({ progress }) => onProgress("Processing locally", Math.round(75 + progress * 20)));
  const base = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
  await ffmpeg.load({ coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"), wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm") });
  const inputs: string[] = [];
  for (const [index, stream] of streams.entries()) {
    const inputName = `${stream.kind}-${index}.${stream.ext || "mp4"}`;
    inputs.push(inputName);
    onProgress(`Fetching ${stream.kind}`, 10 + index * 20);
    await ffmpeg.writeFile(inputName, await fetchFile(stream.url));
  }
  const safeTitle = title.replace(/[^a-z0-9-_ ]/gi, "").slice(0, 80) || "download";
  const output = audioFormat === "mp3" ? `${safeTitle}.mp3` : `${safeTitle}.mp4`;
  const args = audioFormat === "mp3" ? ["-i", inputs.at(-1)!, "-vn", "-codec:a", "libmp3lame", "-b:a", "192k", output] : inputs.flatMap((i) => ["-i", i]).concat(["-c", "copy", output]);
  await ffmpeg.exec(args);
  const data = await ffmpeg.readFile(output);
  onProgress("Finalizing", 100);
  const bytes = data instanceof Uint8Array ? data.slice().buffer : data;
  return new Blob([bytes], { type: audioFormat === "mp3" ? "audio/mpeg" : "video/mp4" });
}
