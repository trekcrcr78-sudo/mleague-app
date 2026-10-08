import { actions } from "../actions.js";
import { sectionTitle, statusBadge, teamTag, note, watchButton } from "../components.js";
import { h, pressable } from "../dom.js";
import { DOW, dayLabel, dowOf, mdLabel, pt, ptClass, todayStr } from "../format.js";
import { allMatches, borderDiffs, borderRace, favSummary, matchStatus, tableNo, teamShort } from "../model.js";
import { set, state } from "../store.js";


function matchRow(m, tablesThatDay) {
  const clickable = m.games.length > 0;
  const fav = state.fav && m.teams.includes(state.fav);
  return h("div", { class: "match" + (clickable ? " is-clickable" : "") + (fav ? " is-fav" : ""), ...(clickable ? pressable(() => actions.openMatch(m)) : {}) },
    h("div", { class: "match__head" },
      tablesThatDay > 1 ? h("span", { class: "match__table" }, `${tableNo(m)}卓目`) : null,
      h("span", { class: "match__status" }, statusBadge(matchStatus(m), m))),
    h("div", { class: "match__teams" }, m.teams.map(t => teamTag(t, { markFav: true }))),
    watchButton(m));
}

// 推しチームのまとめ（A案）: 順位・ポイント・ボーダー、今日（なければ次）の対局、直近5半荘の着順
function favSummaryCard(team) {
  const st = state.data.standings.find(r => r.team === team);
  if (!st) return null;
  const border = borderDiffs()[team];
  const n = state.favRecent === 10 ? 10 : 5;
  const s = favSummary(team, n);
  const num = (label, value, cls = "") => h("div", {}, h("span", {}, label), h("b", { class: cls }, value));
  const signed = v => v == null ? "―" : v > 0 ? `+${v.toFixed(1)}` : pt(v);
  let matchBox = null;
  if (s.match) {
    const m = s.match;
    const others = m.teams.filter(t => t !== team).map(teamShort).join("・");
    const table = s.tablesThatDay > 1 ? `${tableNo(m)}卓目` : "";
    matchBox = h("div", { class: "favsum__match" },
      h("div", { class: "favsum__label" },
        h("span", {}, `${s.isToday ? "今日" : "次の対局"} ${dayLabel(m.date)} ${table}`.trim()), statusBadge(matchStatus(m), m)),
      h("div", { class: "favsum__vs" }, `vs ${others}`),
      watchButton(m));
  }
  return h("section", { class: "card favsum", ...pressable(() => actions.openTeam(team)) },
    h("div", { class: "favsum__head" }, h("span", { class: "favsum__name" }, teamShort(team)), h("span", { class: "favsum__more" }, "チーム詳細 ›")),
    h("div", { class: "favsum__nums" },
      num("順位", `${st.rank}位`), num("ポイント", pt(st.points), ptClass(st.points)), num("ボーダー", signed(border), ptClass(border))),
    raceLine(team),
    matchBox,
    s.recent.length ? h("div", { class: "favsum__form" + (n === 10 ? " is-10" : "") },
      h("div", { class: "favsum__label" }, h("span", {}, `直近${s.recent.length}半荘の着順（新しい→古い）`), recentToggle(n)),
      h("div", { class: "favsum__dots" }, s.recent.map((r, i) => h("span", { class: "favsum__dot" + (r === 1 ? " r1" : "") + (i === 0 ? " is-latest" : "") }, r))),
      n === 10 ? recentBreakdown(s.recent) : null) : null);
}

// セミファイナル争いの1行（詳しくはチームの画面）
function raceLine(team) {
  const b = state.showBorderRace ? borderRace(team) : null;
  if (!b) return null;
  return h("div", { class: "favsum__race" }, b.inside
    ? `6位以内キープ：1半荘平均 ${pt(b.pace)} まで`
    : `6位まで：1半荘平均 +${b.pace.toFixed(1)} 必要`);
}

// 5／10 半荘の切り替え（カードのタップでチーム詳細が開かないよう、押したときは止める）
function recentToggle(n) {
  return h("span", { class: "favsum__toggle", role: "group", "aria-label": "直近の半荘数" },
    [5, 10].map(v => h("button", { type: "button", "aria-pressed": String(v === n),
      onclick: e => { e.stopPropagation(); set({ favRecent: v }); },
      onkeydown: e => e.stopPropagation() }, v)));
}

