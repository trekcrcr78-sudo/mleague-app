// 下から出てくる詳細シート（試合・選手・チーム）

import { actions } from "./actions.js";
import { gameBlock, note, resultCard, stat, teamTag } from "./components.js";
import { $, chipRow, h, pressable, segmented } from "./dom.js";
import { dayLabel, dec2, int, pct, pt, ptClass, STAGE_LABEL, STAGE_ORDER } from "./format.js";
import { aggregate, allMatches, currentPlayer, currentStages, playerLog, seasonRows, teamName, teamOfPlayer, trackedSince } from "./model.js";
import { set, state } from "./store.js";

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

// ---------- 選手 ----------
function openPlayer(name, opts = {}) {
  const ui = { view: opts.view || "season", stage: opts.stage || "R" };
  const rerender = patch => { Object.assign(ui, patch); redrawSheet(); };
  show(() => {
    const team = teamOfPlayer(name);
    const rows = seasonRows(name);
    const tabs = segmented([["season", `今季（${state.data.season}）`], ["career", "通算"]], ui.view, v => rerender({ view: v }));
    if (ui.view === "career") return playerCareer(name, team, rows, tabs);
    return playerSeason(name, team, ui, tabs, rerender);
  });
}

function playerSeason(name, team, ui, tabs, rerender) {
  const stages = currentStages().filter(s => currentPlayer(name, s)?.games);
  const stage = stages.includes(ui.stage) ? ui.stage : stages[0];
  const p = stage ? currentPlayer(name, stage) : null;
  const log = playerLog(name);
  if (!p) {
    return [hero(name, [teamTag(team), "今季の出場なし"]), tabs, h("p", { class: "empty" }, "今季はまだ出場がありません")];
  }
  return [
    hero(name, [teamTag(team), `${int(p.games)}試合・${int(p.hands)}局`], p.points, stages.length > 1 ? `${STAGE_LABEL[stage]}のポイント` : "ポイント"),
    tabs,
    stages.length > 1 ? chipRow(stages.map(s => [s, STAGE_LABEL[s]]), stage, v => rerender({ stage: v })) : null,
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

function playerCareer(name, team, rows, tabs) {
  const total = aggregate(rows);
  if (!total) return [hero(name, [teamTag(team)]), tabs, h("p", { class: "empty" }, "通算成績はまだありません")];
  const since = trackedSince();
  const maxAbs = Math.max(...rows.map(r => Math.abs(r.points || 0)), 1);
  const stageCards = STAGE_ORDER.map(s => {
    const a = aggregate(rows.filter(r => r.stage === s));
    return h("div", { class: "stage-card" },
      h("div", { class: "stage-card__label" }, STAGE_LABEL[s]),
      a ? [h("div", { class: "stage-card__pts " + ptClass(a.points) }, pt(a.points)),
           h("div", { class: "stage-card__sub" }, `${int(a.games)}半荘・平均 ${pt(a.perGame)}`)]
        : h("div", { class: "stage-card__sub" }, s === "R" ? "出場なし" : `記録なし`));
  });
  return [
    hero(name, [teamTag(team), `${total.firstSeason}〜・${total.seasons}シーズン`], total.points, "通算ポイント"),
    tabs,
    h("div", { class: "stat-grid" },
      stat("半荘数", int(total.games)), stat("1半荘平均", pt(total.perGame), ptClass(total.perGame)), stat("4着回避率", pct(total.lastAvoidRate)),
      stat("最高スコア", int(total.bestScore)), stat("平均打点（目安）", int(total.avgWin))),
    h("h3", { class: "section-title" }, "ステージ別"),
    h("div", { class: "stage-cards" }, stageCards),
    h("h3", { class: "section-title" }, "シーズン別"),
    h("section", { class: "card" }, h("table", { class: "career" },
      h("thead", {}, h("tr", {}, h("th", {}, "シーズン"), h("th", {}, "ポイント"), h("th", {}, "半荘"), h("th", {}, "4着回避"))),
      h("tbody", {}, rows.map(r => h("tr", { class: r.current ? "is-current" : "" },
        h("td", {}, h("div", { class: "career__season" }, r.season, r.current ? h("span", { class: "badge badge--next" }, "今季") : null),
          h("div", { class: "career__stage" }, STAGE_LABEL[r.stage])),
        h("td", {}, h("div", { class: "career__pts " + ptClass(r.points) }, pt(r.points)),
          h("div", { class: "bar" }, h("span", { class: "bar__fill " + (r.points < 0 ? "is-neg" : "is-pos"), style: `width:${(Math.abs(r.points || 0) / maxAbs * 100).toFixed(1)}%` }))),
        h("td", {}, int(r.games)),
        h("td", {}, pct(r.lastAvoidRate))))))),
    note(`過去シーズンのセミファイナル・ファイナルの個人成績は公式サイトで公開されていないため、${since}シーズンから記録しています。平均打点は半荘数で重み付けした目安です。`),
  ];
}

// ---------- チーム ----------
function openTeam(t) {
  show(() => {
    const row = state.data.standings.find(r => r.team === t);
    const members = (state.data.stages.R ?? []).filter(p => p.team === t).sort((a, b) => b.points - a.points);
    const recent = allMatches().filter(m => m.games.length && m.teams.includes(t)).reverse().slice(0, 5);
    const past = Object.entries(state.history?.teamStages?.[t] ?? {}).reverse();
    const cell = v => v ? h("td", { class: ptClass(v) }, pt(v)) : h("td", { class: "muted" }, "―");
    return [
      hero(teamName(t), row ? `${row.rank}位・${row.games}/${row.totalGames}試合` : "", row?.points, "ポイント"),
      h("button", { class: "fav-btn", type: "button", "aria-pressed": String(state.fav === t), onclick: () => {
        const fav = state.fav === t ? null : t;
        set({ fav, ...(fav && !(state.chartTeams || []).includes(t) ? { chartTeams: null } : {}) });
        redrawSheet();
      } }, state.fav === t ? "★ 推しチームに設定中" : "☆ 推しチームにする"),
      h("h3", { class: "section-title" }, "所属選手"),
      h("section", { class: "card" }, h("ol", { class: "plist" }, members.map(p => h("li", { class: "prow", ...pressable(() => actions.openPlayer(p.name)) },
        h("span", { class: "prow__rank" }, ""),
        h("div", {}, h("div", { class: "prow__name" }, p.name), h("div", { class: "prow__meta" }, `${int(p.games)}試合・平均着順 ${dec2(p.avgRank)}`)),
        h("div", { class: "prow__val " + ptClass(p.points) }, pt(p.points)))))),
      recent.length ? [h("h3", { class: "section-title" }, "直近の試合"), recent.map(resultCard)] : null,
      past.length ? [
        h("h3", { class: "section-title" }, "過去シーズンの成績（チーム）"),
        h("section", { class: "card" }, h("table", { class: "career team-hist" },
          h("thead", {}, h("tr", {}, h("th", {}, "シーズン"), h("th", {}, "レギュラー"), h("th", {}, "セミF"), h("th", {}, "ファイナル"), h("th", {}, "合計"))),
          h("tbody", {}, past.map(([season, v]) => {
            const sum = (v.R || 0) + (v.SF || 0) + (v.F || 0);
            return h("tr", {}, h("td", {}, season), cell(v.R), cell(v.SF), cell(v.F), h("td", { class: "strong " + ptClass(sum) }, pt(Math.round(sum * 10) / 10)));
          })))),
        note("―はそのステージに進出していないシーズンです（2018-19はセミファイナルなし）。"),
      ] : null,
    ];
  });
}

export function initSheets() {
  Object.assign(actions, { openPlayer, openTeam, openMatch });
  $("#sheet").addEventListener("click", e => { if (e.target.closest("[data-close]")) closeSheet(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });
  window.addEventListener("popstate", () => closeSheet(true));
}
