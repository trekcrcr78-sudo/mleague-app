// 下から出てくる詳細シート（試合・選手・チーム）

import { actions } from "./actions.js";
import { asOfLine, awardValue, gameBlock, note, playerLink, resultCard, sourceNote, stat, teamLink, teamTag, titleBadges } from "./components.js";
import { $, h, pressable, segmented } from "./dom.js";
import { dayLabel, dec2, int, pct, pt, ptClass } from "./format.js";
import { aggregate, allMatches, currentPlayer, isActive, playerLog, postseasonRows, seasonRows, STAGE_NAME, borderRace, teamCareerRows, teamName, teamOfPlayer, teamPostRows, teamSeasonRanks, teamShort, teamTotal, titlesOf, yakumanOf } from "./model.js";
import { set, setFav, state } from "./store.js";

let current = null; // 開いているシートの描画関数（データ更新時に描き直す）

function show(renderFn) {
  const wasOpen = !$("#sheet").hidden;
  current = renderFn;
  redrawSheet();
  $("#sheet").hidden = false;
  document.body.style.overflow = "hidden";
  if (!wasOpen) history.pushState({ sheet: true }, "");
  $(".sheet__panel").scrollTop = 0;
}
export function redrawSheet() {
  if (current) $("#sheet-body").replaceChildren(...[current()].flat(Infinity).filter(Boolean));
}
export function closeSheet(fromPop) {
  if ($("#sheet").hidden) return;
  $("#sheet").hidden = true;
  current = null;
  document.body.style.overflow = "";
  if (!fromPop && history.state?.sheet) history.back();
}

function hero(title, sub, value, valueLabel) {
  return h("div", { class: "hero" },
    h("div", {}, h("h2", { id: "sheet-title" }, title), sub ? h("div", { class: "prow__meta" }, sub) : null),
    value !== undefined ? h("div", { class: "hero__pts " + ptClass(value) }, pt(value), h("small", {}, valueLabel)) : null);
}

// ---------- 試合 ----------
function openMatch(m) {
  show(() => [hero(`${dayLabel(m.date)}の結果`), h("div", { class: "games" }, m.games.map(g => gameBlock(g)))]);
}

// ---------- 選手（成績はすべてレギュラーシーズン） ----------
function openPlayer(name, opts = {}) {
  // 現役でない選手は最初から通算を開く。highlight=シーズン別の一覧から開いたときのシーズン
  const ui = { view: opts.view || (isActive(name) ? "season" : "career"), highlight: opts.highlight };
  show(() => {
    const team = teamOfPlayer(name);
    const tabs = segmented([["season", `今季（${state.data.season}）`], ["career", "通算・シーズン別"]], ui.view, v => { ui.view = v; redrawSheet(); });
    return ui.view === "career" ? playerCareer(name, team, seasonRows(name), tabs, ui.highlight) : playerSeason(name, team, tabs);
  });
}

function playerSeason(name, team, tabs) {
  const p = currentPlayer(name);
  if (!p?.games) return [hero(name, [teamTag(team), "今季の出場なし"]), tabs, h("p", { class: "empty" }, "今季はまだ出場がありません")];
  const log = playerLog(name);
  return [
    hero(name, [teamTag(team), `${int(p.games)}試合・${int(p.hands)}局`], p.points, "ポイント"),
    tabs,
    asOfLine(),
    h("div", { class: "stat-grid" },
      stat("平均着順", dec2(p.avgRank)), stat("トップ率", pct(p.topRate)), stat("連対率", pct(p.rentaiRate)),
      stat("ラス回避率", pct(p.lastAvoidRate)), stat("アガリ率", pct(p.winRate)), stat("平均打点", int(p.avgWin)),
      stat("最高スコア", int(p.bestScore)), stat("放銃率", pct(p.dealInRate)), stat("放銃平均打点", int(p.avgDealIn)),
      stat("リーチ率", pct(p.riichiRate)), stat("副露率", pct(p.furoRate))),
    h("div", { class: "ranks" }, [1, 2, 3, 4].map(k => h("div", {}, h("b", {}, int(p["r" + k])), h("span", {}, `${k}着`)))),
    h("h3", { class: "section-title" }, "対局履歴"),
    log.length ? h("section", { class: "card" }, h("table", { class: "log" }, h("tbody", {}, log.map(r => h("tr", {},
      h("td", {}, `${dayLabel(r.date)} 第${r.no}回戦`), h("td", {}, `${r.rank}着`), h("td", { class: ptClass(r.point) }, pt(r.point)))))))
      : h("p", { class: "empty" }, "まだ対局がありません"),
  ];
}

