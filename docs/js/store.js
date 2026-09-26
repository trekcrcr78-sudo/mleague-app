// アプリの状態。set() で変更すると購読者（main.js の再描画）に通知される。

const PERSIST = ["tab", "fav", "chartTeams"];

function read(k, d) { try { const v = localStorage.getItem("ml:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } }
function write(k, v) { try { localStorage.setItem("ml:" + k, JSON.stringify(v)); } catch {} }

export const state = {
  data: null,      // data.json（今季）
  history: null,   // history.json（過去シーズン）
  tab: read("tab", "schedule"),
  fav: read("fav", null),               // 推しチームID
  chartTeams: read("chartTeams", null), // グラフで強調するチーム（最大3）
  month: null,
  scheduleFilter: "all",
  players: { scope: "season", pastSeason: null, who: "all", sort: "points", team: "all" },
  resultTeam: "all",
  standingsView: { scope: "current", season: null },
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function set(patch) {
  Object.assign(state, patch);
  for (const k of PERSIST) if (k in patch) write(k, patch[k]);
  for (const fn of listeners) fn(patch);
}

export function setPlayers(patch) { set({ players: { ...state.players, ...patch } }); }

// 推しチームは1チームだけ。設定するとグラフの強調も推し中心に選び直す
export function setFav(team) {
  set({
    fav: team,
    ...(team && !(state.chartTeams || []).includes(team) ? { chartTeams: null } : {}),
    ...(!team ? { scheduleFilter: "all" } : {}),
  });
}

// 読み込み: 変わっていれば true
export async function loadJSON(name) {
  const res = await fetch(`${name}.json?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.json();
}
