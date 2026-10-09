// 個人成績タブ: 今季・シーズン別・通算（いずれもレギュラーシーズン）のランキングと、役満の一覧

import { actions } from "../actions.js";
import { asOfLine, note, sourceNote, teamTag, titleBadges, yakumanCard } from "../components.js";
import { chipRow, h, pressable } from "../dom.js";
import { dec2, int, pct, pt, ptClass } from "../format.js";
import { careerOf, isActive, teamsForPicking, pastSeasons, rosterNames, seasonTable, teamOfPlayer, teamShort, titlesInSeason, yakumanRows } from "../model.js";
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

function rankList(rows, sort, { meta, onOpen, badges = () => null }) {
  rows.sort((a, b) => (sort.desc ? (b.v[sort.k] ?? -Infinity) - (a.v[sort.k] ?? -Infinity) : (a.v[sort.k] ?? Infinity) - (b.v[sort.k] ?? Infinity)) || (b.v.points - a.v.points));
  let rank = 0, prev;
  return h("section", { class: "card" }, h("ol", { class: "plist" }, rows.map((r, i) => {
    if (r.v[sort.k] !== prev) { rank = i + 1; prev = r.v[sort.k]; }
    return h("li", { class: "prow", ...pressable(() => onOpen(r.name)) },
      h("span", { class: "prow__rank" }, rank),
      h("div", {}, h("div", { class: "prow__name" }, r.name, titleBadges(badges(r))), h("div", { class: "prow__meta" }, teamTag(r.team, { markFav: state.colorPlayersFav }), meta(r))),
      h("div", { class: "prow__val " + (sort.k === "points" ? ptClass(r.v.points) : "") }, sort.fmt(r.v[sort.k]),
        sort.k !== "points" ? h("small", { class: ptClass(r.v.points) }, pt(r.v.points) + "pt") : null));
  })));
}

const available = (rows, sorts) => sorts.filter(s => rows.some(r => r.v[s.k] != null));

export function viewPlayers() {
  const ps = state.players;
  const scope = ["season", "past", "career", "yakuman"].includes(ps.scope) ? ps.scope : "season";
  const scopeChips = chipRow([["season", `今季（${state.data.season}）`], ["past", "シーズン別"], ["career", "通算"], ["yakuman", "役満"]], scope,
    v => setPlayers({ scope: v, sort: "points" }));
  const teamChips = chipRow([["all", "全チーム"], ...teamsForPicking().map(t => [t, teamShort(t)])], ps.team, v => setPlayers({ team: v }));
  // 役満: 並べ替えと「全選手／現役のみ」は出さず、チームの絞り込みだけ
  if (scope === "yakuman") return [h("div", { class: "controls" }, scopeChips, teamChips), yakumanView(ps.team)];
  const seasons = pastSeasons();
  const pastSeason = seasons.includes(ps.pastSeason) ? ps.pastSeason : seasons[0];
  const byTeam = r => ps.team === "all" || r.team === ps.team;
  const byWho = r => ps.who !== "active" || isActive(r.name);

  let rows, sorts, meta, onOpen, notes, badges;
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
    const titles = titlesInSeason(pastSeason);
    badges = r => titles.get(r.name);
    notes = [note(`${pastSeason}シーズンのレギュラーシーズンの成績です。チームは当時の所属です。名前の横の印はそのシーズンの個人タイトルです。`), sourceNote([pastSeason])];
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
    scopeChips,
    scope === "past" ? chipRow(seasons.map(s => [s, s]), pastSeason, v => setPlayers({ pastSeason: v })) : null,
    scope !== "season" ? chipRow([["all", "全選手"], ["active", "現役のみ"]], ps.who === "active" ? "active" : "all", v => setPlayers({ who: v })) : null,
    chipRow(sorts.map(x => [x.k, x.label]), sort.k, v => setPlayers({ sort: v })),
    teamChips);

  return [controls,
    scope !== "past" ? asOfLine() : null,
    rows.length ? rankList(rows, sort, { meta, onOpen, badges }) : h("p", { class: "empty" }, "該当する選手がいません"),
    notes];
}

// 役満の一覧（種類ごとの数と、新しい順のカード）。team で絞り込むと、その選手がアガった・放銃したもの
function yakumanView(team) {
  let rows = yakumanRows();
  if (team !== "all") rows = rows.filter(r => r.winnerTeam === team || r.loserTeam === team);
  const counts = {};
  for (const r of rows) counts[r.yaku] = (counts[r.yaku] || 0) + 1;
  const summary = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return [
    summary.length ? h("div", { class: "yk-sum" }, summary.map(([yaku, n]) => h("div", {}, h("b", {}, n), h("span", {}, yaku)))) : null,
    rows.length ? rows.map(r => yakumanCard(r, { markFav: state.colorPlayersFav })) : h("p", { class: "empty" }, "該当する役満はありません"),
    note(team === "all"
      ? "Mリーグ公式戦（レギュラー・セミファイナル・ファイナル）で出た役満です。"
      : `${teamShort(team)}の選手がアガった、または放銃した役満です（チームは当時の所属）。`),
    sourceNote(["yakuman"]),
  ];
}
