// Free, on-phone sorting: a small open model from Hugging Face (via WebLLM)
// runs in the browser on the phone's GPU. Nothing is sent anywhere and there
// are no tokens to pay for. The model is downloaded once and kept on the
// device. Its reply is forced into the same shape Claude returns, so the rest
// of the app can't tell the difference.
import type { MLCEngineInterface } from "@mlc-ai/web-llm";
import { z } from "zod";
import { AnalysisSchema, buildPrompt, SYSTEM } from "./prompt";
import { data, type Analysis, type Session } from "./store";

export const LOCAL_MODELS: { id: string; label: string }[] = [
  { id: "Qwen3.5-2B-q4f16_1-MLC", label: "Qwen 3.5 2B: recommended (1.1 GB download)" },
  { id: "Qwen3.5-4B-q4f16_1-MLC", label: "Qwen 3.5 4B: sharper, slower, needs a newer phone (2.4 GB)" },
  { id: "Qwen3.5-0.8B-q4f16_1-MLC", label: "Qwen 3.5 0.8B: fastest, least accurate (0.4 GB)" },
];

export const localModel = () => data.settings.localModel || LOCAL_MODELS[0].id;

// How much text the model can hold at once (prompt + reply), in tokens.
const CONTEXT = 8192;
const MAX_REPLY = 1800;
// Rough characters-per-token, to refuse prompts that won't fit before trying.
const CHARS_PER_TOKEN = 3.5;

export const webGpuSupported = () => "gpu" in navigator;

// ---- Loading (and downloading the first time) ----

export interface Progress {
  progress: number; // 0..1
  text: string;
}
const listeners = new Set<(p: Progress | null) => void>();
let current: Progress | null = null;

/** Follow download/loading progress. Called with null when it's finished. Returns an unsubscribe function. */
export function onProgress(fn: (p: Progress | null) => void) {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}
function emit(p: Progress | null) {
  current = p;
  listeners.forEach((fn) => fn(p));
}

let engine: Promise<MLCEngineInterface> | null = null;
let loadedId: string | null = null;

/** Load the chosen model, downloading it first if it isn't on the device yet. */
export function loadModel(id = localModel()): Promise<MLCEngineInterface> {
  if (engine && loadedId === id) return engine;
  const previous = engine;
  loadedId = id;
  engine = (async () => {
    if (!webGpuSupported()) {
      throw new Error("This browser can't run the on-phone model (it needs WebGPU). Use Chrome, or switch to Claude in Settings.");
    }
    // Ask the browser not to clear the model when space runs low.
    navigator.storage?.persist?.().catch(() => {});
    emit({ progress: 0, text: "Starting…" });
    const prev = await previous?.catch(() => null);
    if (prev) {
      await prev.reload(id, { context_window_size: CONTEXT });
      return prev;
    }
    const webllm = await import("@mlc-ai/web-llm");
    const worker = new Worker(new URL("./llm-worker.ts", import.meta.url), { type: "module" });
    return webllm.CreateWebWorkerMLCEngine(
      worker,
      id,
      { initProgressCallback: (r) => emit({ progress: r.progress, text: r.text }) },
      { context_window_size: CONTEXT },
    );
  })();
  engine.then(
    () => emit(null),
    () => {
      emit(null);
      engine = null;
      loadedId = null;
    },
  );
  return engine;
}

export async function isDownloaded(id = localModel()): Promise<boolean> {
  const webllm = await import("@mlc-ai/web-llm");
  return webllm.hasModelInCache(id);
}

export async function deleteModel(id = localModel()) {
  if (loadedId === id) {
    (await engine?.catch(() => null))?.unload();
    engine = null;
    loadedId = null;
  }
  const webllm = await import("@mlc-ai/web-llm");
  await webllm.deleteModelAllInfoInCache(id);
}

// ---- Sorting ----

// Small models can't read the schema's descriptions the way Claude does, so
// spell out each field in the instructions as well.
const FIELD_GUIDE = Object.entries(AnalysisSchema.shape)
  .map(([key, field]) => `- ${key}: ${field.description ?? ""}`)
  .join("\n");

const LOCAL_SYSTEM = `${SYSTEM}

Reply with only a JSON object with these fields:
${FIELD_GUIDE}
For actions, each item has "text", "date" (YYYY-MM-DD or null) and "time" (HH:MM or null).
Use empty lists where nothing fits. Every bullet must come from what they actually said.
Write each bullet as one short line in your own words, under 20 words. Never copy long stretches of the transcript. Never repeat a bullet, in the same list or across lists.
Work out dates carefully from today's date: "tomorrow" is the day after today, "next Friday" is the coming Friday. Leave time null unless they said a time.`;

// Small models can get stuck repeating a bullet forever. Capping how many
// bullets each list can have, and how long each bit of text can be, is enforced
// while the reply is generated, so it always finishes.
const LIMITS: Record<string, { items?: number; chars: number }> = {
  title: { chars: 60 },
  summary: { chars: 600 },
  keyThoughts: { items: 8, chars: 220 },
  themes: { items: 4, chars: 40 },
  decisions: { items: 5, chars: 220 },
  openQuestions: { items: 5, chars: 220 },
  actions: { items: 6, chars: 160 },
  loops: { items: 4, chars: 220 },
  nextStep: { chars: 220 },
};

