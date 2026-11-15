// What a sorted note looks like, and the instructions and context both
// sorting engines (Claude in ai.ts, the on-phone model in local-ai.ts) get.
import { z } from "zod";
import { todayIso } from "./dates";
import { data, topicById, type Session } from "./store";

export const AnalysisSchema = z.object({
  title: z
    .string()
    .describe(
      "The overarching topic that runs through the whole session, as a short name (2-6 words). If it's the same subject as one of the existing topics listed, use that exact name",
    ),
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
    .describe("Things to do or schedule. These go straight onto their to-do list, and dated ones onto their calendar"),
  loops: z
    .array(z.string())
    .describe("Thoughts the speaker kept circling back to without moving forward, in this session or compared with earlier sessions"),
  nextStep: z.string().describe("One small, specific thing to do next that would break the loop and move this forward"),
});

export const SYSTEM = `You help someone who thinks out loud. They have no inner voice, so they speak their thoughts to make sense of them, and they can get stuck rotating through the same thoughts. You receive a raw speech-to-text transcript, which will be messy: filler words, false starts, repetition, mis-heard words.

Your job is to give their thinking back to them with clarity:
- Pull out each distinct thought as a clean bullet in their own spirit, not generic advice.
- Connect the pieces: notice where separate thoughts are really the same thing, or where one answers another.
- Be honest about loops. If they repeat a worry without new information, or if earlier sessions show the same thought, name it plainly and kindly.
- They may attach screenshots or photos of things they want to remember. Treat them as part of what they're capturing: say what matters in them in plain words, and pull out dates, events, tickets, names and to-dos. If there's an image but little or nothing said, the note is about the image.
- Name the one overarching topic the session keeps coming back to. It becomes the note's title and files the note alongside others on the same subject, so reuse an existing topic name whenever it's the same subject.
- Capture concrete actions and resolve relative dates ("Friday", "next week", "tomorrow") against today's date. If no date is implied, leave it null.
- Suggest one small next step that moves them out of thinking and into doing.
Keep wording plain and short. Do not invent content that was not said.`;

// The text both engines get: today's date, the topic or existing topics,
// earlier sessions (for spotting loops) and the transcript. `compact` keeps it
// short enough for the small on-phone model.
export function buildPrompt(session: Session, compact = false): string {
  const topic = topicById(session.topicId);
  const earlier = data.sessions
    .filter((s) => s.id !== session.id && s.analysis && (topic ? s.topicId === topic.id : true))
    .slice(0, compact ? (topic ? 3 : 2) : topic ? 6 : 3)
    .map((s) => `- ${s.createdAt.slice(0, 10)}: ${s.analysis!.title}. ${s.analysis!.summary} Loops: ${s.analysis!.loops.join("; ") || "none"}`);

  // For a free-form brain dump, show the topics they already have so the note
  // can be filed under one of them instead of starting a near-duplicate.
  const known = topic
    ? []
    : data.topics.slice(0, compact ? 15 : 30).map((t) => {
        const latest = data.sessions.find((s) => s.topicId === t.id && s.analysis)?.analysis;
        return `- ${t.title}${latest && !compact ? `: ${latest.summary}` : ""}`;
      });

  const today = new Date();
  const parts = [
    `Today is ${today.toLocaleDateString("en-GB", { weekday: "long" })} ${todayIso()}.`,
    topic
      ? `Topic: ${topic.title}\nKey notes they wanted to think about:\n${topic.prompts.map((p) => `- ${p}`).join("\n") || "(none)"}`
      : `No topic chosen; this is a free-form brain dump.${known.length ? `\nExisting topics:\n${known.join("\n")}` : ""}`,
    earlier.length ? `Earlier sessions${topic ? " on this topic" : ""} (newest first):\n${earlier.join("\n")}` : "",
    session.transcript.trim() ? `<transcript>\n${session.transcript}\n</transcript>` : "(Nothing said or typed. Work from the attached images.)",
  ];
  return parts.filter(Boolean).join("\n\n");
}

