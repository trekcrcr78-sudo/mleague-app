// 順位タブ: 今季の順位表とポイント推移、過去シーズンのステージ別最終順位、歴代1位

import { actions } from "../actions.js";
import { drawProgression } from "../chart.js";
import { note, sectionTitle, sourceNote } from "../components.js";
import { chipRow, h, pressable } from "../dom.js";
import { pt, ptClass } from "../format.js";
import { standingSeasons, teamShort } from "../model.js";
import { set, state } from "../store.js";

const STAGES = [["F", "ファイナル"], ["SF", "セミファイナル"], ["R", "レギュラーシーズン"]];

export function viewStandings() {
  const view = state.standingsView;
  const seasons = standingSeasons();
  const scope = seasons.length && ["past", "champions"].includes(view.scope) ? view.scope : "current";
  const setView = patch => set({ standingsView: { ...view, ...patch } });

  const controls = h("div", { class: "controls" },
    chipRow([["current", `今季（${state.data.season}）`], ["past", "シーズン別"], ["champions", "歴代1位"]], scope, v => setView({ scope: v })),
    scope === "past" ? chipRow(seasons.map(s => [s, s]), pickSeason(seasons, view.season), v => setView({ season: v })) : null);

  if (scope === "past") return [controls, pastSeason(pickSeason(seasons, view.season))];
  if (scope === "champions") return [controls, champions(seasons, s => setView({ scope: "past", season: s }))];
  return [controls, current()];
}

function pickSeason(seasons, s) { return seasons.includes(s) ? s : seasons[0]; }

function current() {
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

// 1ステージの最終順位。cutAfter: 次のステージに進んだチーム数（その下に破線）
function stageTable(rows, { cutAfter, champion }) {
  return h("section", { class: "card" }, h("table", { class: "standings" },
    h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, "チーム"), h("th", {}, "ポイント"))),
    h("tbody", {}, rows.map((r, i) => h("tr", {
      class: (cutAfter && i === cutAfter ? "is-cut " : "") + (r.team === state.fav ? "is-fav" : ""),
      style: "cursor:pointer", onclick: () => actions.openTeam(r.team),
    },
      h("td", { class: "rank" + (i === 0 ? " rank-1" : "") }, i + 1),
      h("td", { class: "team" }, teamShort(r.team), champion && i === 0 ? h("span", { class: "title-badge" }, "優勝") : null),
      h("td", { class: "pts " + ptClass(r.points) }, pt(r.points)))))));
}

function pastSeason(season) {
  const st = state.history.standings[season];
  const out = [];
  for (const [stage, label] of STAGES) {
    const rows = st[stage];
    if (!rows?.length) continue;
    const next = stage === "R" ? (st.SF ?? st.F) : stage === "SF" ? st.F : null;
    out.push(sectionTitle(label), stageTable(rows, { cutAfter: next?.length, champion: stage === "F" }));
  }
  out.push(note(`破線より上のチームが次のステージに進出。セミファイナルはレギュラーシーズンの半分、ファイナルはセミファイナルの半分のポイントを持ち越した最終ポイントです${st.SF ? "" : "（このシーズンはセミファイナルがなく、ファイナルはレギュラーシーズンの半分を持ち越し）"}。`),
    sourceNote(["teams"]));
  return out;
}

function champions(seasons, openSeason) {
  const first = (st, stage) => st[stage]?.[0]?.team;
  const cell = team => team
    ? h("td", { class: "team" + (team === state.fav ? " is-fav-text" : "") }, teamShort(team))
    : h("td", { class: "muted" }, "―");
  return [
    sectionTitle("各ステージの1位"),
    h("section", { class: "card" }, h("table", { class: "standings champions" },
      h("thead", {}, h("tr", {}, h("th", {}, "シーズン"), h("th", {}, "レギュラー"), h("th", {}, "セミF"), h("th", {}, "ファイナル"))),
      h("tbody", {}, seasons.map(s => {
        const st = state.history.standings[s];
        return h("tr", { ...pressable(() => openSeason(s)), style: "cursor:pointer" },
          h("td", { class: "season" }, s), cell(first(st, "R")), cell(first(st, "SF")), cell(first(st, "F")));
      })))),
    note("ファイナル1位がそのシーズンの優勝です。シーズンをタップすると、そのシーズンの順位が見られます。2018-19はセミファイナルがありません。"),
    sourceNote(["teams"]),
  ];
}

export function afterStandings() {
  const wrap = document.getElementById("chart");
  if (wrap) drawProgression(wrap, document.getElementById("legend"));
}
