import { describeError, startAnalysis } from "../ai";
import { go, h, toast } from "../dom";
import { icon } from "../icons";
import { addImage, removeImages, takeSharedInbox, thumb } from "../images";
import { listen, speechSupported, type Listener } from "../speech";
import { collectionById, data, save, topicById, uid, type Session } from "../store";
import { newCollection } from "./collections";

// Kept at module level so a capture survives navigating away and back.
const state = {
  topicId: null as string | null,
  collectionId: null as string | null,
  committed: "", // text before the current recording run (typed or earlier runs)
  live: "",
  interim: "",
  listener: null as Listener | null,
  startedAt: 0,
  images: [] as string[],
  sortWhenStopped: false, // set by press-and-hold: letting go saves and sorts
};

const transcript = () => (state.committed + state.live).trim();
const HOLD_MS = 450;

export function talkView(params: URLSearchParams): HTMLElement {
  if (params.has("topic")) state.topicId = params.get("topic") || null;
  if (params.has("collection")) state.collectionId = params.get("collection") || null;
  if (state.collectionId && !collectionById(state.collectionId)) state.collectionId = null;
  const autoStart = params.get("start") === "1";

  const textarea = h("textarea", {
    class: "transcript",
    placeholder: speechSupported
      ? "Tap the mic and talk, or hold it and let go when you're done. You can also type."
      : "Voice isn't supported in this browser. Type here, or use your keyboard's dictation mic.",
    value: transcript(),
    oninput: () => {
      state.committed = textarea.value;
      state.live = "";
    },
  });
  const interim = h("p", { class: "interim muted" });
  const timer = h("span", { class: "timer muted" });
  const micLabel = h("span");
  const mic = h("button", { class: "mic", "aria-label": "Talk: tap to start or stop, or hold and release" }, h("span", { class: "mic-dot" }, icon("mic", "mic-glyph")), micLabel);
  const sortBtn = h("button", { class: "primary", onclick: () => finish(true) }, "Save & sort");
  const saveBtn = h("button", { onclick: () => finish(false) }, "Just save");
  const strip = h("div", { class: "strip" });
  const NEW = "__new__";
  const collectionSelect = h(
    "select",
    {
      "aria-label": "Save into a collection",
      onchange: () => {
        if (collectionSelect.value === NEW) {
          const c = newCollection();
          state.collectionId = c?.id ?? state.collectionId;
          collectionSelect.replaceChildren(...collectionOptions());
        } else state.collectionId = collectionSelect.value || null;
      },
    },
  );
  const collectionOptions = () => [
    h("option", { value: "" }, "No collection"),
    ...data.collections.map((c) => h("option", { value: c.id, selected: c.id === state.collectionId }, c.name)),
    h("option", { value: NEW }, "New collection…"),
  ];
  collectionSelect.append(...collectionOptions());

  const topic = topicById(state.topicId);
  const topicSelect = h(
    "select",
    {
      "aria-label": "Topic",
      onchange: () => {
        state.topicId = topicSelect.value || null;
        go(`#/talk?topic=${state.topicId ?? ""}`);
      },
    },
    h("option", { value: "" }, "Free thinking"),
    data.topics.map((t) => h("option", { value: t.id, selected: t.id === state.topicId }, t.title)),
  );

  // ---- images -------------------------------------------------------------

  async function attach(files: Iterable<Blob>) {
    for (const f of files) {
      try {
        state.images.push(await addImage(f));
      } catch (err) {
        toast(describeError(err));
      }
    }
    renderStrip();
  }

  const picker = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true, onchange: () => attach(picker.files ?? []).then(() => (picker.value = "")) });
  const camera = h("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, onchange: () => attach(camera.files ?? []).then(() => (camera.value = "")) });

  function renderStrip() {
    strip.replaceChildren(
      ...state.images.map((id) =>
        h(
          "div",
          { class: "strip-item" },
          thumb(id),
          h(
            "button",
            {
              class: "strip-remove",
              "aria-label": "Remove image",
              onclick: () => {
                state.images = state.images.filter((x) => x !== id);
                removeImages([id]);
                renderStrip();
              },
            },
            "✕",
          ),
        ),
      ),
      h("button", { class: "strip-add", onclick: () => picker.click() }, icon("image"), h("span", null, "Image")),
      h("button", { class: "strip-add", onclick: () => camera.click() }, icon("camera"), h("span", null, "Camera")),
    );
    refresh();
  }

  // ---- voice --------------------------------------------------------------

  let tick: number | undefined;
  function refresh() {
    const on = !!state.listener;
    mic.classList.toggle("on", on);
    textarea.readOnly = on; // editing mid-recording would fight the recogniser
    micLabel.textContent = on
      ? state.sortWhenStopped
        ? "Listening… let go to save"
        : "Listening… tap to pause"
      : transcript()
        ? "Tap to keep talking, or hold"
        : "Tap to talk, or hold and let go";
    interim.textContent = state.interim;
    sortBtn.disabled = on;
    saveBtn.disabled = on;
    clearInterval(tick);
    if (on) {
      const update = () => {
        const s = Math.floor((Date.now() - state.startedAt) / 1000);
        timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      };
      update();
      tick = window.setInterval(() => (document.body.contains(timer) ? update() : clearInterval(tick)), 1000);
    } else timer.textContent = "";
  }

  function start() {
    if (!speechSupported) {
      textarea.focus();
      toast("Use your keyboard's mic button to dictate");
      return;
    }
    state.committed = textarea.value ? textarea.value.trimEnd() + " " : "";
    state.live = "";
    state.startedAt = Date.now();
    state.listener = listen({
      onText: (finalText, interimText) => {
        state.live = finalText;
        state.interim = interimText;
        textarea.value = state.committed + state.live;
        textarea.scrollTop = textarea.scrollHeight;
        interim.textContent = interimText;
      },
      onError: (msg) => toast(msg),
      onEnd: () => {
        state.committed = state.committed + state.live;
        state.live = "";
        state.interim = "";
        state.listener = null;
        refresh();
        if (state.sortWhenStopped) {
          state.sortWhenStopped = false;
          finish(true);
        }
      },
    });
    refresh();
  }

  // Tap: start / stop. Press and hold: talk while holding, and letting go
  // saves and sorts, like Essential Space's hold-to-record.
  let holdTimer: number | undefined;
  let startedByThisPress = false;
  let held = false;
  mic.addEventListener("contextmenu", (e) => e.preventDefault());
  mic.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    held = false;
    startedByThisPress = !state.listener;
    if (startedByThisPress) start(); // start at once so the first words aren't lost
    holdTimer = window.setTimeout(() => {
      held = true;
      if (state.listener) {
        state.sortWhenStopped = true;
        navigator.vibrate?.(20);
        refresh();
      }
    }, HOLD_MS);
  });
  const release = () => {
    clearTimeout(holdTimer);
    if (held && state.listener) state.listener.stop(); // onEnd saves and sorts
    else if (!held && !startedByThisPress) state.listener?.stop(); // a tap while listening pauses
    held = false;
  };
  mic.addEventListener("pointerup", release);
  mic.addEventListener("pointercancel", release);
  mic.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    if (state.listener) state.listener.stop();
    else start();
  });

  // ---- save ---------------------------------------------------------------

  function finish(withAi: boolean) {
    const text = transcript();
    if (!text && !state.images.length) {
      toast("Say, type or add something first");
      return;
    }
    const session: Session = {
      id: uid(),
      createdAt: new Date().toISOString(),
      topicId: state.topicId,
      transcript: text,
      analysis: null,
      addedActions: [],
      images: state.images,
      collections: state.collectionId ? [state.collectionId] : [],
    };
    data.sessions.unshift(session);
    state.committed = "";
    state.live = "";
    state.images = [];
    save();
    if (withAi) startAnalysis(session); // carries on in the background
    go(`#/note/${session.id}`);
  }

  const view = h(
    "div",
    { class: "view talk" },
    h("header", { class: "page-head" }, h("h1", null, "Think out loud"), topicSelect),
    topic && topic.prompts.length
      ? h(
          "section",
          { class: "prompts" },
          h("h3", null, `Things to talk through: ${topic.title}`),
          h("ul", null, topic.prompts.map((p) => h("li", null, p))),
        )
      : null,
    h("div", { class: "mic-wrap" }, mic, timer),
    textarea,
    interim,
    strip,
    h("label", { class: "inline save-into" }, "Save into ", collectionSelect),
    picker,
    camera,
    h(
      "div",
      { class: "row" },
      sortBtn,
      saveBtn,
      h(
        "button",
        {
          class: "ghost",
          onclick: () => {
            if (state.listener || (!transcript() && !state.images.length) || !confirm("Clear this capture?")) return;
            state.committed = "";
            textarea.value = "";
            removeImages(state.images);
            state.images = [];
            renderStrip();
          },
        },
        "Clear",
      ),
    ),
    !data.settings.apiKey
      ? h("p", { class: "hint" }, "Add your Claude API key in ", h("a", { href: "#/settings" }, "Settings"), " so it can sort your thoughts.")
      : null,
  );

  renderStrip();

  // Something shared in from another app's share sheet (a screenshot, a photo,
  // a link or some text) lands here ready to talk about.
  if (params.get("shared") === "1") {
    history.replaceState(null, "", `#/talk?topic=${state.topicId ?? ""}`);
    takeSharedInbox().then(({ images, text }) => {
      if (text) {
        state.committed = (transcript() ? transcript() + "\n" : "") + text + "\n";
        textarea.value = state.committed;
      }
      if (images.length) attach(images);
      if (images.length || text) toast("Added. Say something about it, or just save.");
    });
  }

  // Opened from a shortcut (e.g. the phone's side button): start listening right away.
  // Some browsers need a tap first; if so the mic button is right there.
  if (autoStart && !state.listener && speechSupported) {
    history.replaceState(null, "", `#/talk?topic=${state.topicId ?? ""}`);
    setTimeout(() => {
      try {
        start();
      } catch {
        /* needs a user gesture */
      }
    }, 300);
  }
  return view;
}
