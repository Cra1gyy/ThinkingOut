type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown> & { class?: string };

// Minimal element builder: h("button", { class: "x", onclick: fn }, "Label")
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2), value as EventListener);
    } else if (key === "class") {
      el.className = String(value);
    } else if (key in el && key !== "list") {
      (el as unknown as Record<string, unknown>)[key] = value;
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function go(hash: string) {
  location.hash = hash;
}

export function toast(message: string) {
  const el = h("div", { class: "toast" }, message);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

export const bulletList = (title: string, items: string[], cls = "") =>
  items.length
    ? h("section", { class: `block ${cls}` }, h("h3", null, title), h("ul", null, items.map((i) => h("li", null, i))))
    : null;

// ---- swiping between sibling pages (To-do ⇄ Daily, Notes ⇄ Collections) ----

let slideFrom: "left" | "right" | null = null;

// Go to a sibling page, sliding in from the side it lives on.
export function slideTo(hash: string, from: "left" | "right") {
  slideFrom = from;
  go(hash);
}

// The direction the next page should slide in from (read once by the renderer).
export function takeSlide() {
  const s = slideFrom;
  slideFrom = null;
  return s;
}

// A quick horizontal flick anywhere on `el` moves to the previous / next page
// that `pages()` gives for the current screen. Ignored while typing, in
// horizontally scrolling rows, or in an open editor.
export function swipePages(el: HTMLElement, pages: () => [string | null, string | null] | undefined) {
  let x0 = 0;
  let y0 = 0;
  let t0 = 0;
  let ok = false;
  el.addEventListener(
    "touchstart",
    (e) => {
      const t = e.touches[0];
      const target = e.target as HTMLElement;
      ok = e.touches.length === 1 && !target.closest("input, textarea, select, .strip, .swatches, .gallery, .item.editing, .chips-row");
      x0 = t.clientX;
      y0 = t.clientY;
      t0 = Date.now();
    },
    { passive: true },
  );
  el.addEventListener(
    "touchend",
    (e) => {
      if (!ok) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0;
      const dy = t.clientY - y0;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5 || Date.now() - t0 > 800) return;
      const [prev, next] = pages() ?? [null, null];
      if (dx < 0 && next) slideTo(next, "right");
      else if (dx > 0 && prev) slideTo(prev, "left");
    },
    { passive: true },
  );
}
