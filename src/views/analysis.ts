import { bulletList, h } from "../dom";
import { addItem, data, noteTitle, type Session } from "../store";
import { todoRow } from "./todo";

// Each action from a note is put on the to-do list when the note is sorted.
// Show the live to-do (tick it, change its date) or, for older notes or one
// you deleted, a button to add it back.
function actionRow(session: Session, index: number) {
  const action = session.analysis!.actions[index];
  const item = data.items.find((i) => i.sessionId === session.id && i.title.toLowerCase() === action.text.toLowerCase());
  if (item) return todoRow(item, true);
  return h(
    "li",
    { class: "item" },
    h("span", { class: "item-body" }, action.text),
    h(
      "button",
      {
        class: "small",
        onclick: () =>
          addItem({ title: action.text, date: action.date, time: action.date ? action.time : null, notes: noteTitle(session), sessionId: session.id }),
      },
      "Add to to-dos",
    ),
  );
}

export function analysisCard(session: Session) {
  const a = session.analysis;
  if (!a) return h("p", { class: "muted" }, "Not sorted yet.");
  return h(
    "div",
    { class: "analysis" },
    h("p", { class: "summary" }, a.summary),
    a.themes.length ? h("div", { class: "tags" }, a.themes.map((t) => h("span", { class: "tag" }, t))) : null,
    a.nextStep
      ? h("section", { class: "block next" }, h("h3", null, "One next step"), h("p", null, a.nextStep))
      : null,
    bulletList("Your thoughts", a.keyThoughts),
    a.loops.length ? bulletList("You keep coming back to", a.loops, "loops") : null,
    bulletList("Decided", a.decisions),
    bulletList("Still open", a.openQuestions),
    a.actions.length
      ? h(
          "section",
          { class: "block" },
          h("h3", null, "On your ", h("a", { href: "#/todo" }, "to-do list")),
          h("ul", { class: "items" }, a.actions.map((_, i) => actionRow(session, i))),
        )
      : null,
  );
}
