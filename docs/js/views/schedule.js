import { actions } from "../actions.js";
import { sectionTitle, statusBadge, teamTag, note } from "../components.js";
import { h, pressable } from "../dom.js";
import { DOW, dayLabel, dowOf, mdLabel, todayStr } from "../format.js";
import { allMatches, matchStatus, teamShort } from "../model.js";
import { set, state } from "../store.js";

// 何卓目か（試合IDの末尾 "2026-09-21-2" の 2）。推しチームで絞り込んでも番号は変わらない
function tableNo(m) { return Number(m.id.split("-").pop()); }

function matchRow(m, tablesThatDay) {
  const clickable = m.games.length > 0;
  const fav = state.fav && m.teams.includes(state.fav);
  return h("div", { class: "match" + (clickable ? " is-clickable" : "") + (fav ? " is-fav" : ""), ...(clickable ? pressable(() => actions.openMatch(m)) : {}) },
    h("div", { class: "match__head" },
      tablesThatDay > 1 ? h("span", { class: "match__table" }, `${tableNo(m)}卓目`) : null,
      h("span", { class: "match__status" }, statusBadge(matchStatus(m)))),
    h("div", { class: "match__teams" }, m.teams.map(t => teamTag(t, { markFav: true }))));
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
