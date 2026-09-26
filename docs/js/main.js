// 起動・タブ切替・データの定期読み込み

import { actions } from "./actions.js";
import { hideTooltip } from "./chart.js";
import { $, h } from "./dom.js";
import { todayStr, jstNow } from "./format.js";
import { allMatches } from "./model.js";
import { initSheets, redrawSheet } from "./sheets.js";
import { loadJSON, set, state, subscribe } from "./store.js";
import { afterSchedule, viewSchedule } from "./views/schedule.js";
import { afterStandings, viewStandings } from "./views/standings.js";
import { viewPlayers } from "./views/players.js";
import { viewResults } from "./views/results.js";

const VIEWS = {
  schedule: { title: "日程", render: viewSchedule, after: afterSchedule },
  standings: { title: "順位", render: viewStandings, after: afterStandings },
  players: { title: "個人成績", render: viewPlayers },
  results: { title: "試合結果", render: viewResults },
};
const content = $("#content");

function render() {
  const v = VIEWS[state.tab] || VIEWS.schedule;
  for (const b of document.querySelectorAll(".tab")) b.classList.toggle("is-active", b.dataset.tab === state.tab);
  $("#title").textContent = v.title;
  const fav = $("#fav");
  fav.classList.toggle("is-on", !!state.fav);
  fav.setAttribute("aria-label", state.fav && state.data ? `推しチーム: ${state.data.teams[state.fav]?.short}（変更する）` : "推しチームを選ぶ");
  if (!state.data) return;
  hideTooltip();
  content.replaceChildren(...[v.render()].flat(Infinity).filter(Boolean));
  v.after?.();
}

// 状態が変わったら描き直す（データ更新時は開いているシートも）
subscribe(patch => {
  if ("tab" in patch) window.scrollTo({ top: 0 });
  render();
  if ("data" in patch || "history" in patch || "fav" in patch) redrawSheet();
  if ("data" in patch) renderUpdated();
});

// ---------- 読み込み ----------
let loading = false, historyLoadedAt = 0;
async function load({ manual = false } = {}) {
  if (loading) return;
  loading = true;
  $("#refresh").classList.add("is-spinning");
  try {
    const needHistory = manual || !state.history || Date.now() - historyLoadedAt > 60 * 60e3;
    const [data, history] = await Promise.all([loadJSON("data"), needHistory ? loadJSON("history").catch(() => state.history) : state.history]);
    if (needHistory) historyLoadedAt = Date.now();
    const patch = {};
    if (!state.data || data.updatedAt !== state.data.updatedAt || manual) patch.data = data;
    if (history && history.updatedAt !== state.history?.updatedAt) patch.history = history;
    if (Object.keys(patch).length) set(patch); else renderUpdated();
  } catch {
    $("#updated").textContent = state.data ? "オフライン表示中（前回のデータ）" : "データを読み込めませんでした";
  } finally {
    loading = false;
    $("#refresh").classList.remove("is-spinning");
  }
}

function isMatchNight() {
  const today = todayStr();
  return state.data && jstNow().getUTCHours() >= 18 && allMatches().some(m => m.date === today && !m.finished);
}
function renderUpdated() {
  if (!state.data) return;
  const u = new Date(state.data.updatedAt);
  const mins = Math.round((Date.now() - u) / 60000);
  const ago = mins < 1 ? "たった今" : mins < 60 ? `${mins}分前` : `${u.getMonth() + 1}/${u.getDate()} ${String(u.getHours()).padStart(2, "0")}:${String(u.getMinutes()).padStart(2, "0")}`;
  $("#updated").replaceChildren(`データ更新: ${ago}`, isMatchNight() ? ["　", h("span", { class: "live" }, "● 試合中は自動更新")] : []);
}
let timer;
function scheduleRefresh() {
  clearTimeout(timer);
  timer = setTimeout(async () => { if (!document.hidden) await load(); scheduleRefresh(); }, isMatchNight() ? 60e3 : 10 * 60e3);
}

// ---------- 起動 ----------
initSheets();
document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => set({ tab: b.dataset.tab })));
$("#refresh").addEventListener("click", () => load({ manual: true }));
$("#fav").addEventListener("click", () => { if (state.data) actions.openFavPicker(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) { load(); scheduleRefresh(); } });
let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (state.tab === "standings") afterStandings(); }, 150); });
setInterval(renderUpdated, 30e3);

render();
load().then(scheduleRefresh);
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
