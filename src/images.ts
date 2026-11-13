// Photos and screenshots attached to notes. They're too big for localStorage,
// so they live in IndexedDB on this device, shrunk first so they're quick to
// show and cheap to send to Claude (about 1,000–1,600 tokens each).

const DB = "thinkingout-images";
const STORE = "images";
const MAX_SIDE = 1280;

let db: Promise<IDBDatabase> | null = null;
function open() {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return db;
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await open();
  return new Promise((resolve, reject) => {
    const req = run(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function shrink(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read that image."))), "image/jpeg", 0.85));
}

export async function addImage(file: Blob): Promise<string> {
  const id = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const small = await shrink(file);
  await tx("readwrite", (s) => s.put(small, id));
  return id;
}

export const getImage = (id: string) => tx<Blob | undefined>("readonly", (s) => s.get(id));

export async function removeImages(ids: string[]) {
  for (const id of ids) await tx("readwrite", (s) => s.delete(id));
  ids.forEach((id) => {
    const url = urls.get(id);
    if (url) URL.revokeObjectURL(url);
    urls.delete(id);
  });
}

const urls = new Map<string, string>();
export async function imageUrl(id: string): Promise<string | null> {
  if (urls.has(id)) return urls.get(id)!;
  const blob = await getImage(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

export async function imageBase64(id: string): Promise<string | null> {
  const blob = await getImage(id);
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// An <img> that fills in once the image has loaded from storage.
export function thumb(id: string, cls = "thumb") {
  const img = document.createElement("img");
  img.className = cls;
  img.alt = "";
  img.loading = "lazy";
  imageUrl(id).then((url) => {
    if (url) img.src = url;
    else img.remove();
  });
  return img;
}

// Backups carry images as base64 so a restore brings them back.
export async function exportImages(ids: string[]) {
  const out: Record<string, string> = {};
  for (const id of ids) {
    const b64 = await imageBase64(id);
    if (b64) out[id] = b64;
  }
  return out;
}

export async function importImages(images: Record<string, string>) {
  for (const [id, b64] of Object.entries(images)) {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await tx("readwrite", (s) => s.put(new Blob([bytes], { type: "image/jpeg" }), id));
  }
}

// Things shared into the app from another app's share sheet (see sw.js).
export async function takeSharedInbox(): Promise<{ images: Blob[]; text: string }> {
  if (!("caches" in window)) return { images: [], text: "" };
  const cache = await caches.open("share-inbox");
  const images: Blob[] = [];
  let text = "";
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    if (res) {
      if (new URL(req.url).pathname.endsWith("/shared-text")) text = await res.text();
      else images.push(await res.blob());
    }
    await cache.delete(req);
  }
  return { images, text };
}
