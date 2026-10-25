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
}

export interface Topic {
  id: string;
  title: string;
  prompts: string[];
  createdAt: string;
}

export interface CalendarItem {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  time: string | null;
  notes: string;
  done: boolean;
  sessionId: string | null;
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
}

interface Data {
  sessions: Session[];
  topics: Topic[];
  items: CalendarItem[];
  settings: Settings;
  google: GoogleSync;
}

const KEY = "thinkingout:v1";

const empty = (): Data => ({
  sessions: [],
  topics: [],
  items: [],
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

export function save() {
  localStorage.setItem(KEY, JSON.stringify(data));
  listeners.forEach((fn) => fn());
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function exportJson(): string {
  const { google: _google, ...rest } = data;
  return JSON.stringify({ ...rest, settings: { ...data.settings, apiKey: "" } }, null, 2);
}

export function importJson(text: string) {
  const incoming = JSON.parse(text) as Partial<Data>;
  data.sessions = incoming.sessions ?? [];
  data.topics = incoming.topics ?? [];
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
  save();
}

export function removeItem(item: CalendarItem) {
  data.items = data.items.filter((x) => x.id !== item.id);
  if (item.googleId) data.google.pendingDeletes.push(item.googleId);
  save();
}

export const topicById = (id: string | null) => data.topics.find((t) => t.id === id) ?? null;
export const sessionById = (id: string | null) => data.sessions.find((s) => s.id === id) ?? null;
