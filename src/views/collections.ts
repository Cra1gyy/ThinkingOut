// Collections: folders you name yourself (film ideas, race times…) and put
// notes into, like Essential Space's collections. A note can be in several.

import { go, h, toast } from "../dom";
import { icon } from "../icons";
import { thumb } from "../images";
import { addCollection, collectionById, data, noteTitle, notesIn, removeCollection, save, setInCollection, type Collection, type Session } from "../store";
import { noteRow, notesTabs } from "./notes";

export function newCollection(): Collection | null {
  const name = prompt("Name the collection (e.g. Film ideas)")?.trim();
  return name ? addCollection(name) : null;
}

function collectionCard(c: Collection) {
  const notes = notesIn(c);
  const images = notes.flatMap((s) => s.images ?? []).slice(0, 3);
  return h(
    "a",
    { class: "coll-card", href: `#/collection/${c.id}` },
    h(
      "div",
      { class: `coll-cover n${images.length}` },
      images.length ? images.map((id) => thumb(id, "coll-img")) : h("span", { class: "coll-cover-text" }, notes[0] ? noteTitle(notes[0]) : "Empty"),
    ),
    h("strong", { class: "coll-name" }, c.name),
    h("span", { class: "muted small" }, `${notes.length} note${notes.length === 1 ? "" : "s"}`),
  );
}

// Notes → Collections: a grid of your collections.
export function collectionsView(): HTMLElement {
  return h(
    "div",
    { class: "view" },
    notesTabs("collections"),
    data.collections.length
      ? null
      : h("p", { class: "muted" }, "Collections are folders you name yourself, like film ideas or race times. A note can go in more than one."),
    h(
      "div",
      { class: "coll-grid" },
      data.collections.map(collectionCard),
      h(
        "button",
        {
          class: "coll-card coll-new",
          onclick: () => {
            const c = newCollection();
            if (c) go(`#/collection/${c.id}`);
          },
        },
        icon("plus", "coll-plus"),
        h("span", null, "New collection"),
      ),
    ),
  );
}

// On a note: which collections it's in, with add / remove.
export function collectionChips(s: Session) {
  const mine = data.collections.filter((c) => s.collections?.includes(c.id));
  const others = data.collections.filter((c) => !s.collections?.includes(c.id));
  const NEW = "__new__";
  const add = h(
    "select",
    {
      class: "chip-add",
      "aria-label": "Add to a collection",
      onchange: () => {
        const c = add.value === NEW ? newCollection() : collectionById(add.value);
        if (c) {
          setInCollection(s, c.id, true);
          toast(`Added to ${c.name}`);
        } else add.value = "";
      },
    },
    h("option", { value: "" }, "+ Add to collection"),
    others.map((c) => h("option", { value: c.id }, c.name)),
    h("option", { value: NEW }, "New collection…"),
  );
  return h(
    "div",
    { class: "chips" },
    mine.map((c) =>
      h(
        "span",
        { class: "chip" },
        h("a", { href: `#/collection/${c.id}` }, c.name),
        h("button", { class: "chip-x", "aria-label": `Remove from ${c.name}`, onclick: () => setInCollection(s, c.id, false) }, "✕"),
      ),
    ),
    add,
  );
}

export function collectionView(id: string, params: URLSearchParams): HTMLElement {
  const c = collectionById(id);
  if (!c) return h("div", { class: "view" }, h("p", null, "That collection was not found."), h("a", { href: "#/collections" }, "Back"));
  const notes = notesIn(c);
  const adding = params.get("add") === "1";

  const header = [
    h("a", { href: "#/collections", class: "back" }, "‹ Collections"),
    h("h1", null, c.name),
    h("p", { class: "muted" }, `${notes.length} note${notes.length === 1 ? "" : "s"}`),
  ];

  if (adding) return h("div", { class: "view" }, ...header, addNotesPicker(c));

  return h(
    "div",
    { class: "view" },
    ...header,
    h(
      "div",
      { class: "row" },
      h("button", { class: "primary", onclick: () => go(`#/collection/${c.id}?add=1`) }, "Add notes"),
      h("button", { onclick: () => go(`#/talk?collection=${c.id}`) }, icon("mic"), "Capture into this"),
    ),
    notes.length
      ? h(
          "div",
          { class: "block" },
          notes.map((s) =>
            h(
              "div",
              { class: "coll-row" },
              noteRow(s, true),
              h("button", { class: "ghost small", "aria-label": "Remove from collection", onclick: () => setInCollection(s, c.id, false) }, "✕"),
            ),
          ),
        )
      : h("p", { class: "empty" }, "Nothing in here yet. Add notes you already have, or capture something new straight into it."),
    h(
      "details",
      { class: "block form" },
      h("summary", null, "Rename or delete"),
      h(
        "div",
        { class: "row" },
        h(
          "button",
          {
            onclick: () => {
              const name = prompt("Rename collection", c.name)?.trim();
              if (!name) return;
              c.name = name;
              save();
            },
          },
          "Rename",
        ),
        h(
          "button",
          {
            class: "ghost danger",
            onclick: () => {
              if (!confirm(`Delete “${c.name}”? The notes in it are kept.`)) return;
              removeCollection(c);
              go("#/collections");
            },
          },
          "Delete collection",
        ),
      ),
    ),
  );
}

// Tick notes to add them to the collection.
function addNotesPicker(c: Collection) {
  const chosen = new Set<string>();
  const candidates = data.sessions.filter((s) => !s.collections?.includes(c.id));
  const list = h("div", { class: "pick-list" });
  const addBtn = h("button", { class: "primary", disabled: true }, "Add");
  const search = h("input", { type: "search", placeholder: "Search notes…", oninput: () => render() });

  addBtn.addEventListener("click", () => {
    data.sessions.filter((s) => chosen.has(s.id)).forEach((s) => (s.collections = [...new Set([...(s.collections ?? []), c.id])]));
    save();
    toast(`Added ${chosen.size} to ${c.name}`);
    go(`#/collection/${c.id}`);
  });

  function render() {
    const q = search.value.toLowerCase().trim();
    const shown = candidates.filter((s) => !q || noteTitle(s).toLowerCase().includes(q) || (s.analysis?.summary ?? s.transcript).toLowerCase().includes(q));
    list.replaceChildren(
      ...(shown.length
        ? shown.map((s) =>
            h(
              "label",
              { class: "pick" },
              h("input", {
                type: "checkbox",
                checked: chosen.has(s.id),
                onchange: (e: Event) => {
                  if ((e.target as HTMLInputElement).checked) chosen.add(s.id);
                  else chosen.delete(s.id);
                  addBtn.disabled = !chosen.size;
                  addBtn.textContent = chosen.size ? `Add ${chosen.size}` : "Add";
                },
              }),
              h("span", { class: "note-row-text" }, h("strong", null, noteTitle(s)), h("span", { class: "muted small clamp" }, s.analysis?.summary ?? (s.transcript || "Image"))),
              s.images?.length ? thumb(s.images[0], "note-thumb") : null,
            ),
          )
        : [h("p", { class: "empty" }, candidates.length ? "Nothing matches." : "Every note is already in here.")]),
    );
  }
  render();

  return h(
    "div",
    { class: "form" },
    search,
    list,
    h("div", { class: "row sticky-actions" }, addBtn, h("button", { class: "ghost", onclick: () => go(`#/collection/${c.id}`) }, "Cancel")),
  );
}
