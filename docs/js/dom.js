// DOM を組み立てる小さなヘルパー。文字列は常に textContent 経由で入れる。

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, kids);
  return el;
}

export function append(el, kids) {
  for (const kid of [kids].flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const SVGNS = "http://www.w3.org/2000/svg";
export function s(tag, attrs = {}, text) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  return el;
}

export const $ = (sel, el = document) => el.querySelector(sel);

// Enter でも押せるボタン風の要素
export function pressable(onpress) {
  return { role: "button", tabindex: 0, onclick: onpress, onkeydown: e => { if (e.key === "Enter") onpress(e); } };
}

export function chipRow(items, current, onpick) {
  return h("div", { class: "chips" }, items.map(([value, label]) =>
    h("button", { class: "chip", type: "button", "aria-pressed": String(value === current), onclick: () => onpick(value) }, label)));
}

export function segmented(items, current, onpick) {
  return h("div", { class: "segmented", role: "tablist" }, items.map(([value, label]) =>
    h("button", { class: "segmented__item", type: "button", role: "tab", "aria-selected": String(value === current), onclick: () => onpick(value) }, label)));
}
