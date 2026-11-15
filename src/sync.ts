// Keeping devices in sync through your own server (server/server.mjs).
//
// Rather than track every edit, each sync compares every record with how it
// looked at the last sync (a fingerprint per record). Anything new or changed
// is sent; anything that has gone is sent as deleted. The server replies with
// whatever other devices changed since this one last asked, and the later
// change wins when two devices edit the same thing. Images are uploaded once
// and fetched by devices that don't have them yet.

import { getImage, storeImage } from "./images";
import { serverConfigured, serverFetch } from "./pc-ai";
import { data, save } from "./store";

const KINDS = ["sessions", "topics", "items", "collections", "dailies"] as const;
type Kind = (typeof KINDS)[number];
type Rec = { id: string } & Record<string, unknown>;

// Per-device fields: never sent, and kept when a record arrives from elsewhere.
const LOCAL_ONLY: Record<Kind, string[]> = {
  sessions: ["pcJob", "sortError"], // a sort in progress belongs to the device that started it
  items: ["dirty"], // "needs sending to Google" is about this device's Google connection
  topics: [],
  collections: [],
  dailies: [],
};

const BASE_KEY = "thinkingout:syncbase";
interface Base {
  server: string; // which server these fingerprints are for
  rev: number; // the server revision we've seen up to
  hashes: Record<string, string>; // "kind:id" -> fingerprint at the last sync
  uploaded: string[]; // image ids already on the server
}

function loadBase(): Base {
  const server = data.settings.serverUrl ?? "";
  try {
    const b = JSON.parse(localStorage.getItem(BASE_KEY) ?? "null") as Base | null;
    if (b && b.server === server) return b;
  } catch {
    /* start afresh */
  }
  return { server, rev: 0, hashes: {}, uploaded: [] };
}
const saveBase = (b: Base) => localStorage.setItem(BASE_KEY, JSON.stringify(b));

const list = (kind: Kind) => data[kind] as unknown as Rec[];
function shared(kind: Kind, rec: Rec): Rec {
  const copy = { ...rec };
  for (const f of LOCAL_ONLY[kind]) delete copy[f];
  return copy;
}
const fingerprint = (o: unknown) => JSON.stringify(o);

export const syncEnabled = () => !!data.settings.syncEnabled && serverConfigured();

export const syncState = { last: null as Date | null, error: null as string | null, running: false };

let running: Promise<void> | null = null;

export function syncNow(): Promise<void> {
  if (!syncEnabled()) return Promise.resolve();
  running ??= run().finally(() => (running = null));
  return running;
}

async function run() {
  syncState.running = true;
  try {
    const base = loadBase();
    const now = Date.now();
    const changes: { kind: Kind; id: string; data: Rec | null; updatedAt: number }[] = [];
    const seen = new Set<string>();
    for (const kind of KINDS) {
      for (const rec of list(kind)) {
        const key = `${kind}:${rec.id}`;
        seen.add(key);
        const s = shared(kind, rec);
        if (base.hashes[key] !== fingerprint(s)) changes.push({ kind, id: rec.id, data: s, updatedAt: now });
      }
    }
    for (const key of Object.keys(base.hashes)) {
      if (seen.has(key)) continue;
      const [kind, ...rest] = key.split(":");
      changes.push({ kind: kind as Kind, id: rest.join(":"), data: null, updatedAt: now });
    }

    const res = await serverFetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ since: base.rev, changes }),
    });
    if (!res.ok) throw new Error(`Sync failed: your PC answered ${res.status}.`);
    const reply = (await res.json()) as { rev: number; changes: { kind: Kind; id: string; data: Rec | null }[] };

    let changedHere = false;
    for (const c of reply.changes) {
      if (!KINDS.includes(c.kind)) continue;
      const arr = list(c.kind);
      const i = arr.findIndex((r) => r.id === c.id);
      if (c.data === null) {
        if (i >= 0) {
          arr.splice(i, 1);
          changedHere = true;
        }
        continue;
      }
      if (i >= 0 && fingerprint(shared(c.kind, arr[i])) === fingerprint(c.data)) continue; // already the same
      const merged: Rec = { ...c.data };
      if (i >= 0) for (const f of LOCAL_ONLY[c.kind]) if (f in arr[i]) merged[f] = arr[i][f];
      // A to-do changed elsewhere: this device sends it to Google too (if it's connected).
      if (c.kind === "items") merged.dirty = true;
      if (i >= 0) arr[i] = merged;
      else arr.push(merged);
      changedHere = true;
    }
    if (changedHere) data.sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest first, as the app expects

    // Remember how everything looks now, so next time only real changes are sent.
    base.hashes = {};
    for (const kind of KINDS) for (const rec of list(kind)) base.hashes[`${kind}:${rec.id}`] = fingerprint(shared(kind, rec));
    base.rev = reply.rev;
    await syncImages(base);
    saveBase(base);

    syncState.last = new Date();
    syncState.error = null;
    if (changedHere) save();
  } catch (err) {
    syncState.error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    syncState.running = false;
  }
}

// Upload images the server doesn't have; download ones this device doesn't.
async function syncImages(base: Base) {
  const uploaded = new Set(base.uploaded);
  for (const s of data.sessions) {
    for (const id of s.images ?? []) {
      const local = await getImage(id);
      if (local && !uploaded.has(id)) {
        const res = await serverFetch(`/api/images/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: local });
        if (res.ok) uploaded.add(id);
      } else if (!local) {
        const res = await serverFetch(`/api/images/${encodeURIComponent(id)}`);
        if (res.ok) {
          await storeImage(id, await res.blob());
          uploaded.add(id);
        }
      }
    }
  }
  base.uploaded = [...uploaded];
}

// ---- when to sync -----------------------------------------------------------------

let soon: number | undefined;
// After a change here: wait a moment (changes often come in bursts), then send.
export function syncSoon() {
  if (!syncEnabled()) return;
  clearTimeout(soon);
  soon = window.setTimeout(() => syncNow().catch(() => {}), 3000);
}

// On opening, every minute while open, and on coming back to the app.
export function startAutoSync() {
  const tick = () => syncNow().catch(() => {});
  tick();
  window.setInterval(() => document.visibilityState === "visible" && tick(), 60_000);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && tick());
}

// Forget what's been synced (e.g. after switching server), so the next sync
// sends everything on this device.
export function resetSync() {
  localStorage.removeItem(BASE_KEY);
}