function recentBreakdown(recent) {
  const c = [1, 2, 3, 4].map(k => recent.filter(r => r === k).length);
  const avg = recent.reduce((a, r) => a + r, 0) / recent.length;
  return h("div", { class: "favsum__breakdown" }, `1着${c[0]}回・2着${c[1]}回・3着${c[2]}回・4着${c[3]}回（平均着順 ${avg.toFixed(2)}）`);
}

export function viewSchedule() {
  const matches = allMatches();
  const today = todayStr();
  const out = [];
  const tablesOn = new Map();
  const favDays = new Set();
  for (const m of matches) {
    tablesOn.set(m.date, (tablesOn.get(m.date) || 0) + 1);
    if (state.fav && m.teams.includes(state.fav)) favDays.add(m.date);
  }
  const row = m => matchRow(m, tablesOn.get(m.date));
  if (state.fav && state.showFavSummary) out.push(favSummaryCard(state.fav));

  // 今日（なければ次の開催日）
  const nextDate = matches.find(m => m.date >= today)?.date;
  if (nextDate) {
    const isToday = nextDate === today;
    out.push(sectionTitle(isToday ? "本日の対局" : "次の対局"),
      h("section", { class: "card today" },
        h("div", { class: "today__head" }, h("span", { class: "today__date" }, `${isToday ? "今日" : "次の対局"} ${dayLabel(nextDate)}`)),
        h("div", { class: "matches" }, matches.filter(m => m.date === nextDate).map(row))));
  }

  // 月ごと
  const months = Object.keys(state.data.matchesByMonth).sort();
  if (!state.month || !months.includes(state.month)) {
    const cur = today.slice(0, 7);
    state.month = months.includes(cur) ? cur : (cur < months[0] ? months[0] : months[months.length - 1]);
    state.scrollToday = true;
  }
  const pick = (patch) => set(patch);
  out.push(sectionTitle("シーズン日程"), h("div", { class: "month-nav" },
    h("div", { class: "chips", role: "tablist" }, months.map(k => h("button", { class: "chip", type: "button", "aria-pressed": String(k === state.month),
      onclick: () => pick({ month: k }) }, `${Number(k.slice(5))}月`))),
    state.fav ? h("div", { class: "chips" },
      h("button", { class: "chip", type: "button", "aria-pressed": String(state.scheduleFilter === "all"), onclick: () => pick({ scheduleFilter: "all" }) }, "すべて"),
      h("button", { class: "chip", type: "button", "aria-pressed": String(state.scheduleFilter === "fav"), onclick: () => pick({ scheduleFilter: "fav" }) }, `${teamShort(state.fav)}の試合`)) : null));

  let list = state.data.matchesByMonth[state.month] || [];
  if (state.scheduleFilter === "fav" && state.fav) list = list.filter(m => m.teams.includes(state.fav));
  const byDate = new Map();
  for (const m of list) { if (!byDate.has(m.date)) byDate.set(m.date, []); byDate.get(m.date).push(m); }
  const card = h("section", { class: "card" }, [...byDate].map(([d, ms]) => {
    const dw = dowOf(d);
    return h("div", { class: "day" + (d === today ? " is-today" : "") },
      h("div", { class: "day__date" }, h("div", { class: "day__md" }, mdLabel(d)), h("div", { class: "day__dow" + (dw === 6 ? " sat" : dw === 0 ? " sun" : "") }, DOW[dw]),
        favDays.has(d) ? h("span", { class: "day__fav", title: `${teamShort(state.fav)}の試合あり` }) : null),
      h("div", { class: "matches" }, ms.map(row)));
  }));
  out.push(byDate.size ? card : h("p", { class: "empty" }, "この月の試合はありません"), note("終了した試合をタップすると結果が見られます。"));
  return out;
}

export function afterSchedule() {
  const t = document.querySelector(".day.is-today");
  if (t && state.scrollToday) { t.scrollIntoView({ block: "center" }); state.scrollToday = false; }
}
