import { swatches, todoColor } from "../colors";
import { h, toast } from "../dom";
import { addDays, prettyDate, todayIso } from "../dates";
import { googleStatus, sync } from "../google";
import { addItem, data, noteTitle, removeItem, sessionById, updateItem, type CalendarItem } from "../store";
import { notesTabs } from "./notes";

const byWhen = (a: CalendarItem, b: CalendarItem) =>
  (a.date ?? "9999").localeCompare(b.date ?? "9999") || (a.time ?? "99").localeCompare(b.time ?? "99");

// One to-do. `showDate` adds a date picker, so it can be scheduled (and synced
// to Google Calendar) or cleared back to "anytime" right from the list.
export function todoRow(item: CalendarItem, showDate = false) {
  const session = sessionById(item.sessionId);
  const date = h("input", {
    type: "date",
    class: "date-chip",
    value: item.date ?? "",
    "aria-label": "Date",
    onchange: () => updateItem(item, { date: date.value || null }),
  });
  // Tapping the colour dot opens a row of colours under the to-do.
  const palette = h("div", { class: "item-palette", hidden: true }, swatches(item.color, (c) => updateItem(item, { color: c })));
  const dot = h("button", {
    class: "color-dot",
    style: `--c:${todoColor(item.color)}`,
    "aria-label": "Colour",
    "aria-expanded": "false",
    onclick: () => {
      palette.hidden = !palette.hidden;
      dot.setAttribute("aria-expanded", String(!palette.hidden));
    },
  });
  return h(
    "li",
    { class: `item${item.done ? " done" : ""}`, style: `--c:${todoColor(item.color)}` },
    dot,
    h("input", { type: "checkbox", checked: item.done, "aria-label": "Done", onchange: () => updateItem(item, { done: !item.done }) }),
    h(
      "div",
      { class: "item-body" },
      h("span", null, item.time ? h("strong", null, `${item.time} `) : null, item.title),
      h(
        "span",
        { class: "muted small meta" },
        showDate ? date : null,
        item.googleId ? h("span", { class: "g-synced", title: "On your Google Calendar" }, "G ✓") : null,
        session ? h("a", { href: `#/note/${session.id}` }, noteTitle(session)) : item.notes || null,
      ),
    ),
    h("button", { class: "ghost small", "aria-label": "Delete", onclick: () => removeItem(item) }, "✕"),
    palette,
  );
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
    status.signedIn ? "Sync now" : "Reconnect",
  );
  const pending = data.items.filter((i) => i.dirty && i.date).length + data.google.pendingDeletes.length;
  const when = status.lastSync ? new Date(status.lastSync).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : null;
  return h(
    "div",
    { class: `row between sync-bar${status.signedIn ? "" : " stale"}` },
    h(
      "span",
      { class: "muted small" },
      status.signedIn ? `Google Calendar · live${when ? `, updated ${when}` : ""}` : "Google sign-in expired. Reconnect to keep it live",
      pending ? ` · ${pending} change${pending === 1 ? "" : "s"} to send` : "",
    ),
    btn,
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

  const title = h("input", { placeholder: "Add a to-do…", required: true });
  let color: string | null = null;
  const date = h("input", { type: "date", "aria-label": "Date (optional)" });
  const time = h("input", { type: "time", "aria-label": "Time (optional)" });

  const section = (label: string, items: CalendarItem[], cls = "") =>
    items.length ? h("section", { class: `block ${cls}` }, h("h3", null, label), h("ul", { class: "items" }, items.map((i) => todoRow(i, true)))) : null;

  // Upcoming grouped by day reads like a short agenda.
  const days = [...new Set(upcoming.map((i) => i.date!))];

  return h(
    "div",
    { class: "view" },
    notesTabs("todo"),
    syncBar(),
    h(
      "form",
      {
        class: "block form",
        onsubmit: (e: Event) => {
          e.preventDefault();
          addItem({ title: title.value.trim(), date: date.value || null, time: date.value ? time.value || null : null, notes: "", sessionId: null, color });
          toast(date.value ? `Added for ${prettyDate(date.value)}` : "Added");
        },
      },
      title,
      h("div", { class: "row nowrap" }, date, time, h("button", { type: "submit", class: "primary" }, "Add")),
      swatches(null, (c) => (color = c)),
      h("p", { class: "muted small hint-inline" }, "Leave the date empty for anytime. Dated to-dos go on your calendar."),
    ),
    !open.length && !done.length ? h("p", { class: "empty" }, "Nothing to do yet. To-dos from your notes land here automatically.") : null,
    section("Overdue", overdue, "loops"),
    section(`Today · ${prettyDate(today)}`, dueToday, "next"),
    days.map((d) => section(d === addDays(today, 1) ? `Tomorrow · ${prettyDate(d)}` : prettyDate(d), upcoming.filter((i) => i.date === d))),
    section("Anytime", anytime),
    done.length
      ? h("details", { class: "block" }, h("summary", null, `Done (${done.length})`), h("ul", { class: "items" }, done.map((i) => todoRow(i, true))))
      : null,
  );
}
