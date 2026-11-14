import { swatches, todoColor } from "../colors";
import { h, slideTo, toast } from "../dom";
import { addDays, prettyDate, todayIso } from "../dates";
import { googleStatus, sync } from "../google";
import { icon } from "../icons";

import { addItem, data, doneToday, noteTitle, redraw, removeItem, sessionById, updateItem, type CalendarItem } from "../store";

const byWhen = (a: CalendarItem, b: CalendarItem) =>
  (a.date ?? "9999").localeCompare(b.date ?? "9999") || (a.time ?? "99").localeCompare(b.time ?? "99");

const dayLabel = (iso: string) => {
  const today = todayIso();
  if (iso === today) return "Today";
  if (iso === addDays(today, 1)) return "Tomorrow";
  if (iso === addDays(today, -1)) return "Yesterday";
  return prettyDate(iso);
};

// A compact chip that opens the native date (or time) picker when tapped.
// The real <input> sits invisibly on top so a tap goes straight to it.
function pickerChip(type: "date" | "time", value: string | null, label: string, onPick: (v: string | null) => void, cls = "") {
  const input = h("input", {
    type,
    value: value ?? "",
    class: "chip-input",
    "aria-label": type === "date" ? "Date" : "Time",
    onclick: () => {
      try {
        input.showPicker?.();
      } catch {
        /* the browser opens its own picker */
      }
    },
    onchange: () => onPick(input.value || null),
  });
  return h("label", { class: `pick-chip ${cls}` }, label, input);
}

// The to-do open for editing (only one at a time). Kept here, outside the
// row, so a background redraw (e.g. a Google sync) doesn't lose your changes.
let editing: { id: string; title: string; details: string; date: string | null; time: string | null; color: string | null } | null = null;

function openEditor(item: CalendarItem) {
  editing = { id: item.id, title: item.title, details: item.details ?? "", date: item.date, time: item.time, color: item.color ?? null };
  redraw();
}

// Leaving the page drops an unsaved edit rather than reopening it later.
export function resetEditor() {
  editing = null;
}

function closeEditor() {
  editing = null;
  redraw();
}

// One to-do. Tap it (or its pencil) to open it up and edit everything.
// `showDate` adds the date chip, so it can be rescheduled straight from the list.
export function todoRow(item: CalendarItem, showDate = false): HTMLLIElement {
  if (editing?.id === item.id) return editorRow(item, showDate);
  const session = sessionById(item.sessionId);
  const overdue = !item.done && item.date && item.date < todayIso();
  // Tapping the colour dot opens a row of colours under the to-do.
  const palette = h("div", { class: "item-palette", hidden: true }, swatches(item.color, (c) => updateItem(item, { color: c })));
  const dot = h("button", {
    class: "color-dot",
    "aria-label": "Colour",
    "aria-expanded": "false",
    onclick: () => {
      palette.hidden = !palette.hidden;
      dot.setAttribute("aria-expanded", String(!palette.hidden));
    },
  });
  const body = h(
    "div",
    {
      class: "item-body",
      role: "button",
      tabindex: 0,
      "aria-label": `Edit “${item.title}”`,
      // Chips and links inside keep doing their own thing.
      onclick: (e: Event) => {
        if (!(e.target as HTMLElement).closest("a, label, input, button")) openEditor(item);
      },
      onkeydown: (e: KeyboardEvent) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === body) {
          e.preventDefault();
          openEditor(item);
        }
      },
    },
    h("span", { class: "item-title" }, item.title),
    item.details ? h("span", { class: "item-details" }, item.details) : null,
    h(
      "span",
      { class: "meta" },
      showDate
        ? pickerChip("date", item.date, item.date ? dayLabel(item.date) : "+ Date", (v) => updateItem(item, { date: v }), overdue ? "late" : "")
        : null,
      item.time ? h("span", { class: "meta-time" }, item.time) : null,
      item.googleId ? h("span", { class: "g-synced", title: "On your Google Calendar" }, "G") : null,
      session ? h("a", { class: "meta-link", href: `#/note/${session.id}` }, noteTitle(session)) : item.notes ? h("span", null, item.notes) : null,
    ),
  );
  return h(
    "li",
    // "plain" = no colour of its own: the tick then uses the page colours so it stays visible.
    { class: `item${item.done ? " done" : ""}${todoColor(item.color).startsWith("var(") ? " plain" : ""}`, style: `--c:${todoColor(item.color)}` },
    h("input", { type: "checkbox", class: "check", checked: item.done, "aria-label": "Done", onchange: () => updateItem(item, { done: !item.done }) }),
    body,
    dot,
    h("button", { class: "item-edit", "aria-label": `Edit “${item.title}”`, onclick: () => openEditor(item) }, icon("edit")),
    palette,
  );
}

