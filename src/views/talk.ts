import { analyse, describeError } from "../ai";
import { go, h, toast } from "../dom";
import { listen, speechSupported, type Listener } from "../speech";
import { data, save, topicById, uid, type Session } from "../store";

// Kept at module level so a recording survives navigating away and back.
const state = {
  topicId: null as string | null,
  committed: "", // text before the current recording run (typed or earlier runs)
  live: "",
  interim: "",
  listener: null as Listener | null,
  startedAt: 0,
  busy: false,
};

const transcript = () => (state.committed + state.live).trim();

export function talkView(params: URLSearchParams): HTMLElement {
  if (params.has("topic")) state.topicId = params.get("topic") || null;
  const autoStart = params.get("start") === "1";

  const textarea = h("textarea", {
    class: "transcript",
    placeholder: speechSupported
      ? "Tap the mic and just talk. Your words appear here. You can also type."
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
  const mic = h("button", { class: "mic", "aria-label": "Start or stop talking", onclick: () => toggle() }, h("span", { class: "mic-dot" }), micLabel);
  const sortBtn = h("button", { class: "primary", onclick: () => finish(true) }, "Make sense of it");
  const saveBtn = h("button", { onclick: () => finish(false) }, "Just save");

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

  let tick: number | undefined;
  function refresh() {
    const on = !!state.listener;
    mic.classList.toggle("on", on);
    textarea.readOnly = on; // editing mid-recording would fight the recogniser
    micLabel.textContent = on ? "Listening… tap to pause" : transcript() ? "Tap to keep talking" : "Tap to talk";
    interim.textContent = state.interim;
    const busy = state.busy || on;
    sortBtn.disabled = busy;
    saveBtn.disabled = busy;
    sortBtn.textContent = state.busy ? "Thinking it through…" : "Make sense of it";
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

  function toggle() {
    if (state.listener) {
      state.listener.stop();
      return;
    }
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
      },
    });
    refresh();
  }

  async function finish(withAi: boolean) {
    const text = transcript();
    if (!text) {
      toast("Say or type something first");
      return;
    }
    const session: Session = {
      id: uid(),
      createdAt: new Date().toISOString(),
      topicId: state.topicId,
      transcript: text,
      analysis: null,
      addedActions: [],
    };
    data.sessions.unshift(session);
    save();
    state.committed = "";
    state.live = "";
    if (!withAi) {
      go(`#/thought/${session.id}`);
      return;
    }
    state.busy = true;
    refresh();
    try {
      session.analysis = await analyse(session);
      save();
    } catch (err) {
      toast(describeError(err));
    } finally {
      state.busy = false;
    }
    go(`#/thought/${session.id}`);
  }

  const view = h(
    "div",
    { class: "view talk" },
    h("header", { class: "row between" }, h("h1", null, "Think out loud"), topicSelect),
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
            if (state.listener || !transcript() || !confirm("Clear this transcript?")) return;
            state.committed = "";
            textarea.value = "";
            refresh();
          },
        },
        "Clear",
      ),
    ),
    !data.settings.apiKey
      ? h("p", { class: "hint" }, "Add your Claude API key in ", h("a", { href: "#/settings" }, "Settings"), " so it can sort your thoughts.")
      : null,
  );

  refresh();
  // Opened from a shortcut (e.g. the phone's Action Button): start listening right away.
  // Some browsers need a tap first; if so the mic button is right there.
  if (autoStart && !state.listener && speechSupported) {
    history.replaceState(null, "", `#/talk?topic=${state.topicId ?? ""}`);
    setTimeout(() => {
      try {
        toggle();
      } catch {
        /* needs a user gesture */
      }
    }, 300);
  }
  return view;
}
