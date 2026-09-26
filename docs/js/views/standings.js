import { actions } from "../actions.js";
import { drawProgression } from "../chart.js";
import { note, sectionTitle } from "../components.js";
import { h } from "../dom.js";
import { pt, ptClass } from "../format.js";
import { teamShort } from "../model.js";
import { state } from "../store.js";

export function viewStandings() {
  const table = h("table", { class: "standings" },
    h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, "チーム"), h("th", {}, "ポイント"), h("th", {}, "差"), h("th", {}, "試合"))),
    h("tbody", {}, state.data.standings.map(r => h("tr", { class: (r.rank === 7 ? "is-cut " : "") + (r.team === state.fav ? "is-fav" : ""), style: "cursor:pointer", onclick: () => actions.openTeam(r.team) },
      h("td", { class: "rank" + (r.rank === 1 ? " rank-1" : "") }, r.rank),
      h("td", { class: "team" }, teamShort(r.team)),
      h("td", { class: "pts " + ptClass(r.points) }, pt(r.points)),
      h("td", { class: "sub" }, r.diff == null ? "―" : pt(r.diff)),
      h("td", { class: "sub" }, `${r.games}/${r.totalGames}`)))));
  return [
    sectionTitle("チーム順位（レギュラーシーズン）"),
    h("section", { class: "card" }, table),
    note("破線より上の6チームがセミファイナル進出圏。チームをタップすると所属選手の成績と過去シーズンの結果が見られます。"),
    sectionTitle("ポイント推移"),
    h("section", { class: "card chart-card" }, h("div", { id: "chart" }), h("div", { class: "legend", id: "legend" })),
    note("チーム名をタップすると最大3チームまで色付きで比較できます。グラフをなぞると各日の全チームのポイントが見られます。"),
  ];
}

export function afterStandings() {
  const wrap = document.getElementById("chart");
  if (wrap) drawProgression(wrap, document.getElementById("legend"));
}
