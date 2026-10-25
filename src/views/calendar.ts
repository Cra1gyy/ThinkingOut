import { go, h } from "../dom";
import { addDays, isoDate, localDayOf, parseIso, prettyDate, todayIso } from "../dates";
import { data, save, sessionById, uid, type CalendarItem } from "../store";

const byTime = (a: CalendarItem, b: CalendarItem) => (a.time ?? "99").localeCompare(b.time ?? "99");

function itemRow(item: CalendarItem) {
  const session = sessionById(item.sessionId);
  return h(
    "li",
    { class: `item${item.done ? " done" : ""}` },
    h("input", {
      type: "checkbox",
      checked: item.done,
      "aria-label": "Done",
      onchange: () => {
        item.done = !item.done;
        save();
      },
    }),
    h(
      "div",
      { class: "item-body" },
      h("span", null, item.time ? h("strong", null, `${item.time} `) : null, item.title),
      item.notes || session
        ? h("span", { class: "muted small" }, session ? h("a", { href: `#/thought/${session.id}` }, `From: ${item.notes || "a thought"}`) : item.notes)
        : null,
    ),
    h(
      "button",
      {
        class: "ghost small",
        "aria-label": "Delete",
        onclick: () => {
          data.items = data.items.filter((x) => x.id !== item.id);
          save();
        },
      },
      "✕",
    ),
  );
}

function dayAgenda(day: string) {
  const items = data.items.filter((i) => i.date === day).sort(byTime);
  const sessions = data.sessions.filter((s) => localDayOf(s.createdAt) === day);
  const title = h("input", { placeholder: "Add something…", required: true });
  const time = h("input", { type: "time", "aria-label": "Time" });
  return h(
    "section",
    { class: "block" },
    h("h3", null, day === todayIso() ? `Today · ${prettyDate(day)}` : prettyDate(day)),
    items.length ? h("ul", { class: "items" }, items.map(itemRow)) : h("p", { class: "muted" }, "Nothing planned."),
    sessions.length
      ? h(
          "div",
          { class: "day-thoughts" },
          h("span", { class: "muted small" }, "Thought about: "),
          sessions.map((s) => h("a", { class: "tag", href: `#/thought/${s.id}` }, s.analysis?.title ?? "Unsorted")),
        )
      : null,
    h(
      "form",
      {
        class: "row add",
        onsubmit: (e: Event) => {
          e.preventDefault();
          data.items.push({ id: uid(), title: title.value.trim(), date: day, time: time.value || null, notes: "", done: false, sessionId: null });
          save();
        },
      },
      title,
      time,
      h("button", { type: "submit", class: "primary small" }, "Add"),
    ),
  );
}

export function calendarView(params: URLSearchParams): HTMLElement {
  const selected = params.get("d") ?? todayIso();
  const mode = params.get("v") ?? "month";
  const link = (d: string, v = mode) => `#/calendar?d=${d}&v=${v}`;

  const switcher = h(
    "div",
    { class: "seg" },
    ["month", "week"].map((v) => h("a", { class: v === mode ? "on" : "", href: link(selected, v) }, v === "month" ? "Month" : "Next 7 days")),
  );

  if (mode === "week") {
    const overdue = data.items.filter((i) => !i.done && i.date < todayIso()).sort((a, b) => a.date.localeCompare(b.date));
    return h(
      "div",
      { class: "view" },
      h("header", { class: "row between" }, h("h1", null, "Calendar"), switcher),
      overdue.length
        ? h("section", { class: "block loops" }, h("h3", null, "Carried over"), h("ul", { class: "items" }, overdue.map((i) => [h("li", { class: "muted small" }, prettyDate(i.date)), itemRow(i)])))
        : null,
      Array.from({ length: 7 }, (_, n) => dayAgenda(addDays(todayIso(), n))),
    );
  }

  const sel = parseIso(selected);
  const first = new Date(sel.getFullYear(), sel.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // weeks start on Monday
  const gridStart = isoDate(new Date(first.getFullYear(), first.getMonth(), 1 - offset));
  const monthLabel = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const shiftMonth = (n: number) => isoDate(new Date(sel.getFullYear(), sel.getMonth() + n, 1));
  const thoughtDays = new Set(data.sessions.map((s) => localDayOf(s.createdAt)));

  const cells = Array.from({ length: 42 }, (_, n) => {
    const day = addDays(gridStart, n);
    const d = parseIso(day);
    const items = data.items.filter((i) => i.date === day);
    const open = items.filter((i) => !i.done).length;
    const cls = ["cell", d.getMonth() !== sel.getMonth() && "other", day === todayIso() && "today", day === selected && "sel"].filter(Boolean).join(" ");
    return h(
      "button",
      { class: cls, onclick: () => go(link(day)) },
      h("span", null, d.getDate()),
      h("span", { class: "dots" }, open ? h("i", { class: "dot task" }) : null, items.length && !open ? h("i", { class: "dot done" }) : null, thoughtDays.has(day) ? h("i", { class: "dot thought" }) : null),
    );
  });

  return h(
    "div",
    { class: "view" },
    h("header", { class: "row between" }, h("h1", null, "Calendar"), switcher),
    h(
      "div",
      { class: "row between month-nav" },
      h("a", { class: "button ghost", href: link(shiftMonth(-1)) }, "‹"),
      h("strong", null, monthLabel),
      h("a", { class: "button ghost", href: link(shiftMonth(1)) }, "›"),
    ),
    h("div", { class: "grid weekdays" }, ["M", "T", "W", "T", "F", "S", "S"].map((d) => h("span", null, d))),
    h("div", { class: "grid" }, cells),
    h("p", { class: "legend muted small" }, h("i", { class: "dot task" }), " to do  ", h("i", { class: "dot done" }), " all done  ", h("i", { class: "dot thought" }), " thought session"),
    dayAgenda(selected),
  );
}
