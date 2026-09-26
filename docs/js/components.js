// 複数の画面で使う部品

import { actions } from "./actions.js";
import { h, pressable } from "./dom.js";
import { dayLabel, int, pct, pt, ptClass } from "./format.js";
import { AWARD_SHORT, matchStatus, teamOfPlayer, teamShort, wikiSource } from "./model.js";
import { state } from "./store.js";

// チーム名の札。推しチームの色付けは日程だけで使う（markFav: true）
export function teamTag(id, { markFav = false } = {}) {
  return h("span", { class: "team-tag" + (markFav && id === state.fav ? " is-fav" : "") }, teamShort(id));
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

// 試合結果。markFav: 推しチームの試合・選手を緑にする（「結果」タブだけで使う）
export function gameBlock(g, { markFav = false } = {}) {
  return h("div", { class: "game" }, h("div", { class: "game__no" }, `第${g.no}回戦`),
    [...g.results].sort((a, b) => a.rank - b.rank).map(r => {
      const team = teamOfPlayer(r.name);
      return h("div", { class: "grow" },
        h("span", { class: "grow__rank" + (r.rank === 1 ? " r1" : "") }, r.rank),
        h("span", { class: "grow__name" }, playerLink(r.name), h("small", { class: markFav && team === state.fav ? "is-fav" : null }, teamShort(team))),
        h("span", { class: "grow__pt " + ptClass(r.point) }, pt(r.point)));
    }));
}

export function resultCard(m, { markFav = false } = {}) {
  const fav = markFav && state.fav && m.teams.includes(state.fav);
  return h("section", { class: "card result" + (fav ? " is-fav" : "") },
    h("div", { class: "result__head" }, h("span", { class: "result__date" }, dayLabel(m.date)), statusBadge(matchStatus(m))),
    h("div", { class: "games" }, m.games.map(g => gameBlock(g, { markFav: fav }))));
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
  return h("p", { class: "note source" }, "過去シーズンの出典: 公式サイト、Wikipedia（",
    links.map(([s, url], i) => [i ? "・" : "", h("a", { href: url, target: "_blank", rel: "noopener" }, { titles: "個人タイトル", teams: "チーム成績" }[s] ?? s)]),
    "、CC BY-SA 4.0）");
}

export function titleBadges(awards) {
  if (!awards?.length) return null;
  return awards.map(a => h("span", { class: "title-badge" }, AWARD_SHORT[a] ?? a));
}

export function awardValue(t) {
  if (t.value == null) return "";
  if (t.award === "MVP") return `${pt(t.value)}pt`;
  if (t.award === "最高スコア賞") return `${int(t.value)}点`;
  if (t.award === "平均打点賞") return int(t.value);
  if (t.award === "4着回避率賞") return pct(t.value);
  if (t.award === "最多トップ賞") return `${int(t.value)}回`;
  return String(t.value);
}
