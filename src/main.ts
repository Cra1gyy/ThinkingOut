import "./style.css";
import { h } from "./dom";
import { sync, syncSoon } from "./google";
import { onChange } from "./store";
import { calendarView } from "./views/calendar";
import { settingsView } from "./views/settings";
import { talkView } from "./views/talk";
import { thoughtsView, thoughtView } from "./views/thoughts";
import { topicsView, topicView } from "./views/topics";

const TABS = [
  ["talk", "🎙", "Talk"],
  ["thoughts", "💭", "Thoughts"],
  ["topics", "📌", "Topics"],
  ["calendar", "📅", "Calendar"],
  ["settings", "⚙︎", "Settings"],
] as const;

const SECTION_OF: Record<string, string> = { thought: "thoughts", topic: "topics" };

const main = h("main");
const nav = h("nav", { class: "tabs" });
document.getElementById("app")!.append(main, nav);

function route() {
  const [path, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const [name = "talk", id = ""] = path.split("/");
  const params = new URLSearchParams(query);
  return { name: name || "talk", id, params };
}

function render() {
  const { name, id, params } = route();
  const view =
    name === "thought" ? thoughtView(id)
    : name === "topic" ? topicView(id)
    : name === "thoughts" ? thoughtsView()
    : name === "topics" ? topicsView()
    : name === "calendar" ? calendarView(params)
    : name === "settings" ? settingsView()
    : talkView(params);
  main.replaceChildren(view);

  const section = SECTION_OF[name] ?? name;
  nav.replaceChildren(
    ...TABS.map(([tab, icon, label]) =>
      h("a", { href: `#/${tab}`, class: section === tab ? "on" : "" }, h("span", { class: "icon" }, icon), h("span", null, label)),
    ),
  );
}

let lastHash = "";
window.addEventListener("hashchange", () => {
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
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && backgroundSync());

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js");
}
