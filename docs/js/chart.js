// チーム別ポイント推移グラフ（SVG）。灰色の全チーム＋選んだ最大3チームを色付きで強調。

import { $, h, s } from "./dom.js";
import { DOW, dowOf, pt } from "./format.js";
import { chartSelection, progression, teamsForPicking, teamShort } from "./model.js";
import { set, state } from "./store.js";

export function hideTooltip() { const t = $("#tooltip"); if (t) t.hidden = true; }

function toggleTeam(t) {
  let sel = chartSelection().slice();
  if (sel.includes(t)) sel = sel.filter(x => x !== t);
  else { sel.push(t); if (sel.length > 3) sel.shift(); }
  set({ chartTeams: sel });
}

let measureCtx;
function textWidth(str) {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  measureCtx.font = `700 11px ${getComputedStyle(document.body).fontFamily}`;
  return measureCtx.measureText(str).width;
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

export function drawProgression(wrap, legend) {
  const pts = progression();
  const sel = chartSelection();
  const color = t => `var(--series-${sel.indexOf(t) + 1})`;
  const teams = Object.keys(state.data.teams);

  // 凡例: 2列のマス目に同じ形のボタン（色はチームごとに選んだ順で固定、並びは推しチームが先頭で残りは現在順位）
  const rankOf = Object.fromEntries(state.data.standings.map(r => [r.team, r.rank]));
  legend.replaceChildren(...teamsForPicking().map(t => {
    const on = sel.includes(t);
    return h("button", { class: "legend__btn", type: "button", "aria-pressed": String(on), onclick: () => toggleTeam(t) },
      h("span", { class: "legend__rank" }, rankOf[t] ?? ""), h("span", { class: "legend__name" }, teamShort(t)),
      on ? h("span", { class: "key", style: `background:${color(t)}` }) : null);
  }));

  const W = Math.max(280, wrap.clientWidth), H = Math.round(Math.min(340, Math.max(220, W * 0.55)));
  // 右の余白は、右端に出すチーム名の長さに合わせる（「麻雀格闘倶楽部」が切れないように）
  const labelW = Math.max(0, ...sel.map(t => textWidth(teamShort(t))));
  const m = { t: 12, r: Math.max(48, Math.ceil(labelW) + 14), b: 24, l: 40 };
  const all = pts.flatMap(p => Object.values(p.values));
  let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  const step = niceStep((hi - lo) / 4 || 10);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const n = pts.length;
  const x = i => m.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - m.l - m.r));
  const y = v => m.t + (1 - (v - lo) / (hi - lo || 1)) * (H - m.t - m.b);

  const svg = s("svg", { class: "chart", width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "チーム別ポイント推移" });
  for (let v = lo; v <= hi + 1e-9; v += step) {
    svg.append(s("line", { class: v === 0 ? "zero" : "grid", x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
    svg.append(s("text", { class: "tick", x: m.l - 6, y: y(v) + 3.5, "text-anchor": "end" }, Math.round(v)));
  }
  const every = Math.max(1, Math.ceil(n / Math.floor((W - m.l - m.r) / 44)));
  pts.forEach((p, i) => {
    if (i % every && i !== n - 1) return;
    if (i !== n - 1 && x(n - 1) - x(i) < 40) return;   // 最後の日付と重なるものは出さない
    svg.append(s("text", { class: "tick", x: x(i), y: H - 6, "text-anchor": i === 0 ? "start" : "middle" }, p.label));
  });
  const path = t => pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.values[t]).toFixed(1)}`).join("");
  for (const t of teams) if (!sel.includes(t)) svg.append(s("path", { class: "rest", d: path(t) }));
  const last = pts[n - 1];
  const labels = [];
  for (const t of sel) {
    svg.append(s("path", { class: "hl", d: path(t), stroke: color(t) }));
    svg.append(s("circle", { class: "dot", cx: x(n - 1), cy: y(last.values[t]), r: 4, fill: color(t) }));
    labels.push({ t, y: y(last.values[t]) });
  }
  labels.sort((a, b) => a.y - b.y); // 末尾ラベルの重なりを避ける
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
  for (const l of labels) svg.append(s("text", { class: "endlabel", x: x(n - 1) + 8, y: l.y + 4 }, teamShort(l.t)));

  // ホバー / タッチで値を読む
  const cross = s("line", { class: "cross", y1: m.t, y2: H - m.b, visibility: "hidden" });
  const dots = s("g");
  const hit = s("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent" });
  svg.append(cross, dots, hit);
  const show = e => {
    const r = svg.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left - m.l) / (W - m.l - m.r)) * (n - 1))));
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
    dots.replaceChildren(...sel.map(t => s("circle", { class: "dot", cx: x(i), cy: y(pts[i].values[t]), r: 4.5, fill: color(t) })));
    const rows = teams.map(t => ({ t, v: pts[i].values[t] })).sort((a, b) => b.v - a.v);
    const p = pts[i];
    const tip = $("#tooltip");
    tip.replaceChildren(h("div", { class: "tooltip__date" }, p.date ? `${p.label}（${DOW[dowOf(p.date)]}）終了時点` : p.latest ? "最新（公式順位表）" : "開幕時点"),
      ...rows.map(({ t, v }) => h("div", { class: "tooltip__row" + (sel.includes(t) ? "" : " dim") },
        h("span", { class: "key", style: `background:${sel.includes(t) ? color(t) : "var(--series-rest)"}` }), teamShort(t), h("b", {}, pt(v)))));
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = r.left + x(i) + 14; if (left + tw > window.innerWidth - 8) left = r.left + x(i) - tw - 14;
    tip.style.left = Math.max(8, left) + "px";
    tip.style.top = Math.max(8, Math.min(window.innerHeight - th - 80, e.clientY - th / 2)) + "px";
  };
  const hide = () => { cross.setAttribute("visibility", "hidden"); dots.replaceChildren(); hideTooltip(); };
  hit.addEventListener("pointermove", show);
  hit.addEventListener("pointerdown", show);
  hit.addEventListener("pointerleave", hide);
  hit.addEventListener("pointerup", e => { if (e.pointerType !== "mouse") setTimeout(hide, 1800); });
  wrap.replaceChildren(svg);
}