function playerCareer(name, team, rows, tabs, highlight) {
  const total = aggregate(rows);
  if (!total) return [hero(name, [teamTag(team)]), tabs, h("p", { class: "empty" }, "通算成績はまだありません")];
  const maxAbs = Math.max(...rows.map(r => Math.abs(r.points || 0)), 1);
  const titles = titlesOf(name);
  const span = total.firstSeason === total.lastSeason ? total.firstSeason : `${total.firstSeason}〜${isActive(name) ? "" : total.lastSeason}`;
  return [
    hero(name, [teamTag(team), `${span}・${total.seasons}シーズン`], total.points, "通算（レギュラー）"),
    tabs,
    h("div", { class: "stat-grid" },
      stat("半荘数", int(total.games)), stat("1半荘平均", pt(total.perGame), ptClass(total.perGame)), stat("平均着順", dec2(total.avgRank)),
      stat("トップ数", total.r1 == null ? "–" : `${int(total.r1)}回`), stat("トップ率", pct(total.topRate)), stat("4着回避率", pct(total.lastAvoidRate)),
      stat("最高スコア", int(total.bestScore)), stat("平均打点（目安）", int(total.avgWin))),
    titles.length ? [
      h("h3", { class: "section-title" }, `タイトル（${titles.length}）`),
      h("section", { class: "card" }, h("ul", { class: "titles" }, titles.map(t => h("li", {},
        h("span", { class: "titles__season" }, t.season),
        h("span", { class: "titles__award" }, t.award),
        h("span", { class: "titles__value" }, awardValue(t)))))),
    ] : null,
    yakumanSection(name),
    h("h3", { class: "section-title" }, "シーズン別"),
    h("section", { class: "card" }, h("table", { class: "career" },
      h("thead", {}, h("tr", {}, h("th", {}, "シーズン"), h("th", {}, "ポイント"), h("th", {}, "半荘"), h("th", {}, "トップ"), h("th", {}, "4着回避"))),
      h("tbody", {}, rows.map(r => h("tr", { class: (r.current ? "is-current" : "") + (r.season === highlight ? " is-highlight" : "") },
        h("td", {}, h("div", { class: "career__season" }, r.season, r.current ? h("span", { class: "badge badge--next" }, "今季") : null),
          h("div", { class: "career__team" }, teamLink(r.team)),
          (seasonTitles => seasonTitles.length ? h("div", { class: "career__titles" }, titleBadges(seasonTitles)) : null)(titles.filter(t => t.season === r.season).map(t => t.award))),
        h("td", {}, h("div", { class: "career__pts " + ptClass(r.points) }, pt(r.points)),
          h("div", { class: "bar" }, h("span", { class: "bar__fill " + (r.points < 0 ? "is-neg" : "is-pos"), style: `width:${(Math.abs(r.points || 0) / maxAbs * 100).toFixed(1)}%` }))),
        h("td", {}, int(r.games)),
        h("td", {}, r.r1 == null ? "–" : int(r.r1)),
        h("td", {}, pct(r.lastAvoidRate))))))),
    note("レギュラーシーズンの成績です。チームは各シーズン当時の所属です。平均打点はアガリ回数が公開されていないため、半荘数で重み付けした目安です。"),
    postseasonSection(name),
    sourceNote([...rows.filter(r => !r.current).map(r => r.season), ...(titles.length ? ["titles"] : []),
      ...(yakumanOf(name).won.length || yakumanOf(name).dealt.length ? ["yakuman"] : [])]),
  ];
}

