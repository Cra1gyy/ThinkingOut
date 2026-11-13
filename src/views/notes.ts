import { analyse, describeError } from "../ai";
import { go, h, toast } from "../dom";
import { localDayOf, prettyDate, prettyDateTime } from "../dates";
import { applyAnalysis, data, noteTitle, save, sessionById, topicById, uid, type Session, type Topic } from "../store";
import { analysisCard } from "./analysis";

// The Notes tab holds two lists: notes (by topic) and the to-do list.
export function notesTabs(on: "notes" | "todo") {
  const open = data.items.filter((i) => !i.done).length;
  return h(
    "header",
    { class: "row between" },
    h("h1", null, on === "notes" ? "Notes" : "To-do"),
    h(
      "div",
      { class: "seg" },
      h("a", { class: on === "notes" ? "on" : "", href: "#/notes" }, "Notes"),
      h("a", { class: on === "todo" ? "on" : "", href: "#/todo" }, `To-do${open ? ` (${open})` : ""}`),
    ),
  );
}

const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

function noteRow(s: Session) {
  return h(
    "a",
    { class: "note-row", href: `#/note/${s.id}` },
    h("span", { class: "muted small" }, prettyDateTime(s.createdAt)),
    h("span", { class: "clamp" }, s.analysis?.summary ?? s.transcript),
  );
}

// A topic and the notes filed under it, newest first.
function topicGroup(topic: Topic | null, notes: Session[]) {
  const openTodos = data.items.filter((i) => !i.done && notes.some((n) => n.id === i.sessionId)).length;
  return h(
    "section",
    { class: "block topic-group" },
    h(
      "div",
      { class: "row between" },
      topic ? h("a", { class: "topic-title", href: `#/topic/${topic.id}` }, topic.title) : h("strong", { class: "topic-title" }, "Not sorted yet"),
      h("span", { class: "muted small" }, `${notes.length} note${notes.length === 1 ? "" : "s"}${openTodos ? ` · ${openTodos} to-do` : ""}`),
    ),
    notes.length ? notes.map(noteRow) : h("p", { class: "muted small" }, "No notes yet. Talk it through from the topic page."),
  );
}

export function notesView(): HTMLElement {
  const list = h("div", { class: "list" });
  const search = h("input", { type: "search", placeholder: "Search your notes…", oninput: () => render() });

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
        noteTitle(s).toLowerCase().includes(q) ||
        JSON.stringify(s.analysis ?? "").toLowerCase().includes(q),
    );
    // Topics ordered by their most recent note; sessions are stored newest first.
    const groups = new Map<string, Session[]>();
    for (const s of matches) groups.set(s.topicId ?? "", [...(groups.get(s.topicId ?? "") ?? []), s]);
    const empties = q ? [] : data.topics.filter((t) => !groups.has(t.id));

    list.replaceChildren(
      ...(groups.size || empties.length
        ? [
            ...[...groups].map(([id, notes]) => topicGroup(topicById(id || null), notes)),
            ...empties.map((t) => topicGroup(t, [])),
          ]
        : [h("p", { class: "empty" }, q ? "Nothing matches." : "No notes yet. Head to Talk and think out loud.")]),
    );
  }
  render();

  const title = h("input", { placeholder: "e.g. Should I change jobs?" });
  const prompts = h("textarea", { rows: 3, placeholder: "Key notes to talk through, one per line (optional)" });

  return h(
    "div",
    { class: "view" },
    notesTabs("notes"),
    recentLoops.length
      ? h(
          "details",
          { class: "block loops" },
          h("summary", null, `Loops from the last two weeks (${recentLoops.length})`),
          h("ul", null, recentLoops.map(({ l, s }) => h("li", null, l, " ", h("a", { href: `#/note/${s.id}`, class: "muted small" }, prettyDate(localDayOf(s.createdAt)))))),
        )
      : null,
    search,
    list,
    h(
      "details",
      { class: "block form" },
      h("summary", null, "+ New topic to think about"),
      h("p", { class: "muted small" }, "Notes are filed under topics automatically. Make one yourself when you want key notes to prompt you while you talk."),
      title,
      prompts,
      h(
        "button",
        {
          class: "primary",
          onclick: () => {
            if (!title.value.trim()) return;
            const id = uid();
            data.topics.unshift({ id, title: title.value.trim(), prompts: lines(prompts.value), createdAt: new Date().toISOString() });
            save();
            go(`#/topic/${id}`);
          },
        },
        "Create topic",
      ),
    ),
  );
}

export function noteView(id: string): HTMLElement {
  const s = sessionById(id);
  if (!s) return h("div", { class: "view" }, h("p", null, "That note was not found."), h("a", { href: "#/notes" }, "Back"));

  const sortBtn = h(
    "button",
    {
      class: s.analysis ? "" : "primary",
      onclick: async () => {
        sortBtn.disabled = true;
        sortBtn.textContent = "Thinking it through…";
        try {
          applyAnalysis(s, await analyse(s));
        } catch (err) {
          toast(describeError(err));
          sortBtn.disabled = false;
          sortBtn.textContent = "Try again";
        }
      },
    },
    s.analysis ? "Re-sort" : "Make sense of it",
  );

  // Lets you re-file a note if it landed under the wrong topic.
  const NEW = "__new__";
  const filed = h(
    "select",
    {
      "aria-label": "Topic",
      onchange: () => {
        if (filed.value === NEW) {
          const name = prompt("New topic name")?.trim();
          if (!name) {
            filed.value = s.topicId ?? "";
            return;
          }
          const t = { id: uid(), title: name, prompts: [], createdAt: new Date().toISOString() };
          data.topics.unshift(t);
          s.topicId = t.id;
        } else s.topicId = filed.value || null;
        save();
      },
    },
    h("option", { value: "" }, "No topic"),
    data.topics.map((t) => h("option", { value: t.id, selected: t.id === s.topicId }, t.title)),
    h("option", { value: NEW }, "New topic…"),
  );

  const editor = h("textarea", { class: "transcript", value: s.transcript });

  return h(
    "div",
    { class: "view" },
    h("a", { href: "#/notes", class: "back" }, "‹ Notes"),
    h("h1", null, noteTitle(s)),
    h("div", { class: "row between" }, h("span", { class: "muted" }, prettyDateTime(s.createdAt)), h("label", { class: "inline" }, "Filed under ", filed)),
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
            if (!confirm("Delete this note? Its to-dos stay on your list.")) return;
            data.sessions = data.sessions.filter((x) => x.id !== s.id);
            save();
            go("#/notes");
          },
        },
        "Delete",
      ),
    ),
  );
}
