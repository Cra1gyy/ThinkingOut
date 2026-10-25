import { bulletList, h, toast } from "../dom";
import { prettyDate } from "../dates";
import { data, save, uid, type Session } from "../store";

export function addActionToCalendar(session: Session, index: number, date: string) {
  const action = session.analysis!.actions[index];
  data.items.push({
    id: uid(),
    title: action.text,
    date,
    time: action.time,
    notes: session.analysis!.title,
    done: false,
    sessionId: session.id,
  });
  session.addedActions = [...session.addedActions, index];
  save();
  toast(`Added to ${prettyDate(date)}`);
}

function actionRow(session: Session, index: number) {
  const action = session.analysis!.actions[index];
  const added = session.addedActions.includes(index);
  const dateInput = h("input", { type: "date", value: action.date ?? "", "aria-label": "Date" });
  return h(
    "li",
    { class: "action" },
    h("span", { class: "action-text" }, action.text, action.time ? h("span", { class: "muted" }, ` · ${action.time}`) : null),
    added
      ? h("span", { class: "pill done" }, "On calendar")
      : h(
          "span",
          { class: "action-add" },
          dateInput,
          h(
            "button",
            {
              class: "small",
              onclick: () => {
                if (!dateInput.value) {
                  dateInput.focus();
                  toast("Pick a date first");
                  return;
                }
                addActionToCalendar(session, index, dateInput.value);
              },
            },
            "Add",
          ),
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
          h("h3", null, "To do / schedule"),
          h("ul", { class: "actions" }, a.actions.map((_, i) => actionRow(session, i))),
        )
      : null,
  );
}
