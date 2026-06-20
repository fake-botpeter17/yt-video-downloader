import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./services/api";
import { deleteHistory, getHistory, saveHistory } from "./services/db";
import type { DownloadType, HistoryItem, MediaFormat, Mode, VideoInfo } from "./types/download";
import "./index.css";

const ACTIVE_DOWNLOAD_KEY = "yt-downloader-active-server-download";
const youtubePattern = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be)\//i;
const fmtSize = (size?: number) => (size ? `${(size / 1024 / 1024).toFixed(size > 1024 * 1024 * 1024 ? 0 : 1)} MB` : "Size varies");
const duration = (seconds?: number) => (seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "—");

interface ActiveServerDownload {
  downloadId: string;
  videoId: string;
  title: string;
  thumbnail?: string;
  url: string;
  format: string;
}

function ModeCard({ mode, active, disabled, onClick, title, children }: { mode: Mode; active: boolean; disabled?: boolean; onClick: (mode: Mode) => void; title: string; children: string }) {
  return (
    <button className={`mode-card ${active ? "active" : ""}`} disabled={disabled} onClick={() => onClick(mode)}>
      <span>{title}</span>
      <small>{children}</small>
      {disabled && <em>Temporarily disabled</em>}
    </button>
  );
}

function FormatButton({ format, selected, onClick }: { format: MediaFormat; selected: boolean; onClick: () => void }) {
  return (
    <button className={`format ${selected ? "selected" : ""}`} onClick={onClick}>
      <b>{format.label}</b>
      <span>{format.fps ? `${format.fps} FPS · ` : ""}{format.codec?.split(".")[0]} · {fmtSize(format.filesize)}</span>
    </button>
  );
}

function loadActiveDownload(): ActiveServerDownload | null {
  try {
    const saved = window.localStorage.getItem(ACTIVE_DOWNLOAD_KEY);
    return saved ? JSON.parse(saved) as ActiveServerDownload : null;
  } catch {
    return null;
  }
}

