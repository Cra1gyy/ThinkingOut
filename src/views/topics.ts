import { bulletList, go, h } from "../dom";
import { todoRow } from "./todo";
import { localDayOf, prettyDate } from "../dates";
import { data, save, topicById } from "../store";

const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

export function topicView(id: string): HTMLElement {
  const t = topicById(id);
  if (!t) return h("div", { class: "view" }, h("p", null, "Topic not found."), h("a", { href: "#/notes" }, "Back"));
  const sessions = data.sessions.filter((s) => s.topicId === t.id);
  const sorted = sessions.filter((s) => s.analysis);
  const todos = data.items.filter((i) => !i.done && sessions.some((s) => s.id === i.sessionId));

  const titleInput = h("input", { value: t.title });
  const promptsInput = h("textarea", { rows: 5, value: t.prompts.join("\n") });

  return h(
    "div",
    { class: "view" },
    h("a", { href: "#/notes", class: "back" }, "‹ Notes"),
    h("h1", null, t.title),
    h("button", { class: "primary big", onclick: () => go(`#/talk?topic=${t.id}&start=1`) }, "🎙  Talk this through"),
    bulletList("Key notes", t.prompts, "prompts"),
    // Everything learned across sessions, so you can see progress rather than re-think it.
    sorted.length
      ? h(
          "div",
          null,
          h("p", { class: "summary" }, `Latest: ${sorted[0].analysis!.summary}`),
          bulletList("Decided so far", sorted.flatMap((s) => s.analysis!.decisions)),
          bulletList("Still open", sorted[0].analysis!.openQuestions),
          bulletList("Recurring loops", [...new Set(sorted.flatMap((s) => s.analysis!.loops))], "loops"),
        )
      : null,
    todos.length ? h("section", { class: "block" }, h("h3", null, "Open to-dos"), h("ul", { class: "items" }, todos.map((i) => todoRow(i, true)))) : null,
    h("h3", null, "Notes"),
    h(
      "div",
      { class: "list" },
      sessions.length
        ? sessions.map((s) =>
            h(
              "a",
              { class: "card", href: `#/note/${s.id}` },
              h("div", { class: "row between" }, h("span", { class: "clamp" }, s.analysis?.summary ?? "Not sorted yet"), h("span", { class: "muted small" }, prettyDate(localDayOf(s.createdAt)))),
            ),
          )
        : h("p", { class: "empty" }, "No notes on this yet."),
    ),
    h(
      "details",
      { class: "block form" },
      h("summary", null, "Edit topic"),
      titleInput,
      promptsInput,
      h(
        "div",
        { class: "row" },
        h(
          "button",
          {
            onclick: () => {
              t.title = titleInput.value.trim() || t.title;
              t.prompts = lines(promptsInput.value);
              save();
            },
          },
          "Save",
        ),
        h(
          "button",
          {
            class: "ghost danger",
            onclick: () => {
              if (!confirm("Delete this topic? Its sessions are kept.")) return;
              data.topics = data.topics.filter((x) => x.id !== t.id);
              sessions.forEach((s) => (s.topicId = null));
              save();
              go("#/notes");
            },
          },
          "Delete topic",
        ),
      ),
    ),
  );
}
