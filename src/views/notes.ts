import { isAnalysing, startAnalysis } from "../ai";
import { imageUrl, removeImages, thumb } from "../images";
import { go, h, toast } from "../dom";
import { localDayOf, prettyDate, prettyDateTime } from "../dates";
import { data, noteTitle, save, sessionById, topicById, uid, type Session, type Topic } from "../store";
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
    h(
      "span",
      { class: "note-row-text" },
      h("span", { class: "muted small" }, prettyDateTime(s.createdAt), isAnalysing(s.id) ? " · Analyzing…" : ""),
      h("span", { class: "clamp" }, s.analysis?.summary ?? (s.transcript || "Image")),
    ),
    s.images?.length ? thumb(s.images[0], "note-thumb") : null,
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
      topic ? h("a", { class: "topic-title", href: `#/topic/${topic.id}` }, topic.title) : h("strong", { class: "topic-title" }, "No topic yet"),
      h("span", { class: "muted small" }, `${notes.length} note${notes.length === 1 ? "" : "s"}${openTodos ? ` · ${openTodos} to-do` : ""}`),
    ),
    // Notes from before topics were automatic, or never sorted.
    topic ? null : h("p", { class: "muted small" }, "Open one and tap Re-sort (or Make sense of it) to file it under a topic and add its to-dos."),
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

  const busy = isAnalysing(s.id);
  const sortBtn = h(
    "button",
    { class: s.analysis ? "" : "primary", disabled: busy, onclick: () => startAnalysis(s) },
    busy ? "Analyzing…" : s.analysis ? "Re-sort" : "Make sense of it",
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
    h("h1", null, busy && !s.analysis ? "New note" : noteTitle(s)),
    h("div", { class: "row between" }, h("span", { class: "muted" }, prettyDateTime(s.createdAt)), h("label", { class: "inline" }, "Filed under ", filed)),
    s.images?.length
      ? h(
          "div",
          { class: "gallery" },
          s.images.map((id) => h("button", { class: "gallery-item", "aria-label": "Open image", onclick: () => viewImage(id) }, thumb(id, "gallery-img"))),
        )
      : null,
    busy
      ? h("div", { class: "block analysing" }, h("span", { class: "spinner" }), "Analyzing… you can leave this page; the note fills in when it's done.")
      : editing.has(s.id)
        ? editForm(s)
        : analysisCard(s),
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
      s.analysis && !busy && !editing.has(s.id)
        ? h(
            "button",
            {
              onclick: () => {
                editing.add(s.id);
                save();
              },
            },
            "Edit",
          )
        : null,
      h("button", { onclick: () => shareNote(s) }, "Share"),
      h("button", { onclick: () => go(`#/talk?topic=${s.topicId ?? ""}&start=1`) }, "Keep talking on this"),
      h(
        "button",
        {
          class: "ghost danger",
          onclick: () => {
            if (!confirm("Delete this note? Its to-dos stay on your list.")) return;
            data.sessions = data.sessions.filter((x) => x.id !== s.id);
            removeImages(s.images ?? []);
            save();
            go("#/notes");
          },
        },
        "Delete",
      ),
    ),
  );
}

// ---- editing and sharing -------------------------------------------------

const editing = new Set<string>();
const toLines = (items: string[]) => items.join("\n");

// Claude's sort isn't always right: every part of it can be corrected by hand.
function editForm(s: Session) {
  const a = s.analysis!;
  const field = (label: string, value: string, rows = 3) => {
    const input = h("textarea", { rows, value });
    return { input, el: h("label", null, label, input) };
  };
  const summary = field("Summary", a.summary);
  const next = field("One next step", a.nextStep, 2);
  const thoughts = field("Your thoughts (one per line)", toLines(a.keyThoughts), 5);
  const loops = field("You keep coming back to (one per line)", toLines(a.loops));
  const decided = field("Decided (one per line)", toLines(a.decisions));
  const open = field("Still open (one per line)", toLines(a.openQuestions));
  const done = () => {
    editing.delete(s.id);
    save();
  };
  return h(
    "section",
    { class: "block form" },
    h("h3", null, "Edit note"),
    summary.el,
    next.el,
    thoughts.el,
    loops.el,
    decided.el,
    open.el,
    h(
      "div",
      { class: "row" },
      h(
        "button",
        {
          class: "primary",
          onclick: () => {
            Object.assign(a, {
              summary: summary.input.value.trim(),
              nextStep: next.input.value.trim(),
              keyThoughts: lines(thoughts.input.value),
              loops: lines(loops.input.value),
              decisions: lines(decided.input.value),
              openQuestions: lines(open.input.value),
            });
            done();
            toast("Note updated");
          },
        },
        "Save",
      ),
      h("button", { class: "ghost", onclick: done }, "Cancel"),
    ),
  );
}

export function noteMarkdown(s: Session) {
  const a = s.analysis;
  const list = (title: string, items: string[]) => (items.length ? `\n## ${title}\n${items.map((i) => `- ${i}`).join("\n")}\n` : "");
  const todos = data.items.filter((i) => i.sessionId === s.id);
  return [
    `# ${noteTitle(s)}`,
    `_${prettyDateTime(s.createdAt)}_`,
    a ? `\n${a.summary}\n` : "",
    a?.nextStep ? `**Next step:** ${a.nextStep}\n` : "",
    a ? list("Thoughts", a.keyThoughts) : "",
    a ? list("Keep coming back to", a.loops) : "",
    a ? list("Decided", a.decisions) : "",
    a ? list("Still open", a.openQuestions) : "",
    todos.length ? `\n## To-do\n${todos.map((i) => `- [${i.done ? "x" : " "}] ${i.title}${i.date ? ` (${prettyDate(i.date)}${i.time ? ` ${i.time}` : ""})` : ""}`).join("\n")}\n` : "",
    s.transcript ? `\n## What I said\n${s.transcript}\n` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function shareNote(s: Session) {
  const text = noteMarkdown(s);
  try {
    if (navigator.share) {
      await navigator.share({ title: noteTitle(s), text });
      return;
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return; // closed the share sheet
  }
  await navigator.clipboard?.writeText(text);
  toast("Copied as Markdown");
}

// Full-screen image viewer; tap anywhere to close.
async function viewImage(id: string) {
  const url = await imageUrl(id);
  if (!url) return;
  const overlay = h("div", { class: "lightbox", role: "dialog", "aria-label": "Image", onclick: () => overlay.remove() }, h("img", { src: url, alt: "" }));
  document.body.appendChild(overlay);
}
