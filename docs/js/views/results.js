// 結果タブ: 試合結果と役満の一覧
import { gameBlock, note, sourceNote, statusBadge, yakumanCard } from "../components.js";
import { chipRow, h } from "../dom.js";
import { dayLabel } from "../format.js";
import { allMatches, matchStatus, tableNo, teamShort, yakumanRows } from "../model.js";
import { set, state } from "../store.js";

export function viewResults() {
  const view = state.resultView === "yakuman" ? "yakuman" : "results";
  const team = state.resultTeam;
  const controls = [
    chipRow([["results", "試合結果"], ["yakuman", "役満"]], view, v => set({ resultView: v })),
    chipRow([["all", "全チーム"], ...state.data.standings.map(r => [r.team, teamShort(r.team)])], team, v => set({ resultTeam: v })),
  ];
  if (view === "yakuman") return [controls, yakumanView(team)];
  const matches = allMatches();
  const tablesOn = new Map();
  for (const m of matches) tablesOn.set(m.date, (tablesOn.get(m.date) || 0) + 1);
  let list = matches.filter(m => m.games.length);
  if (team !== "all") list = list.filter(m => m.teams.includes(team));
  // 日付ごとにまとめる（日付は新しい順、同じ日の中は1卓目→2卓目）
  const byDate = new Map();
  for (const m of list) { if (!byDate.has(m.date)) byDate.set(m.date, []); byDate.get(m.date).push(m); }
  const days = [...byDate].reverse().map(([d, ms]) => dayCard(d, ms.sort((a, b) => tableNo(a) - tableNo(b)), tablesOn.get(d)));
  return [controls, days.length ? days : h("p", { class: "empty" }, "まだ結果がありません")];
}

// 1日分の結果。卓ごとに枠で分け、推しチームの卓は緑の枠にする
function dayCard(date, ms, tablesThatDay) {
  return h("section", { class: "card rday" },
    h("div", { class: "rday__date" }, dayLabel(date)),
    ms.map(m => {
      const fav = state.fav && m.teams.includes(state.fav);
      return h("div", { class: "rtable" + (fav ? " is-fav" : "") },
        h("div", { class: "rtable__head" },
          tablesThatDay > 1 ? h("span", { class: "rtable__no" }, `${tableNo(m)}卓目`) : null,
          h("span", { class: "rtable__status" }, statusBadge(matchStatus(m), m))),
        h("div", { class: "games" }, m.games.map(g => gameBlock(g, { markFav: fav }))));
    }));
}

function yakumanView(team) {
  let rows = yakumanRows();
  if (team !== "all") rows = rows.filter(r => r.winnerTeam === team || r.loserTeam === team);
  const counts = {};
  for (const r of rows) counts[r.yaku] = (counts[r.yaku] || 0) + 1;
  const summary = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return [
    summary.length ? h("div", { class: "yk-sum" }, summary.map(([yaku, n]) => h("div", {}, h("b", {}, n), h("span", {}, yaku)))) : null,
    rows.length ? rows.map(r => yakumanCard(r, { markFav: true })) : h("p", { class: "empty" }, "該当する役満はありません"),
    note(team === "all"
      ? "Mリーグ公式戦（レギュラー・セミファイナル・ファイナル）で出た役満です。"
      : `${teamShort(team)}の選手がアガった、または放銃した役満です（チームは当時の所属）。`),
    sourceNote(["yakuman"]),
  ];
}
