import "./style.css";
import { applyMarkerColors } from "./colors";
import { applyTheme } from "./theme";
import { todayIso } from "./dates";
import { h } from "./dom";
import { icon, type IconName } from "./icons";
import { startLiveSync, sync, syncSoon } from "./google";
import { onChange } from "./store";
import { calendarView } from "./views/calendar";
import { settingsView } from "./views/settings";
import { talkView } from "./views/talk";
import { collectionView, collectionsView } from "./views/collections";
import { noteView, notesView } from "./views/notes";
import { resetDailyEditor } from "./views/daily";
import { resetEditor, todoView } from "./views/todo";
import { topicView } from "./views/topics";

const TABS: [string, IconName, string][] = [
  ["talk", "mic", "Talk"],
  ["notes", "notes", "Notes"],
  ["todo", "todo", "To-do"],
  ["calendar", "calendar", "Calendar"],
  ["settings", "settings", "Settings"],
];

const SECTION_OF: Record<string, string> = { note: "notes", topic: "notes", collection: "notes", collections: "notes" };
// Old links (shortcuts, bookmarks) from before Thoughts and Topics became Notes.
const ALIASES: Record<string, string> = { thoughts: "notes", topics: "notes", thought: "note" };

const main = h("main");
const nav = h("nav", { class: "tabs" });
document.getElementById("app")!.append(main, nav);

function route() {
  const [path, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const [name = "talk", id = ""] = path.split("/");
  const params = new URLSearchParams(query);
  return { name: ALIASES[name] ?? (name || "talk"), id, params };
}

function render() {
  applyTheme();
  applyMarkerColors();
  const { name, id, params } = route();
  const view =
    name === "note" ? noteView(id)
    : name === "topic" ? topicView(id)
    : name === "collection" ? collectionView(id, params)
    : name === "notes" ? notesView()
    : name === "collections" ? collectionsView()
    : name === "todo" ? todoView()
    : name === "calendar" ? calendarView(params)
    : name === "settings" ? settingsView()
    : talkView(params);
  main.replaceChildren(view);

  const section = SECTION_OF[name] ?? name;
  nav.replaceChildren(
    ...TABS.map(([tab, glyph, label]) =>
      h(
        "a",
        { href: `#/${tab}`, class: section === tab ? "on" : "", "aria-current": section === tab ? "page" : null },
        icon(glyph, "tab-icon"),
        h("span", null, label),
      ),
    ),
  );
}

let lastHash = "";
window.addEventListener("hashchange", () => {
  resetEditor();
  resetDailyEditor();
  render();
  if (location.hash !== lastHash) window.scrollTo(0, 0);
  lastHash = location.hash;
});
// The talk view manages its own live state; everything else just re-renders on save.
onChange(() => {
  if (route().name !== "talk") render();
  syncSoon();
});
render();

// Quiet background sync when the app opens or comes back to the foreground.
// It only runs while a Google sign-in is still valid; otherwise the Calendar
// screen shows a button to sign in again.
const backgroundSync = () => sync(false).catch(() => {});
backgroundSync();
startLiveSync();

// When a new day starts, redraw so daily to-dos show unticked again: at
// midnight if the app is open, or on coming back to it on a later day.
let shownDay = todayIso();
const newDayCheck = () => {
  if (todayIso() !== shownDay) {
    shownDay = todayIso();
    if (route().name !== "talk") render();
  }
};
setInterval(newDayCheck, 30_000);
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && newDayCheck());
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && backgroundSync());

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js");
}
