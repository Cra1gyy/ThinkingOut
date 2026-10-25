import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { data, topicById, type Analysis, type Session } from "./store";
import { todayIso } from "./dates";

const AnalysisSchema = z.object({
  title: z.string().describe("A short title (max ~8 words) for what this session was about"),
  summary: z.string().describe("2-4 sentences, written to the speaker as 'you', capturing where their thinking landed"),
  keyThoughts: z.array(z.string()).describe("The distinct thoughts, each as one clear bullet, de-duplicated and in a sensible order"),
  themes: z.array(z.string()).describe("1-4 word tags for the themes that came up"),
  decisions: z.array(z.string()).describe("Anything the speaker decided or concluded, even tentatively"),
  openQuestions: z.array(z.string()).describe("Questions still unresolved, phrased so they can be answered next time"),
  actions: z
    .array(
      z.object({
        text: z.string().describe("A concrete, doable task or event"),
        date: z.string().nullable().describe("YYYY-MM-DD if a day was mentioned or clearly implied, else null"),
        time: z.string().nullable().describe("HH:MM 24h if a time was mentioned, else null"),
      }),
    )
    .describe("Things to do or schedule"),
  loops: z
    .array(z.string())
    .describe("Thoughts the speaker kept circling back to without moving forward, in this session or compared with earlier sessions"),
  nextStep: z.string().describe("One small, specific thing to do next that would break the loop and move this forward"),
});

const SYSTEM = `You help someone who thinks out loud. They have no inner voice, so they speak their thoughts to make sense of them, and they can get stuck rotating through the same thoughts. You receive a raw speech-to-text transcript, which will be messy: filler words, false starts, repetition, mis-heard words.

Your job is to give their thinking back to them with clarity:
- Pull out each distinct thought as a clean bullet in their own spirit, not generic advice.
- Connect the pieces: notice where separate thoughts are really the same thing, or where one answers another.
- Be honest about loops. If they repeat a worry without new information, or if earlier sessions show the same thought, name it plainly and kindly.
- Capture concrete actions and resolve relative dates ("Friday", "next week", "tomorrow") against today's date. If no date is implied, leave it null.
- Suggest one small next step that moves them out of thinking and into doing.
Keep wording plain and short. Do not invent content that was not said.`;

function client() {
  if (!data.settings.apiKey) throw new Error("Add your Claude API key in Settings first.");
  // This is a personal app: the key is the user's own and stays in their browser.
  return new Anthropic({ apiKey: data.settings.apiKey, dangerouslyAllowBrowser: true });
}

export async function analyse(session: Session): Promise<Analysis> {
  const topic = topicById(session.topicId);
  const earlier = data.sessions
    .filter((s) => s.id !== session.id && s.analysis && (topic ? s.topicId === topic.id : true))
    .slice(0, topic ? 6 : 3)
    .map((s) => `- ${s.createdAt.slice(0, 10)}: ${s.analysis!.title}. ${s.analysis!.summary} Loops: ${s.analysis!.loops.join("; ") || "none"}`);

  const today = new Date();
  const parts = [
    `Today is ${today.toLocaleDateString("en-GB", { weekday: "long" })} ${todayIso()}.`,
    topic
      ? `Topic: ${topic.title}\nKey notes they wanted to think about:\n${topic.prompts.map((p) => `- ${p}`).join("\n") || "(none)"}`
      : "No specific topic; this is a free-form brain dump.",
    earlier.length ? `Earlier sessions${topic ? " on this topic" : ""} (newest first):\n${earlier.join("\n")}` : "",
    `<transcript>\n${session.transcript}\n</transcript>`,
  ];

  const response = await client().beta.messages.parse({
    model: data.settings.model || "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(AnalysisSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: parts.filter(Boolean).join("\n\n") }],
  });

  if (response.stop_reason === "refusal") throw new Error("Claude declined to process this transcript.");
  if (!response.parsed_output) throw new Error("Couldn't read Claude's response. Try again.");
  return response.parsed_output;
}

export function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Your API key was rejected. Check it in Settings.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited. Wait a moment and try again.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Check your connection.";
  if (err instanceof Anthropic.APIError) return `Claude API error: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
