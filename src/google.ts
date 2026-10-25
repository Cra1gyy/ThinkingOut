// Two-way sync with the user's primary Google Calendar, entirely in the browser.
// Sign-in uses Google Identity Services' token flow: no server and no client
// secret, just an OAuth Client ID the user creates for their own copy of the app.
//
// Push: every ThinkingOut item becomes a Google event tagged with our item id.
// Pull: our tagged events update the matching item (so edits made in Google
//       come back), and every other event is shown read-only in the calendar.

import { addDays, isoDate, todayIso } from "./dates";
import { data, save, type CalendarItem, type GoogleEvent } from "./store";

const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const TOKEN_KEY = "thinkingout:gtoken"; // access tokens last an hour; kept apart from backups
const DONE = "✓ ";
const PULL_BACK_DAYS = 30;
const PULL_AHEAD_DAYS = 180;

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const google: any;

interface Token {
  value: string;
  expires: number;
}

let token: Token | null = (() => {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? "null") as Token | null;
    return t && t.expires > Date.now() ? t : null;
  } catch {
    return null;
  }
})();

const hasToken = () => !!token && token.expires > Date.now() + 60_000;

let gis: Promise<void> | null = null;
function loadGis() {
  gis ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = () => resolve();
    s.onerror = () => {
      gis = null;
      reject(new Error("Couldn't load Google sign-in. Check your connection."));
    };
    document.head.appendChild(s);
  });
  return gis;
}

// Opens Google's consent popup, so only call this from a tap.
async function signIn(): Promise<void> {
  if (!data.google.clientId) throw new Error("Add your Google OAuth Client ID first.");
  await loadGis();
  await new Promise<void>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: data.google.clientId,
      scope: SCOPE,
      callback: (resp: any) => {
        if (resp.error) return reject(new Error(`Google sign-in failed: ${resp.error_description ?? resp.error}`));
        token = { value: resp.access_token, expires: Date.now() + Number(resp.expires_in) * 1000 };
        localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
        resolve();
      },
      error_callback: (err: any) =>
        reject(new Error(err?.type === "popup_closed" ? "Google sign-in was closed." : "Google sign-in didn't open. Allow pop-ups and try again.")),
    });
    // Empty prompt: no consent screen again once the user has already agreed.
    client.requestAccessToken({ prompt: data.google.connected ? "" : "consent" });
  });
}

