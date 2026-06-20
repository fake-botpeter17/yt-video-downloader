export type Mode = "browser" | "server";
export type DownloadType = "video" | "audio";

export interface MediaFormat {
  format_id: string;
  label: string;
  ext?: string;
  container?: string;
  filesize?: number;
  resolution?: string;
  height?: number;
  fps?: number;
  codec?: string;
  has_audio?: boolean;
  bitrate?: number;
}

export interface VideoInfo {
  id: string;
  title: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  formats: { video: MediaFormat[]; audio: MediaFormat[] };
}

export interface PreparedStream {
  format_id: string;
  url: string;
  ext: string;
  codec: string;
  kind: "video" | "audio";
  filesize?: number;
}

export interface PreparedDownload {
  title: string;
  thumbnail?: string;
  duration?: number;
  download_type: DownloadType;
  audio_format: "original" | "mp3";
  streams: PreparedStream[];
}

export interface HistoryItem {
  id: string;
  title: string;
  thumbnail?: string;
  date: string;
  mode: Mode;
  format: string;
  filesize?: number;
  url: string;
}
