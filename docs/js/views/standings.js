// 順位タブ: 今季の順位表とポイント推移、過去シーズンのステージ別最終順位、歴代1位

import { actions } from "../actions.js";
import { drawProgression } from "../chart.js";
import { note, sectionTitle, sourceNote } from "../components.js";
import { chipRow, h, pressable } from "../dom.js";
import { dayLabel, pt, ptClass } from "../format.js";
import { borderDiffs, SEMIFINAL_SPOTS, standingSeasons, standingsProgress, teamPlacements, teamShort } from "../model.js";
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

// 右側の列の切り替え（標準／ボーダー／着順）
const COLS = {
  standard: { label: "標準", head: ["差", "試合"], cells: r => [
    h("td", { class: "sub" }, r.diff == null ? "―" : pt(r.diff)),
    h("td", { class: "sub" }, `${r.games}/${r.totalGames}`)] },
  border: { label: "ボーダー", head: ["ボーダー", "試合"], cells: (r, x) => [
    h("td", { class: "border " + ptClass(x.border[r.team]) }, signed(x.border[r.team])),
    h("td", { class: "sub" }, `${r.games}/${r.totalGames}`)] },
  placements: { label: "着順", head: ["1着", "2着", "3着", "4着"], cells: (r, x) =>
    (x.places[r.team] ?? [0, 0, 0, 0]).map(n => h("td", { class: "sub place" }, n)) },
};
function signed(v) { return v == null ? "―" : v > 0 ? `+${v.toFixed(1)}` : v < 0 ? pt(v) : "0.0"; }

function current() {
  const key = COLS[state.standingsCols] ? state.standingsCols : "standard";
  const cols = COLS[key];
  const extra = { border: borderDiffs(), places: teamPlacements() };
  const table = h("table", { class: "standings cols-" + key },
    h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, "チーム"), h("th", {}, "ポイント"), cols.head.map(t => h("th", {}, t)))),
    h("tbody", {}, state.data.standings.map(r => h("tr", { class: (r.rank === SEMIFINAL_SPOTS + 1 ? "is-cut " : "") + (r.team === state.fav ? "is-fav" : ""), style: "cursor:pointer", onclick: () => actions.openTeam(r.team) },
      h("td", { class: "rank" + (r.rank === 1 ? " rank-1" : "") }, r.rank),
      h("td", { class: "team" }, teamShort(r.team)),
      h("td", { class: "pts " + ptClass(r.points) }, pt(r.points)),
      cols.cells(r, extra)))));
  const colNote = {
    standard: "差は1つ上のチームとのポイント差です。",
    border: "ボーダー差は、1〜6位は7位との差（リード）、7位以下は6位との差（届くまで）です。",
    placements: "着順は今季の試合結果から数えています。試合結果の反映が順位表より少し遅れる間は、試合数と1試合ずれることがあります。",
  }[key];
  return [
    sectionTitle("チーム順位（レギュラーシーズン）"),
    progressLine(),
    chipRow(Object.entries(COLS).map(([k, c]) => [k, c.label]), key, v => set({ standingsCols: v })),
    h("section", { class: "card" }, table),
    note(`破線より上の6チームがセミファイナル進出圏。${colNote}チームをタップすると所属選手の成績と過去シーズンの結果が見られます。`),
    sectionTitle("ポイント推移"),
    h("section", { class: "card chart-card" }, h("div", { id: "chart" }), h("div", { class: "legend", id: "legend" })),
    note("チーム名をタップすると最大3チームまで色付きで比較できます。グラフをなぞると各日の全チームのポイントが見られます。"),
  ];
}

// 順位表に今日のどの試合まで入っているか
// 例: 「9/29（火） 1卓目・2卓目とも第1回戦 対局中」「9/29（火） 1卓目 第1回戦 終了・2卓目 第1回戦 対局中」
function progressLine() {
  const p = standingsProgress();
  if (!p) return null;
  if (p.tables.every(t => t.done === 2)) {
    return h("div", { class: "asof" }, h("span", { class: "asof__main" }, `${dayLabel(p.day)}の全試合を反映済み`));
  }
  const status = t => t.playing ? `第${t.started}回戦 対局中` : t.done > 0 ? `第${t.done}回戦 終了` : "開始前";
  const statuses = p.tables.map(status);
  let main;
  if (p.single) main = statuses[0];
  else if (new Set(statuses).size === 1) main = `${p.tables.map(t => `${t.no}卓目`).join("・")}とも${statuses[0]}`;
  else main = p.tables.map((t, i) => `${t.no}卓目 ${statuses[i]}`).join("・");
  const anyDone = p.tables.some(t => t.done > 0);
  const anyStarted = p.tables.some(t => t.started > 0);
  const sub = anyDone
    ? "終わった半荘までのポイントです。次の取り込みで更新されます（数分〜30分程度）"
    : p.prevDay ? `順位表は${dayLabel(p.prevDay)}終了時点のポイントです` : "開幕前のポイントです";
  return h("div", { class: "asof asof--pending" },
    h("span", { class: "asof__main" }, anyStarted ? `${dayLabel(p.day)} ${main}` : `${dayLabel(p.day)}の試合はまだ始まっていません`),
    h("span", { class: "asof__sub" }, sub));
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
