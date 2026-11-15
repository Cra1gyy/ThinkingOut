import { markers, swatches } from "../colors";
import { currentTheme, setTheme, type Theme } from "../theme";
import { h, toast } from "../dom";
import { disconnect, googleStatus, sync } from "../google";
import { budget } from "../budget";
import { data, engine, exportJson, importJson, save } from "../store";
import { deleteModel, isDownloaded, loadModel, LOCAL_MODELS, localModel, onProgress, webGpuSupported } from "../local-ai";

const MODELS = [
  ["claude-opus-5-5", "Opus 5.5: best, about 2–6¢ a sort"],
  ["claude-sonnet-5-5", "Sonnet 5.5: about 1–3¢ a sort"],
  ["claude-haiku-5-5", "Haiku 5.5: under 0.1¢ a sort"],
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
        await importJson(await f.text());
        toast("Backup restored");
      } catch {
        toast("That file isn't a ThinkingOut backup");
      }
    },
  });
  const b = budget();
  const limit = h("input", { type: "number", min: "0", step: "0.5", inputmode: "decimal", value: String(b.limit) });
  const talkUrl = `${location.origin}${location.pathname}#/talk?start=1`;

  return h(
    "div",
    { class: "view" },
    h("h1", null, "Settings"),
    appearanceSection(),
    sortingSection(),
    h(
      "section",
      { class: "block form" },
      h("h3", null, engine() === "claude" ? "Claude" : "Claude (not in use)"),
      h("label", null, "API key", key),
      h("label", null, "Model", model),
      h("label", null, "Monthly spending limit (US$)", limit),
      h(
        "div",
        { class: "meter", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": b.limit, "aria-valuenow": b.spent },
        h("div", { style: `width:${Math.min(100, b.limit ? (b.spent / b.limit) * 100 : 100)}%` }),
      ),
      h(
        "p",
        { class: "muted small" },
        `Used this month: $${b.spent.toFixed(2)} of $${b.limit.toFixed(2)}. The app won't send anything to Claude that could go over the limit, and it resets on the 1st.`,
      ),
      h(
        "p",
        { class: "muted small" },
        "Get a key at console.anthropic.com. It is stored only in this browser and sent only to Anthropic. Notes are sent to Claude only when you tap “Save & sort” (or Re-sort). ",
        h("strong", null, "To make overspending impossible on your account too:"),
        " buy a small amount of prepaid credit (e.g. $5) and leave auto-reload off. Then the most Claude can ever cost is what you've loaded.",
      ),
      h(
        "button",
        {
          class: "primary",
          onclick: () => {
            data.settings.apiKey = key.value.trim();
            data.settings.model = model.value;
            const n = Number(limit.value);
            budget().limit = Number.isFinite(n) && n >= 0 ? n : b.limit;
            save();
            toast("Saved");
          },
        },
        "Save",
      ),
    ),
    googleSection(),
    colourSection(),
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
            onclick: async () => {
              const a = h("a", {
                href: URL.createObjectURL(new Blob([await exportJson()], { type: "application/json" })),
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

function googleSection() {
  const status = googleStatus();
  const clientId = h("input", { value: data.google.clientId, placeholder: "…apps.googleusercontent.com", autocomplete: "off" });
  const connect = h(
    "button",
    {
      class: "primary",
      onclick: async () => {
        data.google.clientId = clientId.value.trim();
        save();
        connect.disabled = true;
        connect.textContent = "Connecting…";
        try {
          await sync(true);
          toast("Google Calendar connected");
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err));
          connect.disabled = false;
          connect.textContent = "Connect Google Calendar";
        }
      },
    },
    "Connect Google Calendar",
  );

  if (status.connected) {
    return h(
      "section",
      { class: "block form" },
      h("h3", null, "Google Calendar"),
      h("p", { class: "small" }, "Connected. Your ThinkingOut to-dos go onto your main Google calendar, and your Google events show up in the Calendar tab. Edits sync both ways."),
      h(
        "div",
        { class: "row" },
        h("a", { class: "button", href: "#/calendar" }, "Open calendar"),
        h(
          "button",
          {
            class: "ghost danger",
            onclick: () => {
              if (!confirm("Stop syncing with Google Calendar? Events already there stay put.")) return;
              disconnect();
              toast("Disconnected");
            },
          },
          "Disconnect",
        ),
      ),
    );
  }

  const origin = location.origin;
  return h(
    "section",
    { class: "block form" },
    h("h3", null, "Google Calendar"),
    h("p", { class: "small" }, "Sync your to-dos to Google Calendar and see your Google events here. It needs a free Google Cloud Client ID, set up once (about 5 minutes):"),
    h(
      "ol",
      { class: "steps small" },
      h("li", null, "Go to ", h("a", { href: "https://console.cloud.google.com/projectcreate", target: "_blank", rel: "noopener" }, "console.cloud.google.com"), " and create a project (any name)."),
      h("li", null, "Turn on the ", h("a", { href: "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com", target: "_blank", rel: "noopener" }, "Google Calendar API"), " for it."),
      h("li", null, "Under ", h("strong", null, "Google Auth Platform"), ", set up the app as ", h("strong", null, "External"), ", then under ", h("strong", null, "Audience"), " add your own Gmail address as a test user."),
      h("li", null, "Under ", h("strong", null, "Clients"), ", create a ", h("strong", null, "Web application"), " client. Under ", h("strong", null, "Authorised JavaScript origins"), " add:", h("code", { class: "copy" }, origin)),
      h("li", null, "Copy the Client ID into the box below and tap Connect."),
    ),
    h("label", null, "Google OAuth Client ID", clientId),
    connect,
  );
}

// Colours for the calendar's markers. Individual to-dos can also have their own.
function colourSection() {
  const m = markers();
  const set = (key: "todo" | "done" | "note") => (id: string | null) => {
    data.settings.markers = { ...data.settings.markers, [key]: id };
    save();
  };
  return h(
    "section",
    { class: "block form" },
    h("h3", null, "Calendar colours"),
    h("p", { class: "muted small" }, "Give any to-do its own colour by tapping its dot. These set the defaults."),
    h("label", null, "To-dos without a colour", swatches(m.todo, set("todo"), "Default (white in dark mode, black in light)")),
    h("label", null, "Days where everything's done", swatches(m.done, set("done"))),
    h("label", null, "Days you made notes", swatches(m.note, set("note"))),
  );
}

// Who sorts your notes: the free on-phone model, or Claude.
function sortingSection() {
  const now = engine();
  const options: ["local" | "claude", string][] = [
    ["local", "On this phone (free)"],
    ["claude", "Claude"],
  ];
  const picker = h(
    "div",
    { class: "seg seg-wide", role: "radiogroup", "aria-label": "Sort notes with" },
    options.map(([value, label]) =>
      h(
        "button",
        {
          type: "button",
          role: "radio",
          "aria-checked": String(now === value),
          class: now === value ? "on" : "",
          onclick: () => {
            data.settings.engine = value;
            save();
          },
        },
        label,
      ),
    ),
  );

  if (now === "claude") {
    return h(
      "section",
      { class: "block form" },
      h("h3", null, "Sorting"),
      picker,
      h("p", { class: "muted small" }, "Notes are sorted by Claude, using your API key below. Each sort costs a little."),
    );
  }

  if (!webGpuSupported()) {
    return h(
      "section",
      { class: "block form" },
      h("h3", null, "Sorting"),
      picker,
      h("p", { class: "hint" }, "This browser can't run the on-phone model: it needs WebGPU. Open the app in Chrome, or switch to Claude."),
    );
  }

  const model = h(
    "select",
    {
      onchange: () => {
        data.settings.localModel = model.value;
        save();
      },
    },
    LOCAL_MODELS.map((m) => h("option", { value: m.id, selected: m.id === localModel() }, m.label)),
  );
  const status = h("p", { class: "small" }, "Checking…");
  const bar = h("div", null);
  const meter = h("div", { class: "meter", hidden: true }, bar);
  const download = h("button", { class: "primary", hidden: true }, "Download model");
  const remove = h("button", { class: "ghost danger", hidden: true }, "Delete from phone");

  const showReady = (ready: boolean) => {
    status.textContent = ready
      ? "Downloaded. Notes are sorted on this phone, free, and nothing leaves it."
      : "Not downloaded yet. It downloads once (use Wi-Fi) and then works offline.";
    download.hidden = ready;
    remove.hidden = !ready;
  };
  isDownloaded().then(showReady, () => showReady(false));

  download.onclick = async () => {
    download.disabled = true;
    try {
      await loadModel();
      const kept = await isDownloaded();
      showReady(kept);
      toast(kept ? "On-phone model ready" : "Model loaded, but this browser didn't keep a copy. It'll need downloading again next time.");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
      download.disabled = false;
    }
  };
  remove.onclick = async () => {
    if (!confirm("Delete the on-phone model? You can download it again any time.")) return;
    await deleteModel();
    showReady(false);
    toast("Deleted");
  };

  const section = h(
    "section",
    { class: "block form" },
    h("h3", null, "Sorting"),
    picker,
    h(
      "p",
      { class: "muted small" },
      "An open AI model from Hugging Face runs on your phone. It's free, private and works offline. It isn't as sharp as Claude, can't read images, and a sort takes longer, but it carries on in the background.",
    ),
    h("label", null, "Model", model),
    status,
    meter,
    h("div", { class: "row" }, download, remove),
  );

  // Follow download/loading progress while this screen is showing.
  queueMicrotask(() => {
    const stop = onProgress((p) => {
      if (!section.isConnected) return stop();
      meter.hidden = !p;
      if (p) {
        bar.style.width = `${Math.round(p.progress * 100)}%`;
        const pct = Math.round(p.progress * 100);
        status.textContent = /fetch/i.test(p.text)
          ? `Downloading… ${pct}%. Keep the app open; it picks up where it left off if it's interrupted.`
          : /load|cache/i.test(p.text)
            ? `Getting the model ready… ${pct}%`
            : p.text;
        download.disabled = true;
      }
    });
  });
  return section;
}

// Light, dark, or follow the phone.
function appearanceSection() {
  const now = currentTheme();
  const options: [Theme, string][] = [
    ["system", "System"],
    ["light", "Light"],
    ["dark", "Dark"],
  ];
  return h(
    "section",
    { class: "block form" },
    h("h3", null, "Appearance"),
    h(
      "div",
      { class: "seg seg-wide", role: "radiogroup", "aria-label": "Appearance" },
      options.map(([value, label]) =>
        h(
          "button",
          { type: "button", role: "radio", "aria-checked": String(now === value), class: now === value ? "on" : "", onclick: () => setTheme(value) },
          label,
        ),
      ),
    ),
    h("p", { class: "muted small" }, now === "system" ? "Following your phone's light or dark mode." : `Always ${now}, whatever your phone is set to.`),
  );
}
