import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./services/api";
import { deleteHistory, getHistory, saveHistory } from "./services/db";
import type { DownloadType, HistoryItem, MediaFormat, Mode, VideoInfo } from "./types/download";
import "./index.css";

const ACTIVE_DOWNLOAD_KEY = "yt-downloader-active-server-download";
const youtubePattern = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be)\//i;
const fmtSize = (size?: number) => (size ? `${(size / 1024 / 1024).toFixed(size > 1024 * 1024 * 1024 ? 0 : 1)} MB` : "Size varies");
const duration = (seconds?: number) => (seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "—");
const codecLabel = (codec?: string) => codec?.split(".")[0].replace(/av01/i, "AV1").replace(/vp09/i, "VP9").replace(/mp4a/i, "AAC").toUpperCase() ?? "Codec varies";
const containerLabel = (format: MediaFormat) => (format.container || format.ext || "media").toUpperCase();

interface ActiveServerDownload {
  downloadId: string;
  videoId: string;
  title: string;
  thumbnail?: string;
  url: string;
  format: string;
}

interface FormatGroup {
  key: string;
  title: string;
  sortValue: number;
  formats: MediaFormat[];
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

function formatMeta(format: MediaFormat, downloadType: DownloadType) {
  const bits = [containerLabel(format), codecLabel(format.codec)];
  if (downloadType === "video" && format.fps) bits.push(`${format.fps} FPS`);
  bits.push(fmtSize(format.filesize));
  return bits.join(" · ");
}

function groupFormats(formats: MediaFormat[], downloadType: DownloadType): FormatGroup[] {
  const groups = new Map<string, FormatGroup>();
  for (const format of formats) {
    const sortValue = downloadType === "video" ? format.height ?? 0 : Math.round(format.bitrate ?? 0);
    const title = downloadType === "video" ? format.resolution || (format.height ? `${format.height}p` : "Adaptive") : (sortValue ? `${sortValue} kbps` : "Variable bitrate");
    const key = `${downloadType}-${title}`;
    const group = groups.get(key) ?? { key, title, sortValue, formats: [] };
    group.formats.push(format);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.sortValue - a.sortValue).map((group) => ({
    ...group,
    formats: group.formats.sort((a, b) => (b.fps ?? 0) - (a.fps ?? 0) || (b.filesize ?? 0) - (a.filesize ?? 0)),
  }));
}

function FormatGroups({ formats, selected, downloadType, onSelect }: { formats: MediaFormat[]; selected: MediaFormat | null; downloadType: DownloadType; onSelect: (format: MediaFormat) => void }) {
  const groups = useMemo(() => groupFormats(formats, downloadType), [downloadType, formats]);
  const selectedKey = selected ? groups.find((group) => group.formats.some((format) => format.format_id === selected.format_id))?.key : undefined;
  const [openKey, setOpenKey] = useState<string | undefined>();
  const effectiveOpenKey = openKey ?? selectedKey ?? groups[0]?.key;

  return <div className="format-groups">{groups.map((group) => {
    const isOpen = effectiveOpenKey === group.key;
    const selectedInGroup = group.formats.some((format) => format.format_id === selected?.format_id);
    return <article className={`format-group ${selectedInGroup ? "has-selection" : ""}`} key={group.key}>
      <button className="format-group-toggle" type="button" aria-expanded={isOpen} onClick={() => setOpenKey(isOpen ? undefined : group.key)}>
        <span>{group.title}</span>
        <small>{selectedInGroup ? "Selected variant" : `${group.formats.length} variant${group.formats.length === 1 ? "" : "s"}`}</small>
        <b>{isOpen ? "▲" : "▼"}</b>
      </button>
      {isOpen && <div className="format-variants">{group.formats.map((format) => <button className={`variant ${selected?.format_id === format.format_id ? "selected" : ""}`} key={format.format_id} type="button" onClick={() => onSelect(format)}>
        <span>{formatMeta(format, downloadType)}</span>
        {selected?.format_id === format.format_id && <strong>Chosen</strong>}
      </button>)}</div>}
    </article>;
  })}</div>;
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
  const [autoDownloadState, setAutoDownloadState] = useState<"idle" | "starting" | "triggered" | "failed">("idle");
  const [loading, setLoading] = useState(false);
  const [serverProgress, setServerProgress] = useState({ progress: 0, phase: "Idle", status: "idle" });
  const [activeDownload, setActiveDownload] = useState<ActiveServerDownload | null>(initialActiveDownload);
  const [managerVisible, setManagerVisible] = useState(Boolean(initialActiveDownload));
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const detailsRef = useRef<HTMLElement | null>(null);
  const managerRef = useRef<HTMLElement | null>(null);
  const pollRef = useRef<number | null>(null);
  const attemptedAutoDownloads = useRef(new Set<string>());
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

  useEffect(() => {
    if (!activeDownload || serverProgress.status !== "ready" || attemptedAutoDownloads.current.has(activeDownload.downloadId)) return;
    attemptedAutoDownloads.current.add(activeDownload.downloadId);
    setAutoDownloadState("starting");
    window.setTimeout(() => {
      try {
        const link = document.createElement("a");
        link.href = api.fileUrl(activeDownload.downloadId);
        link.download = activeDownload.title;
        link.rel = "noopener";
        document.body.append(link);
        link.click();
        link.remove();
        setAutoDownloadState("triggered");
      } catch {
        setAutoDownloadState("failed");
        setError("Automatic download could not start. Use Manual Download below.");
      }
    }, 350);
  }, [activeDownload, serverProgress.status]);

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
    setAutoDownloadState("idle");
    setManagerVisible(true);
    const formatText = `${downloadType === "audio" && audioFormat === "mp3" ? "MP3 from " : ""}${downloadType === "video" ? selected.resolution ?? selected.label : `${Math.round(selected.bitrate ?? 0)} kbps`} · ${formatMeta(selected, downloadType)}`;
    try {
      const { download_id } = await api.serverStart(url, selected.format_id, downloadType, audioFormat);
      const active = { downloadId: download_id, videoId: info.id, title: info.title, thumbnail: info.thumbnail, url, format: formatText };
      window.localStorage.setItem(ACTIVE_DOWNLOAD_KEY, JSON.stringify(active));
      window.history.pushState({}, "", `/${info.id}`);
      setActiveDownload(active);
      window.setTimeout(() => {
        if (window.matchMedia("(max-width: 760px)").matches) managerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 120);
      await pollServerDownload(active);
      await saveHistory({ id: crypto.randomUUID(), title: info.title, thumbnail: info.thumbnail, date: new Date().toISOString(), mode: "server", format: formatText, filesize: selected.filesize, url });
      setHistory(await getHistory());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    }
  }

  const formats = downloadType === "video" ? info?.formats.video : info?.formats.audio;
  const fileReady = activeDownload && serverProgress.status === "ready";
  const progressPhase = autoDownloadState === "starting" ? "Starting download..." : autoDownloadState === "triggered" ? "Download started" : serverProgress.phase;

  return <main onDrop={(e) => { e.preventDefault(); setUrl(e.dataTransfer.getData("text")); }} onDragOver={(e) => e.preventDefault()}>
    <section className="hero"><div className="badge">Server mode enabled</div><h1>YouTube downloads, processed on the server.</h1><p className="sub">Server Mode is the default while Browser Mode is locked. Downloads continue on a video-specific URL so refreshing restores the current task instead of starting over.</p><div className="url-card"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Drop or paste a youtube.com / youtu.be link" inputMode="url" /><button className="secondary" onClick={paste}>Paste</button><button disabled={!valid || loading} onClick={fetchInfo}>{loading ? "Loading…" : "Continue"}</button></div>{error && <div className="toast">{error}</div>}<div className="mode-grid"><ModeCard mode="browser" active={false} disabled onClick={() => undefined} title="Browser Mode">Runs entirely on your device. Locked temporarily while we harden client-side processing.</ModeCard><ModeCard mode="server" active={mode === "server"} onClick={() => undefined} title="Server Mode">Default mode. Uses server resources for downloading, merging, MP3 conversion, and reliable mobile downloads.</ModeCard></div></section>
    {loading && <section className="panel skeleton"><div /><div /><div /></section>}
    {info && <section ref={detailsRef} className="panel details"><img src={info.thumbnail} alt="Video thumbnail" /><div><h2>{info.title}</h2><p>{info.uploader} · {duration(info.duration)}</p><div className="segmented"><button className={downloadType === "video" ? "active" : ""} onClick={() => { setDownloadType("video"); setSelected(info.formats.video[0]); }}>Video</button><button className={downloadType === "audio" ? "active" : ""} onClick={() => { setDownloadType("audio"); setSelected(info.formats.audio[0]); }}>Audio</button></div>{downloadType === "audio" && <div className="segmented mini"><button className={audioFormat === "original" ? "active" : ""} onClick={() => setAudioFormat("original")}>Original</button><button className={audioFormat === "mp3" ? "active" : ""} onClick={() => setAudioFormat("mp3")}>Convert MP3</button></div>}</div></section>}
    {formats && <section className="panel"><div className="section-heading"><div><h3>Select {downloadType} quality</h3><p className="muted">Pick a quality, then choose the container and codec variant that fits your needs.</p></div></div><FormatGroups formats={formats} selected={selected} downloadType={downloadType} onSelect={setSelected} /><button className="download" onClick={startDownload}>Start server download</button></section>}
    {managerVisible && <section ref={managerRef} className="panel progress manager-enter"><h3>Download manager</h3>{activeDownload && <p className="muted"><b>{activeDownload.title}</b> · {activeDownload.format}</p>}<div className="bar"><span style={{ width: `${serverProgress.progress}%` }} /></div><p>{progressPhase} · {serverProgress.progress}%</p>{autoDownloadState === "triggered" && <p className="success">Automatic download started. Keep this fallback link if your browser blocked it.</p>}{autoDownloadState === "failed" && <p className="warning">Automatic download failed. Please use the manual download button.</p>}{fileReady && <a className={`download-link ${autoDownloadState === "failed" ? "needs-attention" : "subtle"}`} href={api.fileUrl(activeDownload.downloadId)} download>{autoDownloadState === "failed" ? "Manual Download" : "Download Again"}</a>}</section>}
    <section className="panel"><h3>Downloads</h3>{history.length === 0 ? <p className="muted">Finished downloads will appear here and persist locally.</p> : <div className="history">{history.map((item) => <article key={item.id}><img src={item.thumbnail} alt="" /><div><b>{item.title}</b><span>{item.mode} · {item.format} · {new Date(item.date).toLocaleString()}</span></div><button onClick={() => setUrl(item.url)}>Re-download</button><button className="ghost" onClick={async () => { await deleteHistory(item.id); setHistory(await getHistory()); }}>Delete</button></article>)}</div>}</section>
  </main>;
}
