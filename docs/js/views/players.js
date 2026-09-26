// 個人成績タブ: 今季（ステージ別）と通算（ステージ別）のランキング

import { actions } from "../actions.js";
import { note, teamTag } from "../components.js";
import { chipRow, h, pressable } from "../dom.js";
import { dec2, int, pct, pt, ptClass, STAGE_LABEL } from "../format.js";
import { careerOf, currentStages, rosterNames, teamOfPlayer, teamShort, trackedSince } from "../model.js";
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
// 通算: 過去シーズンで公開されている項目だけ
const CAREER_SORTS = [
  { k: "points", label: "ポイント", fmt: pt, desc: true },
  { k: "perGame", label: "1半荘平均", fmt: pt, desc: true },
  { k: "games", label: "半荘数", fmt: int, desc: true },
  { k: "lastAvoidRate", label: "4着回避率", fmt: pct, desc: true },
  { k: "bestScore", label: "最高スコア", fmt: int, desc: true },
  { k: "avgWin", label: "平均打点", fmt: int, desc: true },
];

function rankList(rows, sort, { meta, onOpen }) {
  rows.sort((a, b) => (sort.desc ? (b.v[sort.k] ?? -Infinity) - (a.v[sort.k] ?? -Infinity) : (a.v[sort.k] ?? Infinity) - (b.v[sort.k] ?? Infinity)) || (b.v.points - a.v.points));
  let rank = 0, prev;
  return h("section", { class: "card" }, h("ol", { class: "plist" }, rows.map((r, i) => {
    if (r.v[sort.k] !== prev) { rank = i + 1; prev = r.v[sort.k]; }
    return h("li", { class: "prow" + (r.team === state.fav ? " is-fav" : ""), ...pressable(() => onOpen(r.name)) },
      h("span", { class: "prow__rank" }, rank),
      h("div", {}, h("div", { class: "prow__name" }, r.name), h("div", { class: "prow__meta" }, teamTag(r.team), meta(r.v))),
      h("div", { class: "prow__val " + (sort.k === "points" ? ptClass(r.v.points) : "") }, sort.fmt(r.v[sort.k]),
        sort.k !== "points" ? h("small", { class: ptClass(r.v.points) }, pt(r.v.points) + "pt") : null));
  })));
}

export function viewPlayers() {
  const ps = state.players;
  const stages = currentStages();
  const scope = ps.scope === "career" || stages.includes(ps.scope) ? ps.scope : "R";
  const career = scope === "career";
  const sorts = career ? CAREER_SORTS : SEASON_SORTS;
  const sort = sorts.find(x => x.k === ps.sort) || sorts[0];
  const teamIds = state.data.standings.map(r => r.team);
  const byTeam = r => ps.team === "all" || r.team === ps.team;

  const controls = h("div", { class: "controls" },
    chipRow([...stages.map(s => [s, `今季${STAGE_LABEL[s]}`]), ["career", "通算"]], scope, v => setPlayers({ scope: v, sort: "points" })),
    career ? chipRow([["all", "全ステージ"], ["R", "レギュラー"], ["SF", "セミファイナル"], ["F", "ファイナル"]], ps.careerStage, v => setPlayers({ careerStage: v })) : null,
    chipRow(sorts.map(x => [x.k, x.label]), sort.k, v => setPlayers({ sort: v })),
    chipRow([["all", "全チーム"], ...teamIds.map(t => [t, teamShort(t)])], ps.team, v => setPlayers({ team: v })));

  if (!career) {
    const rows = state.data.stages[scope].filter(p => p.games > 0).map(p => ({ name: p.name, team: p.team, v: p })).filter(byTeam);
    return [controls,
      rankList(rows, sort, { meta: v => `${int(v.games)}試合`, onOpen: name => actions.openPlayer(name, { view: "season", stage: scope }) }),
      note("選手をタップすると詳しい成績、対局履歴、過去シーズンを含む通算成績が見られます。試合数が少ないうちは率の数字が大きくぶれます。")];
  }

  const stage = ps.careerStage;
  const rows = rosterNames().map(name => ({ name, team: teamOfPlayer(name), v: careerOf(name, stage) })).filter(r => r.v).filter(byTeam);
  const since = trackedSince();
  const notes = {
    all: `レギュラーシーズン（2018-19〜）と、${since}以降のセミファイナル・ファイナルの合計です。`,
    R: "2018-19シーズンからのレギュラーシーズンの通算です。",
    SF: `過去シーズンのセミファイナルの個人成績は公式サイトで公開されていないため、${since}シーズンから記録しています。`,
    F: `過去シーズンのファイナルの個人成績は公式サイトで公開されていないため、${since}シーズンから記録しています。`,
  };
  return [controls,
    rows.length ? rankList(rows, sort, { meta: v => `${int(v.games)}半荘・${v.seasons}シーズン`, onOpen: name => actions.openPlayer(name, { view: "career" }) })
      : h("p", { class: "empty" }, `${STAGE_LABEL[stage]}の記録はまだありません`),
    note(notes[stage] + " 対象は今季の所属選手です。平均打点はアガリ回数が公開されていないため、半荘数で重み付けした目安です。")];
}
