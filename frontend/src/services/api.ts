import type { DownloadType, Mode, PreparedDownload, VideoInfo } from "../types/download";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { "Content-Type": "application/json", ...(init.headers ?? {}) }, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data as T;
}

export const api = {
  info: (url: string) => request<VideoInfo>("/video/info", { method: "POST", body: JSON.stringify({ url }) }),
  prepare: (url: string, format_id: string, mode: Mode, download_type: DownloadType, audio_format: "original" | "mp3") =>
    request<PreparedDownload>("/download/prepare", { method: "POST", body: JSON.stringify({ url, format_id, mode, download_type, audio_format }) }),
  serverStart: (url: string, format_id: string, download_type: DownloadType, audio_format: "original" | "mp3") =>
    request<{ download_id: string }>("/download/server", { method: "POST", body: JSON.stringify({ url, format_id, mode: "server", download_type, audio_format }) }),
  status: (id: string) => request<{ status: string; progress: number; phase: string; speed?: number; eta?: number; error?: string }>(`/download/status/${id}`, { method: "GET", headers: {} }),
  fileUrl: (id: string) => `${API_BASE}/download/file/${id}`,
};