// 役満（アガった・放銃した。関わったことがある選手だけ表示）
function yakumanSection(name) {
  const { won, dealt } = yakumanOf(name);
  if (!won.length && !dealt.length) return null;
  const item = (y, isWin) => h("li", {},
    h("span", { class: "titles__season" }, y.date.replaceAll("-", "/")),
    h("span", { class: "titles__award" }, y.yaku, h("small", { class: "yk-stage" }, STAGE_NAME[y.stage] ?? "")),
    h("span", { class: "titles__value" }, isWin
      ? [y.loser ? "ロン ← " : "ツモ", y.loser ? playerLink(y.loser, { view: "career" }) : null]
      : ["放銃 → ", playerLink(y.winner, { view: "career" })]));
  const parts = [won.length ? `アガリ${won.length}` : null, dealt.length ? `放銃${dealt.length}` : null].filter(Boolean).join("・");
  return [
    h("h3", { class: "section-title" }, `役満（${parts}）`),
    h("section", { class: "card" }, h("ul", { class: "titles yk-list" }, won.map(y => item(y, true)), dealt.map(y => item(y, false)))),
  ];
}

// ポストシーズン（出場したことがある選手だけ表示）
function postseasonSection(name) {
  const rows = postseasonRows(name);
  if (!rows.length) return null;
  const games = rows.reduce((a, r) => a + r.games, 0);
  const points = Math.round(rows.reduce((a, r) => a + r.points, 0) * 10) / 10;
  const stageLabel = { SF: "セミファイナル", F: "ファイナル" };
  const asOf = state.data.postseasonAsOf;
  return [
    h("h3", { class: "section-title" }, "ポストシーズン"),
    h("section", { class: "card" },
      h("table", { class: "career" },
        h("thead", {}, h("tr", {}, h("th", {}, "シーズン"), h("th", {}, "ステージ"), h("th", {}, "ポイント"), h("th", {}, "半荘"))),
        h("tbody", {}, rows.map(r => h("tr", { class: r.current ? "is-current" : "" },
          h("td", {}, h("div", { class: "career__season" }, r.season, r.current ? h("span", { class: "badge badge--next" }, "今季") : null)),
          h("td", {}, stageLabel[r.stage]),
          h("td", { class: "strong " + ptClass(r.points) }, pt(r.points)),
          h("td", {}, int(r.games)))))),
      h("div", { class: "post-total" }, h("span", {}, `ポストシーズン通算　${int(games)}半荘`), h("b", { class: ptClass(points) }, pt(points)))),
    rows.some(r => r.current) && asOf ? note(`今季の分は${dayLabel(asOf)}終了時点（毎日3時にまとめて更新）。`) : null,
  ];
}

// ---------- チーム ----------
function openTeam(t) {
  const ui = { view: "season" };
  show(() => {
    const tabs = segmented([["season", `今季（${state.data.season}）`], ["career", "通算・シーズン別"]], ui.view, v => { ui.view = v; redrawSheet(); });
    const favBtn = h("button", { class: "fav-btn", type: "button", "aria-pressed": String(state.fav === t), onclick: () => setFav(state.fav === t ? null : t) },
      state.fav === t ? "★ 推しチームに設定中" : "☆ 推しチームにする");
    return ui.view === "career" ? teamCareer(t, favBtn, tabs) : teamSeason(t, favBtn, tabs);
  });
}

