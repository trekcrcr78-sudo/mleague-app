import { resultCard } from "../components.js";
import { chipRow, h } from "../dom.js";
import { allMatches, teamShort } from "../model.js";
import { set, state } from "../store.js";

export function viewResults() {
  let list = allMatches().filter(m => m.games.length).reverse();
  if (state.resultTeam !== "all") list = list.filter(m => m.teams.includes(state.resultTeam));
  return [
    chipRow([["all", "全チーム"], ...state.data.standings.map(r => [r.team, teamShort(r.team)])], state.resultTeam, v => set({ resultTeam: v })),
    list.length ? list.map(m => resultCard(m, { markFav: true })) : h("p", { class: "empty" }, "まだ結果がありません"),
  ];
}
