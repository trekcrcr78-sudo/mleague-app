// 下から出てくる詳細シート（試合・選手・チーム）

import { actions } from "./actions.js";
import { gameBlock, note, resultCard, sourceNote, stat, teamTag } from "./components.js";
import { $, h, pressable, segmented } from "./dom.js";
import { dayLabel, dec2, int, pct, pt, ptClass, round1 } from "./format.js";
import { aggregate, allMatches, currentPlayer, isActive, playerLog, seasonRows, teamName, teamOfPlayer, teamShort } from "./model.js";
import { setFav, state } from "./store.js";

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
  show(() => [hero(`${dayLabel(m.date)}の結果`), h("div", { class: "games" }, m.games.map(gameBlock))]);
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
  const span = total.firstSeason === total.lastSeason ? total.firstSeason : `${total.firstSeason}〜${isActive(name) ? "" : total.lastSeason}`;
  return [
    hero(name, [teamTag(team), `${span}・${total.seasons}シーズン`], total.points, "通算ポイント"),
    tabs,
    h("div", { class: "stat-grid" },
      stat("半荘数", int(total.games)), stat("1半荘平均", pt(total.perGame), ptClass(total.perGame)), stat("平均着順", dec2(total.avgRank)),
      stat("トップ数", total.r1 == null ? "–" : `${int(total.r1)}回`), stat("トップ率", pct(total.topRate)), stat("4着回避率", pct(total.lastAvoidRate)),
      stat("最高スコア", int(total.bestScore)), stat("平均打点（目安）", int(total.avgWin))),
    h("h3", { class: "section-title" }, "シーズン別"),
    h("section", { class: "card" }, h("table", { class: "career" },
      h("thead", {}, h("tr", {}, h("th", {}, "シーズン"), h("th", {}, "ポイント"), h("th", {}, "半荘"), h("th", {}, "トップ"), h("th", {}, "4着回避"))),
      h("tbody", {}, rows.map(r => h("tr", { class: (r.current ? "is-current" : "") + (r.season === highlight ? " is-highlight" : "") },
        h("td", {}, h("div", { class: "career__season" }, r.season, r.current ? h("span", { class: "badge badge--next" }, "今季") : null),
          h("div", { class: "career__team" }, teamShort(r.team))),
        h("td", {}, h("div", { class: "career__pts " + ptClass(r.points) }, pt(r.points)),
          h("div", { class: "bar" }, h("span", { class: "bar__fill " + (r.points < 0 ? "is-neg" : "is-pos"), style: `width:${(Math.abs(r.points || 0) / maxAbs * 100).toFixed(1)}%` }))),
        h("td", {}, int(r.games)),
        h("td", {}, r.r1 == null ? "–" : int(r.r1)),
        h("td", {}, pct(r.lastAvoidRate))))))),
    note("レギュラーシーズンの成績です。チームは各シーズン当時の所属です。平均打点はアガリ回数が公開されていないため、半荘数で重み付けした目安です。"),
    sourceNote(rows.filter(r => !r.current).map(r => r.season)),
  ];
}

// ---------- チーム ----------
function openTeam(t) {
  show(() => {
    const row = state.data.standings.find(r => r.team === t);
    const members = state.data.players.filter(p => p.team === t).sort((a, b) => b.points - a.points);
    const recent = allMatches().filter(m => m.games.length && m.teams.includes(t)).reverse().slice(0, 5);
    const past = Object.entries(state.history?.teamRegular?.[t] ?? {}).reverse();
    return [
      hero(teamName(t), row ? `${row.rank}位・${row.games}/${row.totalGames}試合` : "", row?.points, "ポイント"),
      h("button", { class: "fav-btn", type: "button", "aria-pressed": String(state.fav === t), onclick: () => setFav(state.fav === t ? null : t) },
        state.fav === t ? "★ 推しチームに設定中" : "☆ 推しチームにする"),
      h("h3", { class: "section-title" }, "所属選手"),
      h("section", { class: "card" }, h("ol", { class: "plist" }, members.map(p => h("li", { class: "prow", ...pressable(() => actions.openPlayer(p.name)) },
        h("span", { class: "prow__rank" }, ""),
        h("div", {}, h("div", { class: "prow__name" }, p.name), h("div", { class: "prow__meta" }, `${int(p.games)}試合・平均着順 ${dec2(p.avgRank)}`)),
        h("div", { class: "prow__val " + ptClass(p.points) }, pt(p.points)))))),
      recent.length ? [h("h3", { class: "section-title" }, "直近の試合"), recent.map(resultCard)] : null,
      past.length ? [
        h("h3", { class: "section-title" }, "過去シーズンの成績（レギュラー）"),
        h("section", { class: "card" }, h("table", { class: "career" },
          h("thead", {}, h("tr", {}, h("th", {}, "シーズン"), h("th", {}, "ポイント"))),
          h("tbody", {}, past.map(([season, v]) => h("tr", {}, h("td", {}, season), h("td", { class: "strong " + ptClass(v) }, pt(round1(v)))))))),
      ] : null,
    ];
  });
}

// ---------- 推しチームの選択（1チームだけ） ----------
function openFavPicker() {
  const pick = team => { setFav(team); closeSheet(); };
  show(() => [
    h("div", { class: "hero" }, h("div", {}, h("h2", { id: "sheet-title" }, "推しチーム"),
      h("div", { class: "prow__meta" }, "日程・順位・個人成績で色付けして表示します"))),
    h("div", { class: "fav-grid", role: "radiogroup", "aria-label": "推しチーム" },
      state.data.standings.map(r => h("button", { class: "fav-opt", type: "button", role: "radio", "aria-checked": String(state.fav === r.team), onclick: () => pick(r.team) },
        h("span", { class: "fav-opt__radio", "aria-hidden": "true" }), teamShort(r.team)))),
    h("button", { class: "fav-opt fav-opt--none", type: "button", role: "radio", "aria-checked": String(!state.fav), onclick: () => pick(null) }, "設定しない"),
  ]);
}

export function initSheets() {
  Object.assign(actions, { openPlayer, openTeam, openMatch, openFavPicker });
  $("#sheet").addEventListener("click", e => { if (e.target.closest("[data-close]")) closeSheet(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });
  window.addEventListener("popstate", () => closeSheet(true));
}
