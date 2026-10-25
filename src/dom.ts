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
