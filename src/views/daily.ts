// Daily to-dos: tick them off each day; they untick themselves when the next
// day starts (see Daily in store.ts). Shown as a card on the To-do tab.

import { swatches, todoColor } from "../colors";
import { h, toast } from "../dom";
import { icon } from "../icons";
import { addDaily, data, doneToday, redraw, removeDaily, streak, toggleDaily, updateDaily, type Daily } from "../store";

const pad = (n: number) => String(n).padStart(2, "0");

// The daily to-do open for editing, kept outside the row like the to-do editor.
let editing: { id: string; title: string; details: string; color: string | null } | null = null;

export function resetDailyEditor() {
  editing = null;
}

function dailyRow(d: Daily): HTMLLIElement {
  if (editing?.id === d.id) return editorRow(d);
  const done = doneToday(d);
  const days = streak(d);
  const open = () => {
    editing = { id: d.id, title: d.title, details: d.details ?? "", color: d.color ?? null };
    redraw();
  };
  const body = h(
    "div",
    {
      class: "item-body",
      role: "button",
      tabindex: 0,
      "aria-label": `Edit “${d.title}”`,
      onclick: open,
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      },
    },
    h("span", { class: "item-title" }, d.title),
    d.details ? h("span", { class: "item-details" }, d.details) : null,
    days >= 2 ? h("span", { class: "meta" }, h("span", { class: "streak" }, `${days} days in a row`)) : null,
  );
  return h(
    "li",
    { class: `item daily${done ? " done" : ""}${todoColor(d.color).startsWith("var(") ? " plain" : ""}`, style: `--c:${todoColor(d.color)}` },
    h("input", { type: "checkbox", class: "check", checked: done, "aria-label": `Done today: ${d.title}`, onchange: () => toggleDaily(d) }),
    body,
    h("button", { class: "item-edit", "aria-label": `Edit “${d.title}”`, onclick: open }, icon("edit")),
  );
}

function editorRow(d: Daily): HTMLLIElement {
  const draft = editing!;
  const close = () => {
    editing = null;
    redraw();
  };
  const save = () => {
    const title = draft.title.trim();
    if (!title) {
      toast("A daily to-do needs some text");
      titleInput.focus();
      return;
    }
    editing = null;
    updateDaily(d, { title, details: draft.details.trim() || null, color: draft.color });
  };
  const titleInput = h("input", {
    class: "edit-title",
    value: draft.title,
    "aria-label": "Daily to-do",
    oninput: () => (draft.title = titleInput.value),
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === "Enter") save();
      if (e.key === "Escape") close();
    },
  });
  const details = h("textarea", {
    class: "edit-details",
    rows: 2,
    placeholder: "Details",
    value: draft.details,
    "aria-label": "Details",
    oninput: () => (draft.details = details.value),
  });
  const li: HTMLLIElement = h(
    "li",
    { class: "item editing", style: `--c:${todoColor(draft.color)}` },
    h("span", { class: "edit-label" }, "Edit daily to-do"),
    titleInput,
    details,
    swatches(draft.color, (c) => {
      draft.color = c;
      li.style.setProperty("--c", todoColor(c));
    }),
    h("span", { class: "edit-source" }, `Every day · ${streak(d)} in a row · ${d.doneOn.length} done in total`),
    h(
      "div",
      { class: "edit-actions" },
      h(
        "button",
        {
          type: "button",
          class: "ghost danger small",
          onclick: () => {
            if (!confirm(`Delete “${d.title}” from your daily to-dos?`)) return;
            editing = null;
            removeDaily(d);
          },
        },
        "Delete",
      ),
      h("button", { type: "button", class: "ghost small", onclick: close }, "Cancel"),
      h("button", { type: "button", class: "primary small", onclick: save }, "Save"),
    ),
  );
  requestAnimationFrame(() => {
    if (document.activeElement === document.body) titleInput.focus({ preventScroll: true });
  });
  return li;
}

export function dailyCard() {
  const list = data.dailies;
  const doneCount = list.filter(doneToday).length;
  const all = list.length > 0 && doneCount === list.length;

  const input = h("input", { class: "daily-input", placeholder: list.length ? "Add a daily to-do" : "Something to do every day, e.g. Stretch 10 min", "aria-label": "New daily to-do", required: true });
  const add = h(
    "form",
    {
      class: "daily-add",
      onsubmit: (e: Event) => {
        e.preventDefault();
        addDaily(input.value);
      },
    },
    input,
    h("button", { type: "submit", class: "daily-go", "aria-label": "Add daily to-do" }, icon("plus")),
  );

  return h(
    "section",
    { class: `todo-group daily-card${all ? " all-done" : ""}` },
    h(
      "div",
      { class: "daily-head" },
      h("h3", null, "Daily", h("span", { class: "daily-reset" }, "Resets at midnight")),
      list.length ? h("span", { class: "daily-count" }, `${pad(doneCount)}/${pad(list.length)}`) : null,
    ),
    // One dot per daily to-do, lit as you tick them off.
    list.length
      ? h("div", { class: "daily-dots", "aria-hidden": "true" }, list.map((d) => h("i", { class: doneToday(d) ? "on" : "" })))
      : null,
    all ? h("p", { class: "daily-done-msg" }, "All done for today") : null,
    list.length ? h("ul", { class: "items" }, list.map(dailyRow)) : null,
    add,
  );
}