// 着順の数字（半荘数・平均着順・各率）と 1〜4着の回数
function rankStats(c, { points = false } = {}) {
  return [
    h("div", { class: "stat-grid" },
      stat("半荘数", int(c.games)), stat("平均着順", dec2(c.avgRank)),
      points ? stat("1半荘平均", pt(c.perGame), ptClass(c.perGame)) : stat("トップ率", pct(c.topRate)),
      points ? stat("トップ率", pct(c.topRate)) : stat("連対率", pct(c.rentaiRate)),
      points ? stat("連対率", pct(c.rentaiRate)) : stat("ラス回避率", pct(c.lastAvoidRate)),
      points ? stat("ラス回避率", pct(c.lastAvoidRate)) : stat("1半荘平均", pt(c.perGame), ptClass(c.perGame))),
    h("div", { class: "ranks" }, [1, 2, 3, 4].map(k => h("div", {}, h("b", {}, `${int(c["r" + k])}回`), h("span", {}, `${k}着`)))),
  ];
}

function teamSeason(t, favBtn, tabs) {
  const row = state.data.standings.find(r => r.team === t);
  const members = state.data.players.filter(p => p.team === t).sort((a, b) => b.points - a.points);
  const recent = allMatches().filter(m => m.games.length && m.teams.includes(t)).reverse().slice(0, 5);
  const ranks = teamSeasonRanks(t);
  return [
    hero(teamName(t), row ? `${row.rank}位・${row.games}/${row.totalGames}試合` : "", row?.points, "ポイント"),
    favBtn,
    tabs,
    borderRaceCard(t),
    h("h3", { class: "section-title" }, ranks ? `今季の着順（${dayLabel(ranks.asOf)}の試合結果まで）` : "今季の着順"),
    ranks ? rankStats(ranks) : h("p", { class: "empty" }, "まだ対局がありません"),
    h("h3", { class: "section-title" }, "所属選手"),
    h("section", { class: "card" }, h("ol", { class: "plist" }, members.map(p => h("li", { class: "prow", ...pressable(() => actions.openPlayer(p.name)) },
      h("span", { class: "prow__rank" }, ""),
      h("div", {}, h("div", { class: "prow__name" }, p.name), h("div", { class: "prow__meta" }, `${int(p.games)}試合・平均着順 ${dec2(p.avgRank)}`)),
      h("div", { class: "prow__val " + ptClass(p.points) }, pt(p.points)))))),
    recent.length ? [h("h3", { class: "section-title" }, "直近の試合"), recent.map(m => resultCard(m))] : null,
  ];
}

// セミファイナル争い（6位以内の進出ライン）
function borderRaceCard(t) {
  const b = state.showBorderRace ? borderRace(t) : null;
  if (!b) return null;
  const signed = v => v > 0 ? `+${v.toFixed(1)}` : pt(v);
  return [
    h("h3", { class: "section-title" }, "セミファイナル争い（6位以内が進出）"),
    h("section", { class: "card race" },
      h("div", { class: "race__row" },
        h("span", {}, `${b.rank}位・${b.rivalRank}位 ${teamShort(b.rival)} との差`), h("b", { class: ptClass(b.diff) }, signed(b.diff))),
      h("div", { class: "race__row" }, h("span", {}, "残り"), h("b", {}, `${b.remaining}半荘`)),
      h("div", { class: "race__pace" },
        b.inside
          ? [h("span", {}, "1半荘平均 "), h("b", { class: b.pace < 0 ? "neg" : "" }, pt(b.pace)), h("span", {}, " までなら6位以内を守れる計算")]
          : [h("span", {}, "1半荘平均 "), h("b", { class: "pos" }, `+${b.pace.toFixed(1)}`), h("span", {}, " で6位に届く計算")]),
      h("div", { class: "race__note" }, `（${b.inside ? "7位" : "6位"}がこの先±0で進んだ場合）`)),
  ];
}

// シーズン・ポイント・1〜4着の表（レギュラーとポストシーズンで共通）。sub = シーズンの下に出す小さな文字
function ranksTable(rows, sub) {
  return h("table", { class: "career team-ranks" },
    h("thead", {}, h("tr", {}, h("th", {}, "シーズン"), h("th", {}, "ポイント"), [1, 2, 3, 4].map(k => h("th", {}, `${k}着`)))),
    h("tbody", {}, rows.map(r => h("tr", { class: r.current ? "is-current" : "" },
      h("td", {}, h("div", { class: "career__season" }, r.season, r.current ? h("span", { class: "badge badge--next" }, "今季") : null),
        h("div", { class: "career__team" }, sub(r))),
      h("td", { class: "strong " + ptClass(r.points) }, pt(r.points)),
      [1, 2, 3, 4].map(k => h("td", {}, int(r["r" + k])))))));
}

