import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { toast } from "./dom";
import { imageBase64 } from "./images";
import { applyAnalysis, data, engine, save, type Analysis, type Session } from "./store";
import { AnalysisSchema, buildPrompt, SYSTEM } from "./prompt";
import { analyseLocal } from "./local-ai";
import { costOf, reserve, settle } from "./budget";

const MAX_OUTPUT_TOKENS = 16000;

function client() {
  if (!data.settings.apiKey) throw new Error("Add your Claude API key in Settings first.");
  // This is a personal app: the key is the user's own and stays in their browser.
  return new Anthropic({ apiKey: data.settings.apiKey, dangerouslyAllowBrowser: true });
}

export async function analyse(session: Session): Promise<Analysis> {
  if (engine() === "local") return analyseLocal(session);
  const images = (await Promise.all((session.images ?? []).map(imageBase64))).filter((b): b is string => !!b);

  const model = data.settings.model || "claude-opus-5-5";
  const content = buildPrompt(session);
  const api = client();
  // No automatic retry on another model if Claude declines: each request is
  // then a single billed attempt, so its cost can be capped up front.
  const reserved = reserve(model, SYSTEM.length + content.length, MAX_OUTPUT_TOKENS, images.length);
  let response;
  try {
    response = await api.messages.parse(
      {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        output_config: { effort: "medium", format: zodOutputFormat(AnalysisSchema) },
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              ...images.map((data) => ({ type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data } })),
              { type: "text" as const, text: content },
            ],
          },
        ],
      },
      { maxRetries: 0 }, // a silent retry would be a second charge
    );
  } catch (err) {
    // An error response from the API means nothing was billed. Anything else
    // (lost connection, timeout) might have been, so the reservation stands.
    if (err instanceof Anthropic.APIError && err.status !== undefined) settle(reserved, 0);
    throw err;
  }
  settle(reserved, costOf(model, response.usage));

  if (response.stop_reason === "refusal") throw new Error("Claude declined to process this transcript.");
  if (!response.parsed_output) throw new Error("Couldn't read Claude's response. Try again.");
  return response.parsed_output;
}

export function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Your API key was rejected. Check it in Settings.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited. Wait a moment and try again.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Check your connection.";
  if (err instanceof Anthropic.APIError) return `Claude API error: ${err.message}`;
  if (err instanceof Error) return err.message;
  // The on-phone model's worker can reject with plain objects or strings.
  if (err && typeof err === "object") {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
    try {
      return JSON.stringify(err);
    } catch {
      /* fall through */
    }
  }
  return String(err);
}

// Sorting runs in the background, like Essential Space's "analyzing" state:
// the note is saved straight away and fills in when Claude replies.
const pending = new Set<string>();

export const isAnalysing = (id: string) => pending.has(id);

export function startAnalysis(session: Session) {
  if (pending.has(session.id)) return;
  pending.add(session.id);
  save();
  analyse(session)
    .then((a) => {
      delete session.sortError;
      if (data.sessions.includes(session)) applyAnalysis(session, a); // skip if deleted meanwhile
    })
    .catch((err) => {
      // Keep the reason on the note too: a toast is gone in a couple of seconds.
      session.sortError = describeError(err);
      console.error("Sorting failed:", err);
      toast(session.sortError);
    })
    .finally(() => {
      pending.delete(session.id);
      save();
    });
}
