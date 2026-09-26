// 個人成績タブ: 今季・シーズン別・通算（いずれもレギュラーシーズン）のランキング

import { actions } from "../actions.js";
import { note, sourceNote, teamTag } from "../components.js";
import { chipRow, h, pressable } from "../dom.js";
import { dec2, int, pct, pt, ptClass } from "../format.js";
import { careerOf, isActive, pastSeasons, rosterNames, seasonTable, teamOfPlayer, teamShort } from "../model.js";
import { setPlayers, state } from "../store.js";

// 今季: 公式の成績ページと同じ項目
const SEASON_SORTS = [
  { k: "points", label: "ポイント", fmt: pt, desc: true },
  { k: "avgRank", label: "平均着順", fmt: dec2, desc: false },
  { k: "topRate", label: "トップ率", fmt: pct, desc: true },
  { k: "lastAvoidRate", label: "ラス回避率", fmt: pct, desc: true },
  { k: "rentaiRate", label: "連対率", fmt: pct, desc: true },
  { k: "bestScore", label: "最高スコア", fmt: int, desc: true },
  { k: "avgWin", label: "平均打点", fmt: int, desc: true },
  { k: "winRate", label: "アガリ率", fmt: pct, desc: true },
  { k: "dealInRate", label: "放銃率", fmt: pct, desc: false },
  { k: "riichiRate", label: "リーチ率", fmt: pct, desc: true },
  { k: "furoRate", label: "副露率", fmt: pct, desc: true },
];
// シーズン別・通算: シーズンによって公開されている項目が違うので、データのある項目だけ出す
const HISTORY_SORTS = [
  { k: "points", label: "ポイント", fmt: pt, desc: true },
  { k: "perGame", label: "1半荘平均", fmt: pt, desc: true },
  { k: "avgRank", label: "平均着順", fmt: dec2, desc: false },
  { k: "r1", label: "トップ数", fmt: v => v == null ? "–" : `${int(v)}回`, desc: true },
  { k: "topRate", label: "トップ率", fmt: pct, desc: true },
  { k: "lastAvoidRate", label: "4着回避率", fmt: pct, desc: true },
  { k: "bestScore", label: "最高スコア", fmt: int, desc: true },
  { k: "avgWin", label: "平均打点", fmt: int, desc: true },
  { k: "rentaiRate", label: "連対率", fmt: pct, desc: true },
  { k: "winRate", label: "アガリ率", fmt: pct, desc: true },
  { k: "dealInRate", label: "放銃率", fmt: pct, desc: false },
  { k: "riichiRate", label: "リーチ率", fmt: pct, desc: true },
  { k: "furoRate", label: "副露率", fmt: pct, desc: true },
  { k: "games", label: "半荘数", fmt: int, desc: true },
];

function rankList(rows, sort, { meta, onOpen }) {
  rows.sort((a, b) => (sort.desc ? (b.v[sort.k] ?? -Infinity) - (a.v[sort.k] ?? -Infinity) : (a.v[sort.k] ?? Infinity) - (b.v[sort.k] ?? Infinity)) || (b.v.points - a.v.points));
  let rank = 0, prev;
  return h("section", { class: "card" }, h("ol", { class: "plist" }, rows.map((r, i) => {
    if (r.v[sort.k] !== prev) { rank = i + 1; prev = r.v[sort.k]; }
    return h("li", { class: "prow" + (r.team === state.fav ? " is-fav" : ""), ...pressable(() => onOpen(r.name)) },
      h("span", { class: "prow__rank" }, rank),
      h("div", {}, h("div", { class: "prow__name" }, r.name), h("div", { class: "prow__meta" }, teamTag(r.team), meta(r))),
      h("div", { class: "prow__val " + (sort.k === "points" ? ptClass(r.v.points) : "") }, sort.fmt(r.v[sort.k]),
        sort.k !== "points" ? h("small", { class: ptClass(r.v.points) }, pt(r.v.points) + "pt") : null));
  })));
}

const available = (rows, sorts) => sorts.filter(s => rows.some(r => r.v[s.k] != null));

export function viewPlayers() {
  const ps = state.players;
  const scope = ["season", "past", "career"].includes(ps.scope) ? ps.scope : "season";
  const seasons = pastSeasons();
  const pastSeason = seasons.includes(ps.pastSeason) ? ps.pastSeason : seasons[0];
  const byTeam = r => ps.team === "all" || r.team === ps.team;
  const byWho = r => ps.who !== "active" || isActive(r.name);

  let rows, sorts, meta, onOpen, notes;
  if (scope === "season") {
    rows = state.data.players.filter(p => p.games > 0).map(p => ({ name: p.name, team: p.team, v: p }));
    sorts = SEASON_SORTS;
    meta = r => `${int(r.v.games)}試合`;
    onOpen = name => actions.openPlayer(name, { view: "season" });
    notes = [note("レギュラーシーズンの成績です。選手をタップすると詳しい成績、対局履歴、シーズン別の成績が見られます。試合数が少ないうちは率の数字が大きくぶれます。")];
  } else if (scope === "past") {
    rows = seasonTable(pastSeason).map(r => ({ name: r.name, team: r.team, v: r })).filter(byWho);
    sorts = available(rows, HISTORY_SORTS);
    meta = r => `${int(r.v.games)}半荘` + (isActive(r.name) ? "" : "・現役外");
    onOpen = name => actions.openPlayer(name, { view: "career", highlight: pastSeason });
    notes = [note(`${pastSeason}シーズンのレギュラーシーズンの成績です。チームは当時の所属です。`), sourceNote([pastSeason])];
  } else {
    rows = rosterNames({ activeOnly: ps.who === "active" }).map(name => ({ name, team: teamOfPlayer(name), v: careerOf(name) })).filter(r => r.v);
    sorts = available(rows, HISTORY_SORTS);
    meta = r => `${int(r.v.games)}半荘・${r.v.seasons}シーズン` + (isActive(r.name) ? "" : `・〜${r.v.lastSeason}`);
    onOpen = name => actions.openPlayer(name, { view: "career" });
    notes = [note("2018-19シーズンからのレギュラーシーズンの通算です（今季を含む）。現役外の選手は最後に出場したシーズンのチームで表示します。平均打点はアガリ回数が公開されていないため、半荘数で重み付けした目安です。"), sourceNote(seasons)];
  }
  const sort = sorts.find(x => x.k === ps.sort) || sorts[0];
  rows = rows.filter(byTeam);

  const controls = h("div", { class: "controls" },
    chipRow([["season", `今季（${state.data.season}）`], ["past", "シーズン別"], ["career", "通算"]], scope, v => setPlayers({ scope: v, sort: "points" })),
    scope === "past" ? chipRow(seasons.map(s => [s, s]), pastSeason, v => setPlayers({ pastSeason: v })) : null,
    scope !== "season" ? chipRow([["all", "全選手"], ["active", "現役のみ"]], ps.who === "active" ? "active" : "all", v => setPlayers({ who: v })) : null,
    chipRow(sorts.map(x => [x.k, x.label]), sort.k, v => setPlayers({ sort: v })),
    chipRow([["all", "全チーム"], ...state.data.standings.map(r => [r.team, teamShort(r.team)])], ps.team, v => setPlayers({ team: v })));

  return [controls,
    rows.length ? rankList(rows, sort, { meta, onOpen }) : h("p", { class: "empty" }, "該当する選手がいません"),
    notes];
}