// The opened-up to-do: text, details, date, time, colour, and save / delete.
function editorRow(item: CalendarItem, showDate: boolean): HTMLLIElement {
  const draft = editing!;
  const session = sessionById(item.sessionId);
  const rebuild = () => li.replaceWith(todoRow(item, showDate));

  const save = () => {
    const title = draft.title.trim();
    if (!title) {
      toast("A to-do needs some text");
      titleInput.focus();
      return;
    }
    editing = null;
    updateItem(item, {
      title,
      details: draft.details.trim() || null,
      date: draft.date,
      time: draft.date ? draft.time : null,
      color: draft.color,
    });
  };

  const titleInput = h("input", {
    class: "edit-title",
    value: draft.title,
    "aria-label": "To-do",
    oninput: () => (draft.title = titleInput.value),
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === "Enter") save();
      if (e.key === "Escape") closeEditor();
    },
  });
  const details = h("textarea", {
    class: "edit-details",
    rows: 2,
    placeholder: "Details",
    value: draft.details,
    "aria-label": "Details",
    oninput: () => (draft.details = details.value),
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === "Escape") closeEditor();
    },
  });

  const li: HTMLLIElement = h(
    "li",
    { class: "item editing", style: `--c:${todoColor(draft.color)}` },
    h("span", { class: "edit-label" }, "Edit to-do"),
    titleInput,
    details,
    h(
      "div",
      { class: "chips-row" },
      pickerChip("date", draft.date, draft.date ? dayLabel(draft.date) : "+ Date", (v) => {
        draft.date = v;
        if (!v) draft.time = null;
        rebuild();
      }, draft.date ? "set" : ""),
      draft.date
        ? pickerChip("time", draft.time, draft.time ?? "+ Time", (v) => {
            draft.time = v;
            rebuild();
          }, draft.time ? "set" : "")
        : null,
      draft.date
        ? h("button", { type: "button", class: "pick-chip", onclick: () => ((draft.date = null), (draft.time = null), rebuild()) }, "Anytime")
        : null,
      h("span", { class: "quick-hint" }, draft.date ? "On your calendar" : "No date"),
    ),
    swatches(draft.color, (c) => {
      draft.color = c;
      li.style.setProperty("--c", todoColor(c));
    }),
    session ? h("a", { class: "meta-link edit-source", href: `#/note/${session.id}` }, `From: ${noteTitle(session)}`) : null,
    h(
      "div",
      { class: "edit-actions" },
      h("button", { type: "button", class: "ghost danger small", onclick: () => ((editing = null), removeItem(item)) }, "Delete"),
      h("button", { type: "button", class: "ghost small", onclick: closeEditor }, "Cancel"),
      h("button", { type: "button", class: "primary small", onclick: save }, "Save"),
    ),
  );
  // Put the cursor in the text the moment it opens.
  requestAnimationFrame(() => {
    if (document.activeElement === document.body) titleInput.focus({ preventScroll: true });
  });
  return li;
}

