// To-do colours. These are Google Calendar's own event colours (by colorId), so
// a colour picked here shows on the event in Google Calendar too, and a colour
// changed in Google comes back here.

import { h } from "./dom";
import { data } from "./store";

export const COLORS: { id: string; name: string; hex: string }[] = [
  { id: "11", name: "Tomato", hex: "#d50000" },
  { id: "4", name: "Flamingo", hex: "#e67c73" },
  { id: "6", name: "Tangerine", hex: "#f4511e" },
  { id: "5", name: "Banana", hex: "#f6bf26" },
  { id: "2", name: "Sage", hex: "#33b679" },
  { id: "10", name: "Basil", hex: "#0b8043" },
  { id: "7", name: "Peacock", hex: "#039be5" },
  { id: "9", name: "Blueberry", hex: "#3f51b5" },
  { id: "1", name: "Lavender", hex: "#7986cb" },
  { id: "3", name: "Grape", hex: "#8e24aa" },
  { id: "8", name: "Graphite", hex: "#616161" },
];

export const colorHex = (id: string | null | undefined) => COLORS.find((c) => c.id === id)?.hex ?? null;

// Calendar marker colours (Settings → Calendar colours). null = app default.
export const markerDefaults = { todo: null as string | null, done: "2", note: "5" };
export const markers = () => ({ ...markerDefaults, ...data.settings.markers });

// Colour of a to-do: its own, else the default to-do colour, else plain text colour
// (red is kept for recording, today and overdue).
export const todoColor = (color: string | null | undefined) => colorHex(color) ?? colorHex(markers().todo) ?? "var(--text)";

// Apply the marker colours as CSS variables used by the calendar dots.
export function applyMarkerColors() {
  const m = markers();
  const root = document.documentElement.style;
  root.setProperty("--dot-todo", colorHex(m.todo) ?? "var(--text)");
  root.setProperty("--dot-done", colorHex(m.done) ?? "var(--good)");
  root.setProperty("--dot-note", colorHex(m.note) ?? "var(--warn)");
}

// A row of swatches. `none` is the "no colour" choice shown first.
export function swatches(selected: string | null | undefined, onPick: (id: string | null) => void, none = "Default") {
  const row = h("div", { class: "swatches", role: "radiogroup" });
  const pick = (id: string | null) => {
    onPick(id);
    row.querySelectorAll(".swatch").forEach((el) => el.setAttribute("aria-checked", String(el.getAttribute("data-id") === (id ?? ""))));
  };
  row.append(
    h("button", { type: "button", class: "swatch none", role: "radio", "data-id": "", "aria-checked": String(!selected), "aria-label": none, title: none, onclick: () => pick(null) }),
    ...COLORS.map((c) =>
      h("button", {
        type: "button",
        class: "swatch",
        role: "radio",
        "data-id": c.id,
        "aria-checked": String(selected === c.id),
        "aria-label": c.name,
        title: c.name,
        style: `--c:${c.hex}`,
        onclick: () => pick(c.id),
      }),
    ),
  );
  return row;
}
