import { useEffect, useMemo, useState } from "react";
import { api } from "./services/api";
import { deleteHistory, getHistory, saveHistory } from "./services/db";
import { useBrowserDownload } from "./hooks/useBrowserDownload";
import type { DownloadType, HistoryItem, MediaFormat, Mode, VideoInfo } from "./types/download";
import "./index.css";

const youtubePattern = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be)\//i;
const fmtSize = (size?: number) => (size ? `${(size / 1024 / 1024).toFixed(size > 1024 * 1024 * 1024 ? 0 : 1)} MB` : "Size varies");
const duration = (seconds?: number) => (seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "—");

function ModeCard({ mode, active, onClick, title, children }: { mode: Mode; active: boolean; onClick: (mode: Mode) => void; title: string; children: string }) {
  return <button className={`mode-card ${active ? "active" : ""}`} onClick={() => onClick(mode)}><span>{title}</span><small>{children}</small></button>;
}

function FormatButton({ format, selected, onClick }: { format: MediaFormat; selected: boolean; onClick: () => void }) {
  return <button className={`format ${selected ? "selected" : ""}`} onClick={onClick}><b>{format.label}</b><span>{format.fps ? `${format.fps} FPS · ` : ""}{format.codec?.split(".")[0]} · {fmtSize(format.filesize)}</span></button>;
}

export default function App() {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<Mode>("browser");
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [selected, setSelected] = useState<MediaFormat | null>(null);
  const [downloadType, setDownloadType] = useState<DownloadType>("video");
  const [audioFormat, setAudioFormat] = useState<"original" | "mp3">("original");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [serverProgress, setServerProgress] = useState({ progress: 0, phase: "Idle" });
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const { progress, download } = useBrowserDownload();
  const valid = useMemo(() => youtubePattern.test(url.trim()), [url]);

  useEffect(() => { getHistory().then(setHistory); }, []);

  async function paste() { setUrl((await navigator.clipboard.readText()).trim()); }

  async function fetchInfo() {
    if (!valid) return setError("Paste a valid youtube.com or youtu.be video link.");
    setError(""); setLoading(true);
    try {
      const data = await api.info(url);
      setInfo(data);
      setSelected(data.formats.video[0] ?? data.formats.audio[0] ?? null);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load formats."); }
    finally { setLoading(false); }
  }

  async function startDownload() {
    if (!selected || !info) return;
    setError("");
    const formatText = `${downloadType === "audio" && audioFormat === "mp3" ? "MP3 from " : ""}${selected.label}`;
    try {
      if (mode === "browser") {
        const prepared = await api.prepare(url, selected.format_id, mode, downloadType, audioFormat);
        await download(prepared);
      } else {
        const { download_id } = await api.serverStart(url, selected.format_id, downloadType, audioFormat);
        const timer = window.setInterval(async () => {
          const status = await api.status(download_id);
          setServerProgress({ progress: status.progress, phase: status.phase });
          if (status.status === "ready") { window.clearInterval(timer); window.location.href = api.fileUrl(download_id); }
          if (status.status === "error") { window.clearInterval(timer); setError(status.error ?? "Server download failed."); }
        }, 1200);
      }
      await saveHistory({ id: crypto.randomUUID(), title: info.title, thumbnail: info.thumbnail, date: new Date().toISOString(), mode, format: formatText, filesize: selected.filesize, url });
      setHistory(await getHistory());
    } catch (err) { setError(err instanceof Error ? err.message : "Download failed."); }
  }

  const formats = downloadType === "video" ? info?.formats.video : info?.formats.audio;

  return <main onDrop={(e) => { e.preventDefault(); setUrl(e.dataTransfer.getData("text")); }} onDragOver={(e) => e.preventDefault()}>
    <section className="hero"><div className="badge">Premium local-first downloader</div><h1>YouTube downloads, merged your way.</h1><p className="sub">Choose browser mode to run entirely on your device, or server mode for heavy downloads and mobile compatibility.</p><div className="url-card"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Drop or paste a youtube.com / youtu.be link" inputMode="url" /><button className="secondary" onClick={paste}>Paste</button><button disabled={!valid || loading} onClick={fetchInfo}>{loading ? "Loading…" : "Continue"}</button></div>{error && <div className="toast">{error}</div>}<div className="mode-grid"><ModeCard mode="browser" active={mode === "browser"} onClick={setMode} title="Browser Mode">Runs entirely on your device. Uses Fetch streams, IndexedDB, and FFmpeg WASM.</ModeCard><ModeCard mode="server" active={mode === "server"} onClick={setMode} title="Server Mode">Uses server resources for downloading and merging. Best for large files and mobile.</ModeCard></div></section>
    {loading && <section className="panel skeleton"><div /><div /><div /></section>}
    {info && <section className="panel details"><img src={info.thumbnail} alt="Video thumbnail" /><div><h2>{info.title}</h2><p>{info.uploader} · {duration(info.duration)}</p><div className="segmented"><button className={downloadType === "video" ? "active" : ""} onClick={() => { setDownloadType("video"); setSelected(info.formats.video[0]); }}>Video</button><button className={downloadType === "audio" ? "active" : ""} onClick={() => { setDownloadType("audio"); setSelected(info.formats.audio[0]); }}>Audio</button></div>{downloadType === "audio" && <div className="segmented mini"><button className={audioFormat === "original" ? "active" : ""} onClick={() => setAudioFormat("original")}>Original</button><button className={audioFormat === "mp3" ? "active" : ""} onClick={() => setAudioFormat("mp3")}>Convert MP3</button></div>}</div></section>}
    {formats && <section className="panel"><h3>Select format</h3><div className="formats">{formats.map((f) => <FormatButton key={f.format_id} format={f} selected={selected?.format_id === f.format_id} onClick={() => setSelected(f)} />)}</div><button className="download" onClick={startDownload}>Start {mode === "browser" ? "browser" : "server"} download</button></section>}
    <section className="panel progress"><h3>Download manager</h3><div className="bar"><span style={{ width: `${mode === "browser" ? progress.overall : serverProgress.progress}%` }} /></div><p>{mode === "browser" ? `${progress.phase} · ${progress.speed} · video ${progress.video}% · audio ${progress.audio}%` : `${serverProgress.phase} · ${serverProgress.progress}%`}</p></section>
    <section className="panel"><h3>Downloads</h3>{history.length === 0 ? <p className="muted">Finished downloads will appear here and persist locally.</p> : <div className="history">{history.map((item) => <article key={item.id}><img src={item.thumbnail} alt="" /><div><b>{item.title}</b><span>{item.mode} · {item.format} · {new Date(item.date).toLocaleString()}</span></div><button onClick={() => setUrl(item.url)}>Re-download</button><button className="ghost" onClick={async () => { await deleteHistory(item.id); setHistory(await getHistory()); }}>Delete</button></article>)}</div>}</section>
  </main>;
}