// Google Calendar status with a sync / sign-in button. Sign-ins last an hour,
// so this is where you get back in when it has run out.
export function syncBar() {
  const status = googleStatus();
  if (!status.connected) {
    return h("p", { class: "muted small" }, "Link your Google Calendar in ", h("a", { href: "#/settings" }, "Settings"), " to see your events here and send dated to-dos there.");
  }
  const btn = h(
    "button",
    {
      class: status.signedIn ? "small" : "small primary",
      onclick: async () => {
        btn.disabled = true;
        btn.textContent = "Syncing…";
        try {
          await sync(true);
          toast("Synced with Google Calendar");
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err));
          btn.disabled = false;
          btn.textContent = "Try again";
        }
      },
    },
    status.signedIn ? "Sync" : "Reconnect",
  );
  const pending = data.items.filter((i) => i.dirty && i.date).length + data.google.pendingDeletes.length;
  const when = status.lastSync ? new Date(status.lastSync).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : null;
  return h(
    "div",
    { class: `sync-bar${status.signedIn ? "" : " stale"}` },
    h("span", { class: `live-dot${status.signedIn ? " on" : ""}` }),
    h(
      "span",
      { class: "sync-text" },
      status.signedIn ? `Google Calendar${when ? ` · ${when}` : ""}` : "Google sign-in expired",
      pending ? ` · ${pending} to send` : "",
    ),
    btn,
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

// The To-do tab has two pages, flicked between with this switch or a swipe:
// all your to-dos, and the daily ones.
export function todoTabs(on: "todo" | "daily") {
  const open = data.items.filter((i) => !i.done).length;
  const daily = data.dailies;
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return h(
    "header",
    { class: "page-head" },
    h("h1", null, "To-do"),
    h(
      "div",
      { class: "seg" },
      h("a", { class: on === "todo" ? "on" : "", href: "#/todo", onclick: (e: Event) => (e.preventDefault(), on !== "todo" && slideTo("#/todo", "left")) }, `To-do ${open}`),
      h(
        "a",
        { class: on === "daily" ? "on" : "", href: "#/daily", onclick: (e: Event) => (e.preventDefault(), on !== "daily" && slideTo("#/daily", "right")) },
        `Daily ${daily.length ? `${pad2(daily.filter(doneToday).length)}/${pad2(daily.length)}` : ""}`.trim(),
      ),
    ),
  );
}

export function todoView(): HTMLElement {
  const today = todayIso();
  const open = data.items.filter((i) => !i.done).sort(byWhen);
  const overdue = open.filter((i) => i.date && i.date < today);
  const dueToday = open.filter((i) => i.date === today);
  const upcoming = open.filter((i) => i.date && i.date > today);
  const anytime = open.filter((i) => !i.date);
  const done = data.items.filter((i) => i.done).sort((a, b) => byWhen(b, a)).slice(0, 30);

  // ---- quick add ----------------------------------------------------------
  const draft = { date: null as string | null, time: null as string | null, color: null as string | null };
  const title = h("input", { class: "quick-input", placeholder: "Add a to-do", required: true, "aria-label": "New to-do" });
  const options = h("div", { class: "quick-options" });
  const palette = h("div", { class: "quick-palette", hidden: true }, swatches(null, (c) => {
    draft.color = c;
    renderOptions();
  }));
  function renderOptions() {
    options.replaceChildren(
      h("span", { class: "chips-row" },
      pickerChip("date", draft.date, draft.date ? dayLabel(draft.date) : "+ Date", (v) => {
        draft.date = v;
        if (!v) draft.time = null;
        renderOptions();
      }, draft.date ? "set" : ""),
      draft.date
        ? pickerChip("time", draft.time, draft.time ?? "+ Time", (v) => {
            draft.time = v;
            renderOptions();
          }, draft.time ? "set" : "")
        : null,
      h(
        "button",
        {
          type: "button",
          class: `pick-chip${draft.color ? " set" : ""}`,
          onclick: () => (palette.hidden = !palette.hidden),
        },
        h("span", { class: "chip-dot", style: `--c:${todoColor(draft.color)}` }),
        "Colour",
      ),
      h("span", { class: "quick-hint" }, draft.date ? "Goes on your calendar" : "Anytime"),
      ),
    );
  }
  renderOptions();

  const quickAdd = h(
    "form",
    {
      class: "quick-add",
      onsubmit: (e: Event) => {
        e.preventDefault();
        addItem({ title: title.value.trim(), date: draft.date, time: draft.date ? draft.time : null, notes: "", sessionId: null, color: draft.color });
        toast(draft.date ? `Added for ${dayLabel(draft.date)}` : "Added");
      },
    },
    h("div", { class: "quick-row" }, title, h("button", { type: "submit", class: "quick-go", "aria-label": "Add" }, icon("plus"))),
    options,
    palette,
  );

  // ---- lists --------------------------------------------------------------
  const section = (label: string, items: CalendarItem[], cls = "") =>
    items.length
      ? h(
          "section",
          { class: `todo-group ${cls}` },
          h("h3", null, label, h("span", { class: "count" }, pad(items.length))),
          h("ul", { class: "items" }, items.map((i) => todoRow(i, true))),
        )
      : null;
  const days = [...new Set(upcoming.map((i) => i.date!))];

  const stat = (n: number, label: string, cls = "") => h("div", { class: `stat ${cls}` }, h("span", { class: "stat-n" }, pad(n)), h("span", { class: "stat-l" }, label));

  const view = h(
    "div",
    { class: "view todo" },
    todoTabs("todo"),
    h("div", { class: "stats" }, stat(overdue.length, "Overdue", overdue.length ? "late" : ""), stat(dueToday.length, "Today"), stat(upcoming.length + anytime.length, "Later")),
    quickAdd,
    syncBar(),
    !open.length && !done.length ? h("p", { class: "empty" }, "Nothing to do yet. To-dos from your notes land here automatically.") : null,
    section("Overdue", overdue, "late"),
    section("Today", dueToday),
    days.map((d) => section(dayLabel(d), upcoming.filter((i) => i.date === d))),
    section("Anytime", anytime),
    done.length
      ? h("details", { class: "todo-group done-group" }, h("summary", null, "Done", h("span", { class: "count" }, pad(done.length))), h("ul", { class: "items" }, done.map((i) => todoRow(i, true))))
      : null,
  );
  return view;
}
