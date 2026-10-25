import { bulletList, go, h } from "../dom";
import { localDayOf, prettyDate } from "../dates";
import { data, save, topicById, uid } from "../store";

const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

export function topicsView(): HTMLElement {
  const title = h("input", { placeholder: "Topic, e.g. Should I change jobs?" });
  const prompts = h("textarea", { rows: 4, placeholder: "Key notes to talk through, one per line\ne.g. What would I miss?\nWhat scares me about it?" });

  return h(
    "div",
    { class: "view" },
    h("h1", null, "Topics"),
    h("p", { class: "muted" }, "Set up something you want to think about, with a few key notes to prompt you. Then just talk it through."),
    h(
      "div",
      { class: "list" },
      data.topics.length
        ? data.topics.map((t) => {
            const count = data.sessions.filter((s) => s.topicId === t.id).length;
            return h(
              "a",
              { class: "card", href: `#/topic/${t.id}` },
              h("div", { class: "row between" }, h("strong", null, t.title), h("span", { class: "muted small" }, `${count} session${count === 1 ? "" : "s"}`)),
              t.prompts.length ? h("p", { class: "muted clamp" }, t.prompts.join(" · ")) : null,
            );
          })
        : h("p", { class: "empty" }, "No topics yet."),
    ),
    h(
      "form",
      {
        class: "block form",
        onsubmit: (e: Event) => {
          e.preventDefault();
          if (!title.value.trim()) return;
          const id = uid();
          data.topics.unshift({ id, title: title.value.trim(), prompts: lines(prompts.value), createdAt: new Date().toISOString() });
          save();
          go(`#/topic/${id}`);
        },
      },
      h("h3", null, "New topic"),
      title,
      prompts,
      h("button", { class: "primary", type: "submit" }, "Create topic"),
    ),
  );
}

export function topicView(id: string): HTMLElement {
  const t = topicById(id);
  if (!t) return h("div", { class: "view" }, h("p", null, "Topic not found."), h("a", { href: "#/topics" }, "Back"));
  const sessions = data.sessions.filter((s) => s.topicId === t.id);
  const sorted = sessions.filter((s) => s.analysis);

  const titleInput = h("input", { value: t.title });
  const promptsInput = h("textarea", { rows: 5, value: t.prompts.join("\n") });

  return h(
    "div",
    { class: "view" },
    h("a", { href: "#/topics", class: "back" }, "‹ Topics"),
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
    h("h3", null, "Sessions"),
    h(
      "div",
      { class: "list" },
      sessions.length
        ? sessions.map((s) =>
            h(
              "a",
              { class: "card", href: `#/thought/${s.id}` },
              h("div", { class: "row between" }, h("strong", null, s.analysis?.title ?? "Unsorted"), h("span", { class: "muted small" }, prettyDate(localDayOf(s.createdAt)))),
            ),
          )
        : h("p", { class: "empty" }, "No sessions on this yet."),
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
              go("#/topics");
            },
          },
          "Delete topic",
        ),
      ),
    ),
  );
}
