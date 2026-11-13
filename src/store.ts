import { exportImages, importImages } from "./images";

// All data lives in this browser's localStorage. Nothing leaves the device
// except the transcript text sent to Claude when you ask for it to be sorted.

export interface ActionItem {
  text: string;
  date: string | null; // YYYY-MM-DD
  time: string | null; // HH:MM
}

export interface Analysis {
  title: string;
  summary: string;
  keyThoughts: string[];
  themes: string[];
  decisions: string[];
  openQuestions: string[];
  actions: ActionItem[];
  loops: string[];
  nextStep: string;
}

export interface Session {
  id: string;
  createdAt: string; // ISO
  topicId: string | null;
  transcript: string;
  analysis: Analysis | null;
  addedActions: number[]; // indexes of actions already put on the calendar
  images?: string[]; // ids in images.ts (IndexedDB)
  collections?: string[]; // ids of the collections this note is in
}

// A folder you name yourself and put notes into (a note can be in several).
export interface Collection {
  id: string;
  name: string;
  createdAt: string;
}

export interface Topic {
  id: string;
  title: string;
  prompts: string[];
  createdAt: string;
}

// A to-do. With a date it also shows on the calendar (and Google Calendar);
// without one it lives only on the to-do list.
export interface CalendarItem {
  id: string;
  title: string;
  date: string | null; // YYYY-MM-DD
  time: string | null;
  notes: string;
  done: boolean;
  sessionId: string | null;
  color?: string | null; // Google Calendar colorId, see colors.ts
  googleId?: string | null; // event id once pushed to Google Calendar
  dirty?: boolean; // changed locally since the last push
}

// An event that lives in Google Calendar and wasn't made here.
export interface GoogleEvent {
  id: string;
  title: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD, inclusive
  time: string | null; // HH:MM, null for all-day
  link: string;
  color?: string | null;
}

export interface GoogleSync {
  clientId: string;
  connected: boolean;
  lastSync: string | null; // ISO
  events: GoogleEvent[];
  pendingDeletes: string[]; // Google event ids to delete on next push
}

export interface Settings {
  apiKey: string;
  model: string;
  budget?: { limit: number; month: string; spent: number }; // US$, see budget.ts
  markers?: { todo?: string | null; done?: string | null; note?: string | null }; // calendar dot colours
  theme?: "system" | "light" | "dark"; // see theme.ts
}

interface Data {
  sessions: Session[];
  topics: Topic[];
  items: CalendarItem[];
  collections: Collection[];
  settings: Settings;
  google: GoogleSync;
}

const KEY = "thinkingout:v1";

const empty = (): Data => ({
  sessions: [],
  topics: [],
  items: [],
  collections: [],
  settings: { apiKey: "", model: "claude-opus-5-5" },
  google: { clientId: "", connected: false, lastSync: null, events: [], pendingDeletes: [] },
});

function load(): Data {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<Data>;
    return { ...empty(), ...parsed, settings: { ...empty().settings, ...parsed.settings }, google: { ...empty().google, ...parsed.google } };
  } catch {
    return empty();
  }
}

export const data: Data = load();

const listeners = new Set<() => void>();

export function onChange(fn: () => void) {
  listeners.add(fn);
}

// Write to storage without redrawing the screen.
export function persist() {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function save() {
  persist();
  listeners.forEach((fn) => fn());
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export async function exportJson(): Promise<string> {
  const { google: _google, ...rest } = data;
  const images = await exportImages(data.sessions.flatMap((s) => s.images ?? []));
  return JSON.stringify({ ...rest, settings: { ...data.settings, apiKey: "" }, images }, null, 2);
}

export async function importJson(text: string) {
  const incoming = JSON.parse(text) as Partial<Data> & { images?: Record<string, string> };
  if (incoming.images) await importImages(incoming.images);
  data.sessions = incoming.sessions ?? [];
  data.topics = incoming.topics ?? [];
  data.collections = incoming.collections ?? [];
  // Restored items are re-pushed as new events if Google is connected on this device.
  data.items = (incoming.items ?? []).map((i) => ({ ...i, googleId: null, dirty: true }));
  save();
}

export function addItem(item: Omit<CalendarItem, "id" | "done">) {
  data.items.push({ ...item, id: uid(), done: false, dirty: true });
  save();
}

export function updateItem(item: CalendarItem, changes: Partial<CalendarItem>) {
  Object.assign(item, changes, { dirty: true });
  // Taking the date off moves it back to the list only, so it leaves Google Calendar.
  if (!item.date && item.googleId) {
    data.google.pendingDeletes.push(item.googleId);
    item.googleId = null;
  }
  if (!item.date) item.time = null;
  save();
}

export function removeItem(item: CalendarItem) {
  data.items = data.items.filter((x) => x.id !== item.id);
  if (item.googleId) data.google.pendingDeletes.push(item.googleId);
  save();
}

// Find a topic by name (ignoring case), or start a new one.
export function topicNamed(name: string): Topic {
  const clean = name.trim();
  const found = data.topics.find((t) => t.title.toLowerCase() === clean.toLowerCase());
  if (found) return found;
  const topic: Topic = { id: uid(), title: clean, prompts: [], createdAt: new Date().toISOString() };
  data.topics.unshift(topic);
  return topic;
}

// Store a fresh analysis on a note: file it under its overarching topic and put
// its to-dos on the to-do list (dated ones then sync to Google Calendar).
export function applyAnalysis(session: Session, analysis: Analysis) {
  session.analysis = analysis;
  if (!session.topicId && analysis.title.trim()) session.topicId = topicNamed(analysis.title).id;
  const existing = new Set(data.items.filter((i) => i.sessionId === session.id).map((i) => i.title.toLowerCase()));
  analysis.actions.forEach((a) => {
    if (existing.has(a.text.toLowerCase())) return; // already there from an earlier sort
    data.items.push({
      id: uid(),
      title: a.text,
      date: a.date,
      time: a.date ? a.time : null,
      notes: noteTitle(session),
      done: false,
      sessionId: session.id,
      dirty: true,
    });
  });
  session.addedActions = analysis.actions.map((_, i) => i);
  save();
}

// A note's title is the topic it's filed under.
export const noteTitle = (s: Session) => topicById(s.topicId)?.title ?? s.analysis?.title ?? "Not sorted yet";

// ---- collections ----------------------------------------------------------

export const collectionById = (id: string) => data.collections.find((c) => c.id === id) ?? null;
export const notesIn = (c: Collection) => data.sessions.filter((s) => s.collections?.includes(c.id));

export function addCollection(name: string): Collection {
  const c: Collection = { id: uid(), name: name.trim(), createdAt: new Date().toISOString() };
  data.collections.unshift(c);
  save();
  return c;
}

export function setInCollection(s: Session, collectionId: string, inIt: boolean) {
  const now = new Set(s.collections ?? []);
  if (inIt) now.add(collectionId);
  else now.delete(collectionId);
  s.collections = [...now];
  save();
}

export function removeCollection(c: Collection) {
  data.collections = data.collections.filter((x) => x.id !== c.id);
  data.sessions.forEach((s) => (s.collections = s.collections?.filter((id) => id !== c.id)));
  save();
}

export const topicById = (id: string | null) => data.topics.find((t) => t.id === id) ?? null;
export const sessionById = (id: string | null) => data.sessions.find((s) => s.id === id) ?? null;
