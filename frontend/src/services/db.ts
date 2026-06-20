import type { HistoryItem } from "../types/download";

const DB_NAME = "yt-downloader";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("history")) db.createObjectStore("history", { keyPath: "id" });
      if (!db.objectStoreNames.contains("chunks")) db.createObjectStore("chunks", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveHistory(item: HistoryItem) {
  const db = await openDb();
  const tx = db.transaction("history", "readwrite");
  tx.objectStore("history").put(item);
}

export async function getHistory(): Promise<HistoryItem[]> {
  const db = await openDb();
  return new Promise((resolve) => {
    const req = db.transaction("history").objectStore("history").getAll();
    req.onsuccess = () => resolve((req.result as HistoryItem[]).sort((a, b) => b.date.localeCompare(a.date)));
  });
}

export async function deleteHistory(id: string) {
  const db = await openDb();
  db.transaction("history", "readwrite").objectStore("history").delete(id);
}

export async function saveChunk(id: string, blob: Blob) {
  const db = await openDb();
  db.transaction("chunks", "readwrite").objectStore("chunks").put({ id, blob, savedAt: Date.now() });
}
