import { useState } from "react";
import { processWithFfmpeg } from "../services/ffmpeg";
import { saveChunk } from "../services/db";
import type { PreparedDownload } from "../types/download";

export function useBrowserDownload() {
  const [progress, setProgress] = useState({ overall: 0, video: 0, audio: 0, speed: "—", eta: "—", phase: "Idle" });

  async function download(prepared: PreparedDownload) {
    const started = performance.now();
    const sizes = new Map<string, number>();
    const totals = new Map<string, number>();
    await Promise.all(prepared.streams.map(async (stream) => {
      const response = await fetch(stream.url);
      const total = Number(response.headers.get("content-length") || stream.filesize || 0);
      totals.set(stream.kind, total);
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      if (!reader) throw new Error("Streaming is not supported in this browser.");
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        sizes.set(stream.kind, (sizes.get(stream.kind) || 0) + value.length);
        const downloaded = [...sizes.values()].reduce((a, b) => a + b, 0);
        const all = [...totals.values()].reduce((a, b) => a + b, 0) || downloaded;
        const mbps = downloaded / Math.max((performance.now() - started) / 1000, 1) / 1024 / 1024;
        setProgress((p) => ({ ...p, phase: "Downloading in browser", overall: Math.round(downloaded * 70 / all), [stream.kind]: total ? Math.round((sizes.get(stream.kind) || 0) * 100 / total) : 0, speed: `${mbps.toFixed(1)} MB/s` }));
      }
      await saveChunk(`${prepared.title}-${stream.kind}`, new Blob(chunks.map((chunk) => chunk.slice().buffer)));
    }));
    const blob = await processWithFfmpeg(prepared.streams, prepared.title, prepared.audio_format, (phase, pct) => setProgress((p) => ({ ...p, phase, overall: pct })));
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${prepared.title}.${prepared.audio_format === "mp3" ? "mp3" : "mp4"}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return { progress, download };
}
