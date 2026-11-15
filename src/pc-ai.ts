// Sorting on your own PC: the note goes to your server (server/server.mjs),
// which runs it through a model in Ollama and keeps the result until we fetch
// it. The job id is saved on the note, so if the app is closed mid-sort the
// result is collected next time it opens (see resumePcSorts).

import { AnalysisSchema, buildPrompt } from "./prompt";
import { calendar, JSON_SCHEMA, LOCAL_SYSTEM, tidy } from "./local-ai";
import { imageBase64 } from "./images";
import { data, persist, type Analysis, type Session } from "./store";

// ---- talking to the server ------------------------------------------------------

export const serverConfigured = () => !!(data.settings.serverUrl && data.settings.serverToken);

export async function serverFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!serverConfigured()) throw new Error("Set up your PC's server first: Settings → Your PC.");
  const base = data.settings.serverUrl!.trim().replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(base + path, {
      ...init,
      headers: { Authorization: `Bearer ${data.settings.serverToken!.trim()}`, ...(init.headers ?? {}) },
    });
  } catch {
    throw new Error("Couldn't reach your PC. Check it's on, the server is running, and this phone is connected (e.g. Tailscale is on).");
  }
  if (res.status === 401) throw new Error("Your PC's server didn't accept the key. Copy it again from the server window into Settings → Your PC.");
  return res;
}

export interface Health {
  ok: boolean;
  model?: string;
  vision?: boolean;
  error?: string;
}

let healthCache: { at: number; value: Health } | null = null;

export async function checkServer(fresh = false): Promise<Health> {
  if (!fresh && healthCache && Date.now() - healthCache.at < 5 * 60e3) return healthCache.value;
  const res = await serverFetch("/api/health");
  if (!res.ok) throw new Error(`Your PC's server answered with an error (${res.status}).`);
  const value = (await res.json()) as Health;
  healthCache = { at: Date.now(), value };
  return value;
}

// ---- sorting -----------------------------------------------------------------

const POLL_MS = 2500;
const GIVE_UP_MS = 20 * 60e3;

export async function analysePc(session: Session): Promise<Analysis> {
  if (!session.pcJob) await submit(session);
  const started = Date.now();
  for (;;) {
    const res = await serverFetch(`/api/sort/${encodeURIComponent(session.pcJob!)}`);
    if (res.status === 404) {
      // The server restarted and lost the job: send the note again, once.
      if (Date.now() - started > POLL_MS * 2) throw new Error("Your PC lost this sort (did the server restart?). Try Re-sort.");
      await submit(session);
      continue;
    }
    const job = (await res.json()) as { status: string; result?: { text: string }; error?: string };
    if (job.status === "done") {
      finished(session);
      return parse(job.result?.text ?? "", session);
    }
    if (job.status === "error") {
      finished(session);
      throw new Error(`Your PC couldn't sort this: ${job.error}`);
    }
    if (Date.now() - started > GIVE_UP_MS) throw new Error("Your PC is taking a very long time. It'll be picked up when it finishes, or try Re-sort.");
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

async function submit(session: Session) {
  const health = await checkServer();
  if (!health.ok) throw new Error(health.error ?? "Your PC's server isn't ready.");
  const imageCount = session.images?.length ?? 0;
  if (imageCount && !session.transcript.trim() && !health.vision) {
    throw new Error(`The model on your PC (${health.model}) can't read images. Use a vision model in Ollama, or sort image-only notes with Claude.`);
  }
  let prompt = `${buildPrompt(session)}\n\n${calendar()}`;
  const images = health.vision ? (await Promise.all((session.images ?? []).map(imageBase64))).filter((b): b is string => !!b) : [];
  if (imageCount && !health.vision) {
    prompt += `\n\n(They also attached ${imageCount} image${imageCount > 1 ? "s" : ""} you can't see. Don't guess what's in them.)`;
  }
  const res = await serverFetch("/api/sort", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system: LOCAL_SYSTEM, prompt, schema: JSON.parse(JSON_SCHEMA), images }),
  });
  if (!res.ok) throw new Error(`Your PC's server wouldn't take the note (${res.status}).`);
  session.pcJob = ((await res.json()) as { id: string }).id;
  persist(); // so the job survives the app closing
}

function finished(session: Session) {
  delete session.pcJob;
  persist();
}

function parse(text: string, session: Session): Analysis {
  try {
    // Some models put a <think>…</think> block before the JSON.
    return tidy(AnalysisSchema.parse(JSON.parse(text.slice(text.indexOf("{")))), session.transcript);
  } catch {
    const shown = text.length > 160 ? `${text.slice(0, 80)} … ${text.slice(-80)}` : text || "nothing";
    throw new Error(`Your PC's reply didn't come out right. Try Re-sort. (It wrote: ${JSON.stringify(shown)})`);
  }
}
