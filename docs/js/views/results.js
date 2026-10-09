// 結果タブ: 試合結果と役満の一覧
import { gameBlock, note, sourceNote, statusBadge, yakumanCard } from "../components.js";
import { chipRow, h } from "../dom.js";
import { dayLabel, jstNow, todayStr } from "../format.js";
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
  const ofTeam = m => team === "all" || m.teams.includes(team);
  const day = postedDay(matches);
  const dayMatches = day ? matches.filter(m => m.date === day && ofTeam(m)).sort((a, b) => tableNo(a) - tableNo(b)) : [];
  // 結果のある卓に加えて、その日に結果が1卓でも載っていれば、未掲載の卓も「結果待ち」として並べる
  const anyPosted = dayMatches.some(m => m.games.length);
  const list = matches.filter(m => ofTeam(m) && (m.games.length || (anyPosted && m.date === day)));
  // 日付ごとにまとめる（日付は新しい順、同じ日の中は1卓目→2卓目）
  const byDate = new Map();
  for (const m of list) { if (!byDate.has(m.date)) byDate.set(m.date, []); byDate.get(m.date).push(m); }
  const days = [...byDate].reverse().map(([d, ms]) => dayCard(d, ms.sort((a, b) => tableNo(a) - tableNo(b)), tablesOn.get(d)));
  return [controls, postedLine(day, dayMatches, tablesOn.get(day)), days.length ? days : h("p", { class: "empty" }, "まだ結果がありません")];
}

// どの開催日の掲載状況を出すか: 今日に試合があれば19時以降は今日、それ以外は直前の開催日
function postedDay(matches) {
  const today = todayStr();
  const started = d => d < today || (d === today && jstNow().getUTCHours() >= 19);
  return [...new Set(matches.map(m => m.date))].filter(started).sort().at(-1) ?? null;
}

// 例: 「10/9（金） 1卓目 掲載済み・2卓目 未掲載」「✓ 10/9（金）の全試合の結果を掲載済み」
function postedLine(day, ms, tablesThatDay) {
  if (!day || !ms.length) return null;
  if (ms.every(m => m.games.length)) {
    return h("div", { class: "asof" }, h("span", { class: "asof__main" }, `${dayLabel(day)}の${ms.length > 1 ? "全試合の" : ""}結果を掲載済み`));
  }
  const status = m => m.games.length ? "掲載済み" : "未掲載";
  let main;
  if (tablesThatDay <= 1) main = `の結果は${status(ms[0])}`;
  else if (ms.length > 1 && new Set(ms.map(status)).size === 1) main = ` ${ms.map(m => `${tableNo(m)}卓目`).join("・")}とも${status(ms[0])}`;
  else main = " " + ms.map(m => `${tableNo(m)}卓目 ${status(m)}`).join("・");
  return h("div", { class: "asof asof--pending" }, h("span", { class: "asof__main" }, `${dayLabel(day)}${main}`));
}

// 1日分の結果。卓ごとに枠で分け、推しチームの卓は緑の枠にする
function dayCard(date, ms, tablesThatDay) {
  return h("section", { class: "card rday" },
    h("div", { class: "rday__date" }, dayLabel(date)),
    ms.map(m => {
      const fav = state.fav && m.teams.includes(state.fav);
      if (!m.games.length) {   // まだ結果が載っていない卓
        return h("div", { class: "rtable is-pending" + (fav ? " is-fav" : "") },
          h("div", { class: "rtable__head" }, tablesThatDay > 1 ? h("span", { class: "rtable__no" }, `${tableNo(m)}卓目`) : null),
          h("div", { class: "rtable__wait" }, "結果待ち"));
      }
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
