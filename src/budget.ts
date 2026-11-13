// Hard monthly spending cap for Claude API calls made by this app.
//
// Before a request we reserve its worst-case cost (a generous over-estimate of
// the input plus every output token it's allowed to produce) and refuse if that
// could take the month over the limit. After a reply we swap the reservation for
// the real cost from the usage Anthropic reports. If we can't tell whether a
// request was billed (e.g. the connection dropped), the reservation is kept, so
// the count can only ever run high, never low.
//
// This cap lives on this device. The account-wide backstop is prepaid credit in
// the Anthropic Console with auto-reload off.

import { data, persist } from "./store";

// US$ per million tokens: [input, output]. Haiku 5.5 is dearer past 100K input.
const PRICES: Record<string, { in: number; out: number; longIn?: number; longOut?: number }> = {
  "claude-opus-5-5": { in: 4, out: 20 },
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, longIn: 0.5, longOut: 2.5 },
};

export const DEFAULT_LIMIT = 2;

interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

export function budget() {
  const b = (data.settings.budget ??= { limit: DEFAULT_LIMIT, month: thisMonth(), spent: 0 });
  if (b.month !== thisMonth()) {
    b.month = thisMonth();
    b.spent = 0;
  }
  return b;
}

function rates(model: string, inputTokens: number) {
  const p = PRICES[model];
  if (!p) throw new Error(`No price known for ${model}, so it can't be kept under your limit.`);
  const long = inputTokens > 100_000;
  return { in: (long && p.longIn) || p.in, out: (long && p.longOut) || p.out };
}

export function costOf(model: string, u: Usage) {
  // Cache writes cost up to 2x input; count them that way to stay on the safe side.
  const input = u.input_tokens + (u.cache_read_input_tokens ?? 0) + 2 * (u.cache_creation_input_tokens ?? 0);
  const r = rates(model, input);
  return (input * r.in + u.output_tokens * r.out) / 1_000_000;
}

// Throws (and spends nothing) if this request could push the month over the limit.
export function reserve(model: string, promptChars: number, maxOutputTokens: number) {
  const b = budget();
  // Real text is about 4 characters per token; assume 2, plus room for the
  // instructions and output schema the API adds.
  const inputTokens = Math.ceil(promptChars / 2) + 4000;
  const r = rates(model, inputTokens);
  const worst = (inputTokens * r.in + maxOutputTokens * r.out) / 1_000_000;
  if (b.spent + worst > b.limit) {
    throw new Error(
      `Stopped to keep you under your $${b.limit.toFixed(2)} monthly limit ($${b.spent.toFixed(2)} used). ` +
        `Raise the limit or pick a cheaper model in Settings.`,
    );
  }
  b.spent += worst;
  persist();
  return worst;
}

// Replace a reservation with what the request actually cost.
export function settle(reserved: number, actual: number) {
  const b = budget();
  b.spent = Math.max(0, b.spent - reserved + actual);
  persist();
}