function teamCareer(t, favBtn, tabs) {
  const rows = teamCareerRows(t);
  const total = teamTotal(rows);
  const post = teamPostRows(t);
  if (!total) return [hero(teamName(t)), favBtn, tabs, h("p", { class: "empty" }, "通算成績はまだありません")];
  const first = rows.at(-1).season;
  const stageLabel = { SF: "セミファイナル", F: "ファイナル" };
  return [
    hero(teamName(t), `${first}〜・${rows.length}シーズン`, total.points, "通算（レギュラー）"),
    favBtn,
    tabs,
    h("h3", { class: "section-title" }, "レギュラー通算"),
    rankStats(total, { points: true }),
    h("h3", { class: "section-title" }, "シーズン別"),
    h("section", { class: "card" }, ranksTable(rows, r => r.rank ? `${r.rank}位` : "")),
    note("レギュラーシーズンの成績です。過去シーズンの着順は、各選手の成績をチームごとに合計しています。"),
    post.length ? [
      h("h3", { class: "section-title" }, "ポストシーズン"),
      h("section", { class: "card" }, ranksTable(post, r => stageLabel[r.stage])),
      note(`ステージ内の成績です（持ち越しポイントは含みません）。${post.some(r => r.current) && state.data.postseasonAsOf ? `今季の分は${dayLabel(state.data.postseasonAsOf)}終了時点（毎日3時にまとめて更新）。` : ""}`),
    ] : null,
    sourceNote(rows.filter(r => !r.current).map(r => r.season)),
  ];
}

// ---------- 推しチームの選択（1チームだけ） ----------
function openFavPicker() {
  const pick = team => { setFav(team); closeSheet(); };
  show(() => [
    h("div", { class: "hero" }, h("div", {}, h("h2", { id: "sheet-title" }, "推しチーム"),
      h("div", { class: "prow__meta" }, "日程・チーム順位・結果で色付けして表示します"))),
    h("div", { class: "fav-grid", role: "radiogroup", "aria-label": "推しチーム" },
      state.data.standings.map(r => h("button", { class: "fav-opt", type: "button", role: "radio", "aria-checked": String(state.fav === r.team), onclick: () => pick(r.team) },
        h("span", { class: "fav-opt__radio", "aria-hidden": "true" }), teamShort(r.team)))),
    h("button", { class: "fav-opt fav-opt--none", type: "button", role: "radio", "aria-checked": String(!state.fav), onclick: () => pick(null) }, "設定しない"),
    h("label", { class: "switch-row" },
      h("span", {}, h("b", {}, "日程の一番上にまとめを表示"), h("small", {}, "順位・ボーダー・今日の対局・直近の着順")),
      h("input", { type: "checkbox", role: "switch", checked: state.showFavSummary ? true : null,
        onchange: e => { set({ showFavSummary: e.target.checked }); redrawSheet(); } })),
    h("label", { class: "switch-row" },
      h("span", {}, h("b", {}, "セミファイナル争いを表示"), h("small", {}, "6位以内に必要な1半荘平均の目安（チームの画面・まとめ）")),
      h("input", { type: "checkbox", role: "switch", checked: state.showBorderRace ? true : null,
        onchange: e => { set({ showBorderRace: e.target.checked }); redrawSheet(); } })),
  ]);
}

export function initSheets() {
  Object.assign(actions, { openPlayer, openTeam, openMatch, openFavPicker });
  $("#sheet").addEventListener("click", e => { if (e.target.closest("[data-close]")) closeSheet(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });
  window.addEventListener("popstate", () => closeSheet(true));
}
