import { analyse, describeError } from "../ai";
import { go, h, toast } from "../dom";
import { localDayOf, prettyDate, prettyDateTime } from "../dates";
import { data, save, sessionById, topicById, type Session } from "../store";
import { analysisCard } from "./analysis";

function sessionCard(s: Session) {
  const topic = topicById(s.topicId);
  return h(
    "a",
    { class: "card", href: `#/thought/${s.id}` },
    h("div", { class: "row between" }, h("strong", null, s.analysis?.title ?? "Unsorted thoughts"), h("span", { class: "muted small" }, prettyDateTime(s.createdAt))),
    topic ? h("span", { class: "tag" }, topic.title) : null,
    h("p", { class: "muted clamp" }, s.analysis?.summary ?? s.transcript),
  );
}

export function thoughtsView(): HTMLElement {
  const list = h("div", { class: "list" });
  const search = h("input", {
    type: "search",
    placeholder: "Search your thoughts…",
    oninput: () => render(),
  });

  // Loops from the last fortnight: the things worth breaking out of.
  const cutoff = Date.now() - 14 * 86400000;
  const recentLoops = data.sessions
    .filter((s) => s.analysis && new Date(s.createdAt).getTime() > cutoff)
    .flatMap((s) => s.analysis!.loops.map((l) => ({ l, s })));

  function render() {
    const q = search.value.toLowerCase().trim();
    const matches = data.sessions.filter(
      (s) =>
        !q ||
        s.transcript.toLowerCase().includes(q) ||
        JSON.stringify(s.analysis ?? "").toLowerCase().includes(q),
    );
    const groups = new Map<string, Session[]>();
    for (const s of matches) {
      const day = localDayOf(s.createdAt);
      groups.set(day, [...(groups.get(day) ?? []), s]);
    }
    list.replaceChildren(
      ...(matches.length
        ? [...groups].map(([day, sessions]) => h("section", null, h("h3", { class: "day" }, prettyDate(day)), sessions.map(sessionCard)))
        : [h("p", { class: "empty" }, q ? "Nothing matches." : "Nothing yet. Head to Talk and think out loud.")]),
    );
  }
  render();

  return h(
    "div",
    { class: "view" },
    h("h1", null, "Thoughts"),
    recentLoops.length
      ? h(
          "details",
          { class: "block loops" },
          h("summary", null, `Loops from the last two weeks (${recentLoops.length})`),
          h("ul", null, recentLoops.map(({ l, s }) => h("li", null, l, " ", h("a", { href: `#/thought/${s.id}`, class: "muted small" }, prettyDate(localDayOf(s.createdAt)))))),
        )
      : null,
    search,
    list,
  );
}

export function thoughtView(id: string): HTMLElement {
  const s = sessionById(id);
  if (!s) return h("div", { class: "view" }, h("p", null, "That thought was not found."), h("a", { href: "#/thoughts" }, "Back"));
  const topic = topicById(s.topicId);

  const sortBtn = h(
    "button",
    {
      class: s.analysis ? "" : "primary",
      onclick: async () => {
        sortBtn.disabled = true;
        sortBtn.textContent = "Thinking it through…";
        try {
          s.analysis = await analyse(s);
          s.addedActions = [];
          save();
        } catch (err) {
          toast(describeError(err));
          sortBtn.disabled = false;
          sortBtn.textContent = "Try again";
        }
      },
    },
    s.analysis ? "Re-sort" : "Make sense of it",
  );

  const editor = h("textarea", { class: "transcript", value: s.transcript });

  return h(
    "div",
    { class: "view" },
    h("a", { href: "#/thoughts", class: "back" }, "‹ Thoughts"),
    h("h1", null, s.analysis?.title ?? "Unsorted thoughts"),
    h(
      "p",
      { class: "muted" },
      prettyDateTime(s.createdAt),
      topic ? [" · ", h("a", { href: `#/topic/${topic.id}` }, topic.title)] : null,
    ),
    analysisCard(s),
    h(
      "details",
      { class: "block" },
      h("summary", null, "What you said"),
      editor,
      h(
        "button",
        {
          class: "small",
          onclick: () => {
            s.transcript = editor.value;
            save();
            toast("Transcript saved");
          },
        },
        "Save edits",
      ),
    ),
    h(
      "div",
      { class: "row" },
      sortBtn,
      h("button", { onclick: () => go(`#/talk?topic=${s.topicId ?? ""}&start=1`) }, "Keep talking on this"),
      h(
        "button",
        {
          class: "ghost danger",
          onclick: () => {
            if (!confirm("Delete this session?")) return;
            data.sessions = data.sessions.filter((x) => x.id !== s.id);
            save();
            go("#/thoughts");
          },
        },
        "Delete",
      ),
    ),
  );
}