export default function App() {
  const initialActiveDownload = useMemo(() => loadActiveDownload(), []);
  const [url, setUrl] = useState(initialActiveDownload?.url ?? "");
  const [mode] = useState<Mode>("server");
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [selected, setSelected] = useState<MediaFormat | null>(null);
  const [downloadType, setDownloadType] = useState<DownloadType>("video");
  const [audioFormat, setAudioFormat] = useState<"original" | "mp3">("original");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [serverProgress, setServerProgress] = useState({ progress: 0, phase: "Idle", status: "idle" });
  const [activeDownload, setActiveDownload] = useState<ActiveServerDownload | null>(initialActiveDownload);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const detailsRef = useRef<HTMLElement | null>(null);
  const pollRef = useRef<number | null>(null);
  const valid = useMemo(() => youtubePattern.test(url.trim()), [url]);

  useEffect(() => { getHistory().then(setHistory); }, []);

  useEffect(() => {
    if (!activeDownload) return;
    const routeId = window.location.pathname.replace(/^\//, "");
    if (routeId && routeId !== activeDownload.videoId) return;
    pollServerDownload(activeDownload);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [activeDownload]);

  async function paste() { setUrl((await navigator.clipboard.readText()).trim()); }

  async function fetchInfo() {
    if (!valid) return setError("Paste a valid youtube.com or youtu.be video link.");
    setError("");
    setLoading(true);
    try {
      const data = await api.info(url);
      setInfo(data);
      setSelected(data.formats.video[0] ?? data.formats.audio[0] ?? null);
      window.setTimeout(() => {
        if (window.matchMedia("(max-width: 760px)").matches) detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load formats.");
    } finally {
      setLoading(false);
    }
  }

  async function pollServerDownload(download: ActiveServerDownload) {
    if (pollRef.current) window.clearInterval(pollRef.current);
    const tick = async () => {
      try {
        const status = await api.status(download.downloadId);
        setServerProgress({ progress: status.progress, phase: status.phase, status: status.status });
        if (status.status === "ready" || status.status === "error") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          if (status.status === "error") setError(status.error ?? "Server download failed.");
        }
      } catch (err) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        setError(err instanceof Error ? err.message : "Could not restore the previous download status.");
      }
    };
    await tick();
    pollRef.current = window.setInterval(tick, 1200);
  }

  async function startDownload() {
    if (!selected || !info) return;
    setError("");
    const formatText = `${downloadType === "audio" && audioFormat === "mp3" ? "MP3 from " : ""}${selected.label}`;
    try {
      const { download_id } = await api.serverStart(url, selected.format_id, downloadType, audioFormat);
      const active = { downloadId: download_id, videoId: info.id, title: info.title, thumbnail: info.thumbnail, url, format: formatText };
      window.localStorage.setItem(ACTIVE_DOWNLOAD_KEY, JSON.stringify(active));
      window.history.pushState({}, "", `/${info.id}`);
      setActiveDownload(active);
      await pollServerDownload(active);
      await saveHistory({ id: crypto.randomUUID(), title: info.title, thumbnail: info.thumbnail, date: new Date().toISOString(), mode: "server", format: formatText, filesize: selected.filesize, url });
      setHistory(await getHistory());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    }
  }

  const formats = downloadType === "video" ? info?.formats.video : info?.formats.audio;
  const fileReady = activeDownload && serverProgress.status === "ready";

  return <main onDrop={(e) => { e.preventDefault(); setUrl(e.dataTransfer.getData("text")); }} onDragOver={(e) => e.preventDefault()}>
    <section className="hero"><div className="badge">Server mode enabled</div><h1>YouTube downloads, processed on the server.</h1><p className="sub">Server Mode is the default while Browser Mode is locked. Downloads continue on a video-specific URL so refreshing restores the current task instead of starting over.</p><div className="url-card"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Drop or paste a youtube.com / youtu.be link" inputMode="url" /><button className="secondary" onClick={paste}>Paste</button><button disabled={!valid || loading} onClick={fetchInfo}>{loading ? "Loading…" : "Continue"}</button></div>{error && <div className="toast">{error}</div>}<div className="mode-grid"><ModeCard mode="browser" active={false} disabled onClick={() => undefined} title="Browser Mode">Runs entirely on your device. Locked temporarily while we harden client-side processing.</ModeCard><ModeCard mode="server" active={mode === "server"} onClick={() => undefined} title="Server Mode">Default mode. Uses server resources for downloading, merging, MP3 conversion, and reliable mobile downloads.</ModeCard></div></section>
    {loading && <section className="panel skeleton"><div /><div /><div /></section>}
    {info && <section ref={detailsRef} className="panel details"><img src={info.thumbnail} alt="Video thumbnail" /><div><h2>{info.title}</h2><p>{info.uploader} · {duration(info.duration)}</p><div className="segmented"><button className={downloadType === "video" ? "active" : ""} onClick={() => { setDownloadType("video"); setSelected(info.formats.video[0]); }}>Video</button><button className={downloadType === "audio" ? "active" : ""} onClick={() => { setDownloadType("audio"); setSelected(info.formats.audio[0]); }}>Audio</button></div>{downloadType === "audio" && <div className="segmented mini"><button className={audioFormat === "original" ? "active" : ""} onClick={() => setAudioFormat("original")}>Original</button><button className={audioFormat === "mp3" ? "active" : ""} onClick={() => setAudioFormat("mp3")}>Convert MP3</button></div>}</div></section>}
    {formats && <section className="panel"><h3>Select format</h3><div className="formats">{formats.map((f) => <FormatButton key={f.format_id} format={f} selected={selected?.format_id === f.format_id} onClick={() => setSelected(f)} />)}</div><button className="download" onClick={startDownload}>Start server download</button></section>}
    <section className="panel progress"><h3>Download manager</h3>{activeDownload && <p className="muted"><b>{activeDownload.title}</b> · {activeDownload.format}</p>}<div className="bar"><span style={{ width: `${serverProgress.progress}%` }} /></div><p>{serverProgress.phase} · {serverProgress.progress}%</p>{fileReady && <a className="download-link" href={api.fileUrl(activeDownload.downloadId)}>Download ready file</a>}</section>
    <section className="panel"><h3>Downloads</h3>{history.length === 0 ? <p className="muted">Finished downloads will appear here and persist locally.</p> : <div className="history">{history.map((item) => <article key={item.id}><img src={item.thumbnail} alt="" /><div><b>{item.title}</b><span>{item.mode} · {item.format} · {new Date(item.date).toLocaleString()}</span></div><button onClick={() => setUrl(item.url)}>Re-download</button><button className="ghost" onClick={async () => { await deleteHistory(item.id); setHistory(await getHistory()); }}>Delete</button></article>)}</div>}</section>
  </main>;
}