type JsonSchema = { type?: string | string[]; properties?: Record<string, JsonSchema>; items?: JsonSchema; maxItems?: number; maxLength?: number; anyOf?: JsonSchema[] };

function capStrings(s: JsonSchema, chars: number) {
  if (s.type === "string") s.maxLength = chars;
  s.anyOf?.forEach((a) => capStrings(a, chars));
  if (s.items) capStrings(s.items, chars);
  Object.entries(s.properties ?? {}).forEach(([key, p]) => (key === "date" || key === "time" ? null : capStrings(p, chars)));
}

const JSON_SCHEMA = (() => {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(AnalysisSchema) as Record<string, unknown> & JsonSchema;
  for (const [key, limit] of Object.entries(LIMITS)) {
    const field = schema.properties?.[key];
    if (!field) continue;
    if (limit.items) field.maxItems = limit.items;
    capStrings(field, limit.chars);
  }
  return JSON.stringify(schema);
})();

// The model can only do one thing at a time, so sorts wait their turn.
let queue: Promise<unknown> = Promise.resolve();

export function analyseLocal(session: Session): Promise<Analysis> {
  const run = queue.then(() => sortOne(session));
  queue = run.catch(() => {});
  return run;
}

async function sortOne(session: Session): Promise<Analysis> {
  const imageCount = session.images?.length ?? 0;
  if (!session.transcript.trim() && imageCount) {
    throw new Error("The on-phone model can't read images yet. Switch to Claude in Settings to sort image-only notes.");
  }
  let content = buildPrompt(session, true);
  if (imageCount) {
    content += `\n\n(They also attached ${imageCount} image${imageCount > 1 ? "s" : ""} you can't see. Don't guess what's in them.)`;
  }
  if ((LOCAL_SYSTEM.length + content.length) / CHARS_PER_TOKEN > CONTEXT - MAX_REPLY) {
    throw new Error("This one's too long for the on-phone model. Split it into shorter notes, or sort it with Claude.");
  }
  // Don't start a 1 GB download from a sort (it might be on mobile data);
  // that's what the Download button in Settings is for.
  if (loadedId !== localModel() && !(await isDownloaded())) {
    throw new Error("Download the on-phone model first: Settings → Sorting.");
  }

  let text: string;
  let finish: string | null | undefined;
  try {
    const ai = await loadModel();
    const reply = await ai.chat.completions.create({
      messages: [
        { role: "system", content: LOCAL_SYSTEM },
        { role: "user", content },
      ],
      response_format: { type: "json_object", schema: JSON_SCHEMA },
      max_tokens: MAX_REPLY,
      temperature: 0.3,
      extra_body: { enable_thinking: false },
    });
    await ai.resetChat();
    text = reply.choices[0]?.message.content ?? "";
    finish = reply.choices[0]?.finish_reason;
  } catch (err) {
    console.error("On-phone model error:", err);
    throw new Error(`The on-phone model stopped with an error: ${errorText(err)}`);
  }

  if (finish === "length") {
    console.warn("On-phone model hit its reply limit:", text);
    throw new Error(`The on-phone model ran out of room for this note. Try Re-sort, or sort it with Claude. (It wrote: ${snippet(text)})`);
  }
  try {
    // Qwen may put an empty <think></think> block before the JSON.
    return tidy(AnalysisSchema.parse(JSON.parse(text.slice(text.indexOf("{")))), session.transcript);
  } catch {
    console.warn("On-phone model gave a reply that didn't fit:", text);
    throw new Error(`The on-phone model's reply didn't come out right. Try Re-sort. (It wrote: ${snippet(text)})`);
  }
}

// Small models often repeat a bullet, or repeat it with a bit more on the end.
// Keep the first of any near-duplicates.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

function dedupe<T>(items: T[], text: (t: T) => string): T[] {
  const kept: { item: T; key: string }[] = [];
  for (const item of items) {
    const key = norm(text(item));
    if (!key || kept.some((k) => k.key.includes(key) || key.includes(k.key))) continue;
    kept.push({ item, key });
  }
  return kept.map((k) => k.item);
}

// Small models like to invent a time for every to-do. Only keep times when a
// time was actually mentioned.
const MENTIONS_TIME = /\b\d{1,2}(:\d{2})?\s*(am|pm)\b|\b\d{1,2}:\d{2}\b|o'?clock|\bnoon\b|midday|midnight|half past|quarter (past|to)/i;

function tidy(a: Analysis, transcript: string): Analysis {
  const same = (s: string) => s;
  const keepTimes = MENTIONS_TIME.test(transcript);
  return {
    ...a,
    actions: dedupe(a.actions, (x) => x.text).map((x) => (keepTimes ? x : { ...x, time: null })),
    keyThoughts: dedupe(a.keyThoughts, same),
    themes: dedupe(a.themes, same),
    decisions: dedupe(a.decisions, same),
    openQuestions: dedupe(a.openQuestions, same),
    loops: dedupe(a.loops, same),
  };
}

const snippet = (text: string) => JSON.stringify(text.length > 160 ? `${text.slice(0, 80)} … ${text.slice(-80)}` : text || "nothing");

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") return (err as { message: string }).message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
