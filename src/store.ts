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
}

const KEY = "thinkingout:v1";

const empty = (): Data => ({
  sessions: [],
  topics: [],
  items: [],
  settings: { apiKey: "", model: "claude-opus-5-5" },
});

function load(): Data {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<Data>;
    return { ...empty(), ...parsed, settings: { ...empty().settings, ...parsed.settings } };
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
  return JSON.stringify({ ...data, settings: { ...data.settings, apiKey: "" } }, null, 2);
}

export function importJson(text: string) {
  const incoming = JSON.parse(text) as Partial<Data>;
  data.sessions = incoming.sessions ?? [];
  data.topics = incoming.topics ?? [];
  data.items = incoming.items ?? [];
  save();
}

export const topicById = (id: string | null) => data.topics.find((t) => t.id === id) ?? null;
export const sessionById = (id: string | null) => data.sessions.find((s) => s.id === id) ?? null;
