// 複数の画面で使う部品

import { actions } from "./actions.js";
import { h, pressable } from "./dom.js";
import { dayLabel, pt, ptClass } from "./format.js";
import { matchStatus, teamOfPlayer, teamShort, wikiSource } from "./model.js";
import { state } from "./store.js";

export function teamTag(id) {
  return h("span", { class: "team-tag" + (id === state.fav ? " is-fav" : "") }, teamShort(id));
}

export function statusBadge(st) {
  if (st === "live") return h("span", { class: "badge badge--live" }, "対局中");
  if (st === "today") return h("span", { class: "badge badge--next" }, "本日");
  if (st === "done") return h("span", { class: "badge badge--done" }, "終了");
  if (st === "pending") return h("span", { class: "badge badge--done" }, "集計中");
  return null;
}

export function playerLink(name, opts) {
  return h("span", { class: "plink", ...pressable(e => { e.stopPropagation(); actions.openPlayer(name, opts); }) }, name);
}

export function gameBlock(g) {
  return h("div", { class: "game" }, h("div", { class: "game__no" }, `第${g.no}回戦`),
    [...g.results].sort((a, b) => a.rank - b.rank).map(r => h("div", { class: "grow" },
      h("span", { class: "grow__rank" + (r.rank === 1 ? " r1" : "") }, r.rank),
      h("span", { class: "grow__name" }, playerLink(r.name), h("small", {}, teamShort(teamOfPlayer(r.name)))),
      h("span", { class: "grow__pt " + ptClass(r.point) }, pt(r.point)))));
}

export function resultCard(m) {
  return h("section", { class: "card result" },
    h("div", { class: "result__head" }, h("span", { class: "result__date" }, dayLabel(m.date)), statusBadge(matchStatus(m))),
    h("div", { class: "games" }, m.games.map(gameBlock)));
}

export function stat(label, value, cls = "") {
  return h("div", { class: "stat" }, h("div", { class: "stat__label" }, label), h("div", { class: "stat__value " + cls }, value));
}

export function note(text) { return h("p", { class: "note" }, text); }
export function sectionTitle(text) { return h("h2", { class: "section-title" }, text); }

// 過去シーズンの出典（Wikipedia, CC BY-SA 4.0）
export function sourceNote(seasons) {
  const links = seasons.map(s => [s, wikiSource(s)]).filter(([, url]) => url);
  if (!links.length) return null;
  return h("p", { class: "note source" }, "過去シーズンの成績の出典: 公式サイト、Wikipedia（",
    links.map(([s, url], i) => [i ? "・" : "", h("a", { href: url, target: "_blank", rel: "noopener" }, s)]),
    "、CC BY-SA 4.0）");
}
