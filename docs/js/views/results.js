// 結果タブ: 試合結果と役満の一覧
import { note, resultCard, sourceNote, yakumanCard } from "../components.js";
import { chipRow, h } from "../dom.js";
import { allMatches, teamShort, yakumanRows } from "../model.js";
import { set, state } from "../store.js";

export function viewResults() {
  const view = state.resultView === "yakuman" ? "yakuman" : "results";
  const team = state.resultTeam;
  const controls = [
    chipRow([["results", "試合結果"], ["yakuman", "役満"]], view, v => set({ resultView: v })),
    chipRow([["all", "全チーム"], ...state.data.standings.map(r => [r.team, teamShort(r.team)])], team, v => set({ resultTeam: v })),
  ];
  if (view === "yakuman") return [controls, yakumanView(team)];
  let list = allMatches().filter(m => m.games.length).reverse();
  if (team !== "all") list = list.filter(m => m.teams.includes(team));
  return [controls, list.length ? list.map(m => resultCard(m, { markFav: true })) : h("p", { class: "empty" }, "まだ結果がありません")];
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