class GoogleError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call(method: string, url: string, body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token!.value}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    token = null;
    localStorage.removeItem(TOKEN_KEY);
    throw new GoogleError(401, "Google sign-in expired.");
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new GoogleError(res.status, `Google Calendar error: ${detail?.error?.message ?? res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

// ---- mapping -------------------------------------------------------------

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const hhmm = (d: Date) => d.toTimeString().slice(0, 5);

function toEvent(item: CalendarItem) {
  let start, end;
  if (item.time) {
    const s = new Date(`${item.date}T${item.time}:00`);
    const e = new Date(s.getTime() + 3600_000);
    start = { dateTime: `${item.date}T${item.time}:00`, timeZone: tz() };
    end = { dateTime: `${isoDate(e)}T${hhmm(e)}:00`, timeZone: tz() };
  } else {
    start = { date: item.date };
    end = { date: addDays(item.date, 1) }; // Google's all-day end is exclusive
  }
  return {
    summary: (item.done ? DONE : "") + item.title,
    description: item.notes ? `From ThinkingOut: ${item.notes}` : "From ThinkingOut",
    start,
    end,
    extendedProperties: { private: { thinkingoutId: item.id } },
  };
}

function readTimes(ev: any) {
  if (ev.start?.date) {
    return { start: ev.start.date as string, end: addDays(ev.end?.date ?? addDays(ev.start.date, 1), -1), time: null };
  }
  const s = new Date(ev.start.dateTime);
  const e = new Date(ev.end?.dateTime ?? ev.start.dateTime);
  return { start: isoDate(s), end: isoDate(e), time: hhmm(s) };
}

// ---- sync ----------------------------------------------------------------

async function push() {
  for (const id of [...data.google.pendingDeletes]) {
    try {
      await call("DELETE", `${API}/${encodeURIComponent(id)}`);
    } catch (err) {
      // Already gone in Google is fine; anything else is retried next time.
      if (!(err instanceof GoogleError && (err.status === 404 || err.status === 410))) throw err;
    }
    data.google.pendingDeletes = data.google.pendingDeletes.filter((x) => x !== id);
  }

  // Don't flood Google with long-finished items the first time you connect.
  const cutoff = addDays(todayIso(), -PULL_BACK_DAYS);
  for (const item of data.items) {
    if (!item.googleId && item.date < cutoff) continue;
    if (item.googleId && !item.dirty) continue;
    if (item.googleId) {
      try {
        // PATCH keeps anything added in Google (reminders, colour) intact.
        await call("PATCH", `${API}/${encodeURIComponent(item.googleId)}`, toEvent(item));
        item.dirty = false;
        continue;
      } catch (err) {
        if (!(err instanceof GoogleError && (err.status === 404 || err.status === 410))) throw err;
        // Event vanished on Google's side: fall through and create it again.
      }
    }
    const created = await call("POST", API, toEvent(item));
    item.googleId = created.id;
    item.dirty = false;
  }
}

async function pull() {
  const params = new URLSearchParams({
    singleEvents: "true",
    showDeleted: "true",
    maxResults: "2500",
    timeMin: new Date(`${addDays(todayIso(), -PULL_BACK_DAYS)}T00:00:00`).toISOString(),
    timeMax: new Date(`${addDays(todayIso(), PULL_AHEAD_DAYS)}T00:00:00`).toISOString(),
  });
  const all: any[] = [];
  let pageToken = "";
  do {
    if (pageToken) params.set("pageToken", pageToken);
    const page = await call("GET", `${API}?${params}`);
    all.push(...(page.items ?? []));
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);

  const external: GoogleEvent[] = [];
  for (const ev of all) {
    const ours = ev.extendedProperties?.private?.thinkingoutId as string | undefined;
    if (ours) {
      const item = data.items.find((i) => i.id === ours || i.googleId === ev.id);
      if (!item || item.dirty) continue; // local changes win until they're pushed
      if (ev.status === "cancelled") {
        data.items = data.items.filter((i) => i !== item); // deleted in Google
        continue;
      }
      const { start, time } = readTimes(ev);
      const summary: string = ev.summary ?? item.title;
      item.googleId = ev.id;
      item.done = summary.startsWith(DONE);
      item.title = summary.replace(DONE, "");
      item.date = start;
      item.time = time;
    } else if (ev.status !== "cancelled") {
      external.push({ id: ev.id, title: ev.summary ?? "(no title)", ...readTimes(ev), link: ev.htmlLink ?? "" });
    }
  }
  data.google.events = external;
}

let running: Promise<SyncResult> | null = null;
type SyncResult = "synced" | "needs-sign-in" | "off";

// interactive = started by a tap, so it may open the Google sign-in popup.
export function sync(interactive: boolean): Promise<SyncResult> {
  if (!interactive && !data.google.connected) return Promise.resolve("off");
  if (!interactive && !hasToken()) return Promise.resolve("needs-sign-in");
  running ??= (async (): Promise<SyncResult> => {
    try {
      if (!hasToken()) await signIn();
      data.google.connected = true;
      await push();
      await pull();
      data.google.lastSync = new Date().toISOString();
      return "synced";
    } catch (err) {
      if (err instanceof GoogleError && err.status === 401 && !interactive) return "needs-sign-in";
      throw err;
    } finally {
      save();
      running = null;
    }
  })();
  return running;
}

// After local edits, push quietly in the background if we're signed in.
let timer: number | undefined;
export function syncSoon() {
  if (!data.google.connected || !hasToken()) return;
  if (!data.items.some((i) => i.dirty) && !data.google.pendingDeletes.length) return;
  clearTimeout(timer);
  timer = window.setTimeout(() => sync(false).catch(() => {}), 1500);
}

export function disconnect() {
  if (token && typeof google !== "undefined") google.accounts.oauth2.revoke(token.value, () => {});
  token = null;
  localStorage.removeItem(TOKEN_KEY);
  // Items keep their googleId so reconnecting updates the same events instead of duplicating them.
  data.google = { ...data.google, connected: false, events: [], lastSync: null };
  save();
}

export const googleStatus = () => ({
  connected: data.google.connected,
  signedIn: hasToken(),
  lastSync: data.google.lastSync,
});

export const eventsOn = (day: string) =>
  data.google.events.filter((e) => e.start <= day && day <= e.end).sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
