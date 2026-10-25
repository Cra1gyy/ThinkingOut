import { h, toast } from "../dom";
import { data, exportJson, importJson, save } from "../store";

const MODELS = [
  ["claude-opus-5-5", "Claude Opus 5.5 (best)"],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5 (cheaper)"],
  ["claude-haiku-5-5", "Claude Haiku 5.5 (cheapest)"],
];

export function settingsView(): HTMLElement {
  const key = h("input", { type: "password", value: data.settings.apiKey, placeholder: "sk-ant-…", autocomplete: "off" });
  const model = h(
    "select",
    null,
    MODELS.map(([id, label]) => h("option", { value: id, selected: id === data.settings.model }, label)),
  );
  const file = h("input", {
    type: "file",
    accept: "application/json",
    onchange: async () => {
      const f = file.files?.[0];
      if (!f || !confirm("Replace everything here with this backup?")) return;
      try {
        importJson(await f.text());
        toast("Backup restored");
      } catch {
        toast("That file isn't a ThinkingOut backup");
      }
    },
  });
  const talkUrl = `${location.origin}${location.pathname}#/talk?start=1`;

  return h(
    "div",
    { class: "view" },
    h("h1", null, "Settings"),
    h(
      "section",
      { class: "block form" },
      h("h3", null, "Claude"),
      h("label", null, "API key", key),
      h("label", null, "Model", model),
      h(
        "p",
        { class: "muted small" },
        "Get a key at console.anthropic.com. It is stored only in this browser and sent only to Anthropic. Transcripts are sent to Claude only when you tap “Make sense of it”.",
      ),
      h(
        "button",
        {
          class: "primary",
          onclick: () => {
            data.settings.apiKey = key.value.trim();
            data.settings.model = model.value;
            save();
            toast("Saved");
          },
        },
        "Save",
      ),
    ),
    h(
      "section",
      { class: "block" },
      h("h3", null, "Start talking from your phone's side button"),
      h(
        "p",
        { class: "small" },
        "On iPhone: Settings → Action Button → Shortcut, then make a Shortcut with “Open URLs” pointing at the link below. On Android, use a home-screen shortcut or a launcher gesture with the same link.",
      ),
      h("code", { class: "copy" }, talkUrl),
      h("button", { class: "small", onclick: () => navigator.clipboard?.writeText(talkUrl).then(() => toast("Copied")) }, "Copy link"),
    ),
    h(
      "section",
      { class: "block form" },
      h("h3", null, "Your data"),
      h("p", { class: "muted small" }, "Everything is saved on this device. Back it up now and then."),
      h(
        "div",
        { class: "row" },
        h(
          "button",
          {
            onclick: () => {
              const a = h("a", {
                href: URL.createObjectURL(new Blob([exportJson()], { type: "application/json" })),
                download: `thinkingout-${new Date().toISOString().slice(0, 10)}.json`,
              });
              a.click();
            },
          },
          "Download backup",
        ),
      ),
      h("label", null, "Restore from backup", file),
    ),
  );
}
