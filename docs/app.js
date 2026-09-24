"use strict";

// ---------- 状態 ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem("ml:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("ml:" + k, JSON.stringify(v)); } catch {} },
};
const state = {
  data: null,
  tab: store.get("tab", "schedule"),
  fav: store.get("fav", null),              // 推しチームID
  chartTeams: store.get("chartTeams", null), // グラフで強調するチーム（最大3）
  month: null,
  scheduleFilter: "all",
  playerSort: "points",
  playerTeam: "all",
  resultTeam: "all",
  loading: false,
};

const $ = (s, el = document) => el.querySelector(s);
const content = $("#content");
const TITLES = { schedule: "日程", standings: "順位", players: "個人成績", results: "試合結果" };
const DOW = ["日", "月", "火", "水", "木", "金", "土"];

// ---------- 小道具 ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}
const SVGNS = "http://www.w3.org/2000/svg";
function s(tag, attrs = {}) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
function jstNow() { return new Date(Date.now() + 9 * 3600e3); }
function todayStr() { return jstNow().toISOString().slice(0, 10); }
function parseDate(d) { const [y, m, dd] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd)); }
function mdLabel(d) { const t = parseDate(d); return `${t.getUTCMonth() + 1}/${t.getUTCDate()}`; }
function dowOf(d) { return parseDate(d).getUTCDay(); }
function pt(v) { if (v == null) return "–"; const a = Math.abs(v).toFixed(1); return v < 0 ? "▲" + a : a; }
function ptClass(v) { return v > 0 ? "pos" : v < 0 ? "neg" : ""; }
function pct(v) { return v == null ? "–" : (v * 100).toFixed(1) + "%"; }
function int(v) { return v == null ? "–" : Math.round(v).toLocaleString("ja-JP"); }
function teamShort(id) { return state.data.teams[id]?.short ?? id; }
function teamName(id) { return state.data.teams[id]?.name ?? id; }
function teamTag(id) { return h("span", { class: "team-tag" + (id === state.fav ? " is-fav" : "") }, teamShort(id)); }

function allMatches() {
  const byMonth = state.data.matchesByMonth;
  return Object.keys(byMonth).sort().flatMap(k => byMonth[k]);
}
function playerMap() {
  if (!state._pm || state._pmFor !== state.data) {
    state._pm = new Map(state.data.players.map(p => [p.name, p]));
    state._pmFor = state.data;
  }
  return state._pm;
}
function teamOfPlayer(name) { return playerMap().get(name)?.team; }

function matchStatus(m) {
  const today = todayStr();
  if (m.finished) return "done";
  if (m.date === today) return jstNow().getUTCHours() >= 19 ? "live" : "today";
  if (m.date < today) return m.games.length ? "done" : "pending";
  return "upcoming";
}
function statusBadge(st) {
  if (st === "live") return h("span", { class: "badge badge--live" }, "対局中");
  if (st === "today") return h("span", { class: "badge badge--next" }, "本日");
  if (st === "done") return h("span", { class: "badge badge--done" }, "終了");
  if (st === "pending") return h("span", { class: "badge badge--done" }, "集計中");
  return null;
}

// ---------- データ取得 ----------
async function load({ manual = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  $("#refresh").classList.add("is-spinning");
  try {
    const res = await fetch("data.json?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const changed = !state.data || data.updatedAt !== state.data.updatedAt;
    state.data = data;
    if (changed || manual) render();
    renderUpdated();
  } catch (e) {
    $("#updated").textContent = state.data ? "オフライン表示中（前回のデータ）" : "データを読み込めませんでした";
  } finally {
    state.loading = false;
    $("#refresh").classList.remove("is-spinning");
  }
}
function isMatchNight() {
  const t = jstNow(), hr = t.getUTCHours();
  const today = todayStr();
  return state.data && hr >= 18 && allMatches().some(m => m.date === today && !m.finished);
}
function renderUpdated() {
  const u = new Date(state.data.updatedAt);
  const mins = Math.round((Date.now() - u) / 60000);
  const ago = mins < 1 ? "たった今" : mins < 60 ? `${mins}分前` : `${u.getMonth() + 1}/${u.getDate()} ${String(u.getHours()).padStart(2, "0")}:${String(u.getMinutes()).padStart(2, "0")}`;
  const el = $("#updated");
  el.replaceChildren(`データ更新: ${ago}`);
  if (isMatchNight()) el.append("　", h("span", { class: "live" }, "● 試合中は自動更新"));
}
function scheduleRefresh() {
  clearTimeout(state._timer);
  const wait = isMatchNight() ? 60e3 : 10 * 60e3;
  state._timer = setTimeout(async () => { if (!document.hidden) await load(); scheduleRefresh(); }, wait);
}

// ---------- タブ ----------
function setTab(tab) {
  state.tab = tab;
  store.set("tab", tab);
  for (const b of document.querySelectorAll(".tab")) b.classList.toggle("is-active", b.dataset.tab === tab);
  $("#title").textContent = TITLES[tab];
  render();
  window.scrollTo({ top: 0 });
}
function render() {
  if (!state.data) return;
  hideTooltip();
  const view = { schedule: viewSchedule, standings: viewStandings, players: viewPlayers, results: viewResults }[state.tab] || viewSchedule;
  content.replaceChildren(...[view()].flat(Infinity).filter(Boolean));
  if (state.tab === "standings") drawChart();
  if (state.tab === "schedule") { const t = $(".day.is-today"); if (t && state._scrollToday) { t.scrollIntoView({ block: "center" }); state._scrollToday = false; } }
}

// ---------- 日程 ----------
function matchRow(m) {
  const st = matchStatus(m);
  const clickable = m.games.length > 0;
  return h("div", { class: "match", "data-match": clickable ? m.id : null, role: clickable ? "button" : null, tabindex: clickable ? 0 : null,
      onclick: clickable ? () => openMatch(m) : null, onkeydown: clickable ? e => { if (e.key === "Enter") openMatch(m); } : null },
    h("div", { class: "match__teams" }, m.teams.map(teamTag)),
    h("div", { class: "match__status" }, statusBadge(st)));
}
function viewSchedule() {
  const matches = allMatches();
  const today = todayStr();
  const out = [];

  // 今日（なければ次の開催日）
  const nextDate = (matches.find(m => m.date >= today) || {}).date;
  if (nextDate) {
    const dayMatches = matches.filter(m => m.date === nextDate);
    const card = h("section", { class: "card today" },
      h("div", { class: "today__head" },
        h("span", { class: "today__date" }, nextDate === today ? `今日 ${mdLabel(nextDate)}（${DOW[dowOf(nextDate)]}）` : `次の対局 ${mdLabel(nextDate)}（${DOW[dowOf(nextDate)]}）`)),
      dayMatches.map(matchRow));
    out.push(h("h2", { class: "section-title" }, nextDate === today ? "本日の対局" : "次の対局"), card);
  }

  // 月ごと
  const months = Object.keys(state.data.matchesByMonth).sort();
  if (!state.month || !months.includes(state.month)) {
    const cur = today.slice(0, 7);
    state.month = months.includes(cur) ? cur : (today < months[0] + "-00" ? months[0] : months[months.length - 1]);
    state._scrollToday = true;
  }
  const nav = h("div", { class: "month-nav" },
    h("div", { class: "chips", role: "tablist" }, months.map(k => h("button", { class: "chip", type: "button", "aria-pressed": String(k === state.month),
      onclick: () => { state.month = k; render(); } }, `${Number(k.slice(5))}月`))),
    state.fav ? h("div", { class: "chips" },
      h("button", { class: "chip", type: "button", "aria-pressed": String(state.scheduleFilter === "all"), onclick: () => { state.scheduleFilter = "all"; render(); } }, "すべて"),
      h("button", { class: "chip", type: "button", "aria-pressed": String(state.scheduleFilter === "fav"), onclick: () => { state.scheduleFilter = "fav"; render(); } }, `${teamShort(state.fav)}の試合`)) : null);
  out.push(h("h2", { class: "section-title" }, "シーズン日程"), nav);

  let list = state.data.matchesByMonth[state.month] || [];
  if (state.scheduleFilter === "fav" && state.fav) list = list.filter(m => m.teams.includes(state.fav));
  const byDate = new Map();
  for (const m of list) { if (!byDate.has(m.date)) byDate.set(m.date, []); byDate.get(m.date).push(m); }
  const card = h("section", { class: "card" });
  for (const [d, ms] of byDate) {
    const dw = dowOf(d);
    card.append(h("div", { class: "day" + (d === today ? " is-today" : "") },
      h("div", { class: "day__date" }, h("div", { class: "day__md" }, mdLabel(d)), h("div", { class: "day__dow" + (dw === 6 ? " sat" : dw === 0 ? " sun" : "") }, DOW[dw])),
      h("div", {}, ms.map(matchRow))));
  }
  out.push(byDate.size ? card : h("p", { class: "empty" }, "この月の試合はありません"));
  out.push(h("p", { class: "note" }, "終了した試合をタップすると結果が見られます。"));
  return out;
}

// ---------- 順位 ----------
function viewStandings() {
  const st = state.data.standings;
  const table = h("table", { class: "standings" },
    h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, "チーム"), h("th", {}, "ポイント"), h("th", {}, "差"), h("th", {}, "試合"))),
    h("tbody", {}, st.map(r => h("tr", { class: (r.rank === 7 ? "is-cut " : "") + (r.team === state.fav ? "is-fav" : ""), style: "cursor:pointer", onclick: () => openTeam(r.team) },
      h("td", { class: "rank" + (r.rank === 1 ? " rank-1" : "") }, r.rank),
      h("td", { class: "team" }, teamShort(r.team)),
      h("td", { class: "pts " + ptClass(r.points) }, pt(r.points)),
      h("td", { class: "sub" }, r.diff == null ? "―" : pt(r.diff)),
      h("td", { class: "sub" }, `${r.games}/${r.totalGames}`)))));
  return [
    h("h2", { class: "section-title" }, "チーム順位（レギュラーシーズン）"),
    h("section", { class: "card" }, table),
    h("p", { class: "note" }, "破線より上の6チームがセミファイナル進出圏。チームをタップすると所属選手の成績が見られます。"),
    h("h2", { class: "section-title" }, "ポイント推移"),
    h("section", { class: "card chart-card" }, h("div", { id: "chart" }), h("div", { class: "legend", id: "legend" })),
    h("p", { class: "note" }, "チーム名をタップすると最大3チームまで色付きで比較できます。グラフをなぞると各日の全チームのポイントが見られます。"),
  ];
}

function progression() {
  const teams = Object.keys(state.data.teams);
  const cum = Object.fromEntries(teams.map(t => [t, 0]));
  const points = [{ label: "開幕", date: null, values: { ...cum } }];
  const byDate = new Map();
  for (const m of allMatches()) {
    if (!m.games.length) continue;
    if (!byDate.has(m.date)) byDate.set(m.date, []);
    byDate.get(m.date).push(m);
  }
  for (const [d, ms] of [...byDate].sort()) {
    for (const m of ms) for (const g of m.games) for (const r of g.results) {
      const t = teamOfPlayer(r.name);
      if (t) cum[t] = Math.round((cum[t] + r.point) * 10) / 10;
    }
    points.push({ label: mdLabel(d), date: d, values: { ...cum } });
  }
  // 順位表の方が先に更新されることがあるので、差があれば「最新」として公式の値で締める
  const official = Object.fromEntries(state.data.standings.map(r => [r.team, r.points]));
  if (teams.some(t => official[t] != null && Math.abs(official[t] - cum[t]) > 0.05)) {
    points.push({ label: "最新", date: null, latest: true, values: { ...cum, ...official } });
  }
  return points;
}
function chartSelection() {
  if (Array.isArray(state.chartTeams) && state.chartTeams.length) return state.chartTeams;
  const sel = state.fav ? [state.fav] : [];
  for (const r of state.data.standings) { if (sel.length >= 3) break; if (!sel.includes(r.team)) sel.push(r.team); }
  return sel;
}
function toggleChartTeam(t) {
  let sel = chartSelection().slice();
  if (sel.includes(t)) sel = sel.filter(x => x !== t);
  else { sel.push(t); if (sel.length > 3) sel.shift(); }
  state.chartTeams = sel;
  store.set("chartTeams", sel);
  drawChart();
}

function drawChart() {
  const wrap = $("#chart");
  if (!wrap) return;
  const pts = progression();
  const sel = chartSelection();
  const color = t => `var(--series-${sel.indexOf(t) + 1})`;
  const teams = Object.keys(state.data.teams);

  // 凡例（色の割り当てはチームごとに固定、並びは現在順位）
  const legend = $("#legend");
  legend.replaceChildren(...state.data.standings.map(r => {
    const on = sel.includes(r.team);
    return h("button", { class: "chip", type: "button", "aria-pressed": String(on), onclick: () => toggleChartTeam(r.team) },
      h("span", { class: "key", style: on ? `background:${color(r.team)}` : null }), teamShort(r.team));
  }));

  const W = Math.max(280, wrap.clientWidth), H = Math.round(Math.min(340, Math.max(220, W * 0.55)));
  const m = { t: 12, r: 64, b: 24, l: 40 };
  const all = pts.flatMap(p => Object.values(p.values));
  let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  const step = niceStep((hi - lo) / 4 || 10);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const n = pts.length;
  const x = i => m.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - m.l - m.r));
  const y = v => m.t + (1 - (v - lo) / (hi - lo || 1)) * (H - m.t - m.b);

  const svg = s("svg", { class: "chart", width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "チーム別ポイント推移" });
  for (let v = lo; v <= hi + 1e-9; v += step) {
    svg.append(s("line", { class: v === 0 ? "zero" : "grid", x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
    const tx = s("text", { class: "tick", x: m.l - 6, y: y(v) + 3.5, "text-anchor": "end" }); tx.textContent = Math.round(v); svg.append(tx);
  }
  const every = Math.max(1, Math.ceil(n / Math.floor((W - m.l - m.r) / 44)));
  pts.forEach((p, i) => {
    if (i % every && i !== n - 1) return;
    const tx = s("text", { class: "tick", x: x(i), y: H - 6, "text-anchor": i === 0 ? "start" : "middle" }); tx.textContent = p.label; svg.append(tx);
  });
  const path = t => pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.values[t]).toFixed(1)}`).join("");
  for (const t of teams) if (!sel.includes(t)) svg.append(s("path", { class: "rest", d: path(t) }));
  const last = pts[n - 1];
  const labels = [];
  for (const t of sel) {
    svg.append(s("path", { class: "hl", d: path(t), stroke: color(t) }));
    svg.append(s("circle", { class: "dot", cx: x(n - 1), cy: y(last.values[t]), r: 4, fill: color(t) }));
    labels.push({ t, y: y(last.values[t]) });
  }
  // 末尾ラベルの重なりを避ける
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
  for (const l of labels) { const tx = s("text", { class: "endlabel", x: x(n - 1) + 8, y: l.y + 4 }); tx.textContent = teamShort(l.t); svg.append(tx); }

  // ホバー / タッチで値を読む
  const cross = s("line", { class: "cross", y1: m.t, y2: H - m.b, visibility: "hidden" });
  const dots = s("g", {});
  svg.append(cross, dots);
  const hit = s("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent" });
  svg.append(hit);
  const show = e => {
    const r = svg.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / (W - m.l - m.r)) * (n - 1))));
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
    dots.replaceChildren(...sel.map(t => s("circle", { class: "dot", cx: x(i), cy: y(pts[i].values[t]), r: 4.5, fill: color(t) })));
    const rows = teams.map(t => ({ t, v: pts[i].values[t] })).sort((a, b) => b.v - a.v);
    const tip = $("#tooltip");
    tip.replaceChildren(h("div", { class: "tooltip__date" }, pts[i].date ? `${pts[i].label}（${DOW[dowOf(pts[i].date)]}）終了時点` : pts[i].latest ? "最新（公式順位表）" : "開幕時点"),
      ...rows.map(({ t, v }) => h("div", { class: "tooltip__row" + (sel.includes(t) ? "" : " dim") },
        h("span", { class: "key", style: `background:${sel.includes(t) ? color(t) : "var(--series-rest)"}` }), teamShort(t), h("b", {}, pt(v)))));
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = r.left + x(i) + 14; if (left + tw > window.innerWidth - 8) left = r.left + x(i) - tw - 14;
    let top = Math.max(8, Math.min(window.innerHeight - th - 80, e.clientY - th / 2));
    tip.style.left = Math.max(8, left) + "px"; tip.style.top = top + "px";
  };
  const hide = () => { cross.setAttribute("visibility", "hidden"); dots.replaceChildren(); hideTooltip(); };
  hit.addEventListener("pointermove", show);
  hit.addEventListener("pointerdown", show);
  hit.addEventListener("pointerleave", hide);
  hit.addEventListener("pointerup", e => { if (e.pointerType !== "mouse") setTimeout(hide, 1800); });
  wrap.replaceChildren(svg);
}
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
function hideTooltip() { const t = $("#tooltip"); if (t) t.hidden = true; }

// ---------- 個人 ----------
const SORTS = [
  { k: "points", label: "ポイント", fmt: pt, desc: true },
  { k: "avgRank", label: "平均着順", fmt: v => v?.toFixed(2) ?? "–", desc: false },
  { k: "topRate", label: "トップ率", fmt: pct, desc: true },
  { k: "lastAvoidRate", label: "ラス回避率", fmt: pct, desc: true },
  { k: "rentaiRate", label: "連対率", fmt: pct, desc: true },
  { k: "bestScore", label: "最高スコア", fmt: int, desc: true },
  { k: "avgWin", label: "平均打点", fmt: int, desc: true },
  { k: "winRate", label: "アガリ率", fmt: pct, desc: true },
  { k: "dealInRate", label: "放銃率", fmt: pct, desc: false },
  { k: "riichiRate", label: "リーチ率", fmt: pct, desc: true },
  { k: "furoRate", label: "副露率", fmt: pct, desc: true },
];
function viewPlayers() {
  const sort = SORTS.find(x => x.k === state.playerSort) || SORTS[0];
  let list = state.data.players.filter(p => p.games > 0);
  if (state.playerTeam !== "all") list = list.filter(p => p.team === state.playerTeam);
  list.sort((a, b) => (sort.desc ? (b[sort.k] ?? -Infinity) - (a[sort.k] ?? -Infinity) : (a[sort.k] ?? Infinity) - (b[sort.k] ?? Infinity)) || (b.points - a.points));
  const teamIds = state.data.standings.map(r => r.team);
  let rank = 0, prev;
  return [
    h("div", { class: "controls" },
      h("div", { class: "chips" }, SORTS.map(x => h("button", { class: "chip", type: "button", "aria-pressed": String(x.k === sort.k), onclick: () => { state.playerSort = x.k; render(); } }, x.label))),
      h("div", { class: "chips" },
        h("button", { class: "chip", type: "button", "aria-pressed": String(state.playerTeam === "all"), onclick: () => { state.playerTeam = "all"; render(); } }, "全チーム"),
        teamIds.map(t => h("button", { class: "chip", type: "button", "aria-pressed": String(state.playerTeam === t), onclick: () => { state.playerTeam = t; render(); } }, teamShort(t))))),
    h("section", { class: "card" }, h("ol", { class: "plist" }, list.map((p, i) => {
      if (p[sort.k] !== prev) { rank = i + 1; prev = p[sort.k]; }
      return h("li", { class: "prow" + (p.team === state.fav ? " is-fav" : ""), tabindex: 0, role: "button", onclick: () => openPlayer(p.name), onkeydown: e => { if (e.key === "Enter") openPlayer(p.name); } },
        h("span", { class: "prow__rank" }, rank),
        h("div", {}, h("div", { class: "prow__name" }, p.name), h("div", { class: "prow__meta" }, teamTag(p.team), `${int(p.games)}試合`)),
        h("div", { class: "prow__val " + (sort.k === "points" ? ptClass(p.points) : "") }, sort.fmt(p[sort.k]), sort.k !== "points" ? h("small", { class: ptClass(p.points) }, pt(p.points) + "pt") : null));
    }))),
    h("p", { class: "note" }, "選手をタップすると詳しい成績と対局履歴が見られます。試合数が少ないうちは率の数字が大きくぶれます。"),
  ];
}

// ---------- 結果 ----------
function gameBlock(g) {
  return h("div", { class: "game" }, h("div", { class: "game__no" }, `第${g.no}回戦`),
    [...g.results].sort((a, b) => a.rank - b.rank).map(r => h("div", { class: "grow" },
      h("span", { class: "grow__rank" + (r.rank === 1 ? " r1" : "") }, r.rank),
      h("span", { class: "grow__name" }, r.name, h("small", {}, teamShort(teamOfPlayer(r.name)))),
      h("span", { class: "grow__pt " + ptClass(r.point) }, pt(r.point)))));
}
function resultCard(m) {
  return h("section", { class: "card result" },
    h("div", { class: "result__head" }, h("span", { class: "result__date" }, `${mdLabel(m.date)}（${DOW[dowOf(m.date)]}）`), statusBadge(matchStatus(m))),
    h("div", { class: "games" }, m.games.map(gameBlock)));
}
function viewResults() {
  let list = allMatches().filter(m => m.games.length).reverse();
  if (state.resultTeam !== "all") list = list.filter(m => m.teams.includes(state.resultTeam));
  return [
    h("div", { class: "chips" },
      h("button", { class: "chip", type: "button", "aria-pressed": String(state.resultTeam === "all"), onclick: () => { state.resultTeam = "all"; render(); } }, "全チーム"),
      state.data.standings.map(r => h("button", { class: "chip", type: "button", "aria-pressed": String(state.resultTeam === r.team), onclick: () => { state.resultTeam = r.team; render(); } }, teamShort(r.team)))),
    list.length ? list.map(resultCard) : h("p", { class: "empty" }, "まだ結果がありません"),
  ];
}

// ---------- 詳細シート ----------
function openSheet(...kids) {
  $("#sheet-body").replaceChildren(...kids.flat(Infinity).filter(Boolean));
  $("#sheet").hidden = false;
  document.body.style.overflow = "hidden";
  history.pushState({ sheet: true }, "");
}
function closeSheet(fromPop) {
  if ($("#sheet").hidden) return;
  $("#sheet").hidden = true;
  document.body.style.overflow = "";
  if (!fromPop && history.state?.sheet) history.back();
}
function openMatch(m) {
  openSheet(h("div", { class: "hero" }, h("h2", { id: "sheet-title" }, `${mdLabel(m.date)}（${DOW[dowOf(m.date)]}）の結果`)),
    h("div", { class: "games" }, m.games.map(gameBlock)));
}
function playerLog(name) {
  const rows = [];
  for (const m of allMatches()) for (const g of m.games) for (const r of g.results) if (r.name === name) rows.push({ date: m.date, no: g.no, ...r });
  return rows.reverse();
}
function openPlayer(name) {
  const p = playerMap().get(name);
  if (!p) return;
  const stat = (label, v) => h("div", { class: "stat" }, h("div", { class: "stat__label" }, label), h("div", { class: "stat__value" }, v));
  const log = playerLog(name);
  openSheet(
    h("div", { class: "hero" }, h("div", {}, h("h2", { id: "sheet-title" }, p.name), h("div", { class: "prow__meta" }, teamTag(p.team), `${int(p.games)}試合・${int(p.hands)}局`)),
      h("div", { class: "hero__pts " + ptClass(p.points) }, pt(p.points), h("small", {}, "ポイント"))),
    h("div", { class: "stat-grid" },
      stat("平均着順", p.avgRank?.toFixed(2) ?? "–"),
      stat("トップ率", pct(p.topRate)), stat("連対率", pct(p.rentaiRate)), stat("ラス回避率", pct(p.lastAvoidRate)),
      stat("アガリ率", pct(p.winRate)), stat("平均打点", int(p.avgWin)), stat("最高スコア", int(p.bestScore)),
      stat("放銃率", pct(p.dealInRate)), stat("放銃平均打点", int(p.avgDealIn)), stat("リーチ率", pct(p.riichiRate)),
      stat("副露率", pct(p.furoRate))),
    h("div", { class: "ranks" }, [1, 2, 3, 4].map(k => h("div", {}, h("b", {}, int(p["r" + k])), h("span", {}, `${k}着`)))),
    h("h3", { class: "section-title" }, "対局履歴"),
    log.length ? h("section", { class: "card" }, h("table", { class: "log" }, h("tbody", {}, log.map(r => h("tr", {},
      h("td", {}, `${mdLabel(r.date)}（${DOW[dowOf(r.date)]}） 第${r.no}回戦`), h("td", {}, `${r.rank}着`), h("td", { class: ptClass(r.point) }, pt(r.point))))))) : h("p", { class: "empty" }, "まだ対局がありません"));
}
function openTeam(t) {
  const row = state.data.standings.find(r => r.team === t);
  const members = state.data.players.filter(p => p.team === t).sort((a, b) => b.points - a.points);
  const favBtn = h("button", { class: "fav-btn", type: "button", "aria-pressed": String(state.fav === t), onclick: () => {
    state.fav = state.fav === t ? null : t; store.set("fav", state.fav);
    if (state.fav && !(state.chartTeams || []).includes(t)) { state.chartTeams = null; store.set("chartTeams", null); }
    closeSheet(); render();
  } }, state.fav === t ? "★ 推しチームに設定中" : "☆ 推しチームにする");
  const recent = allMatches().filter(m => m.games.length && m.teams.includes(t)).reverse().slice(0, 5);
  openSheet(
    h("div", { class: "hero" }, h("div", {}, h("h2", { id: "sheet-title" }, teamName(t)), h("div", { class: "prow__meta" }, row ? `${row.rank}位・${row.games}/${row.totalGames}試合` : "")),
      row ? h("div", { class: "hero__pts " + ptClass(row.points) }, pt(row.points), h("small", {}, "ポイント")) : null),
    favBtn,
    h("h3", { class: "section-title" }, "所属選手"),
    h("section", { class: "card" }, h("ol", { class: "plist" }, members.map(p => h("li", { class: "prow", role: "button", tabindex: 0, onclick: () => { closeSheet(); setTimeout(() => openPlayer(p.name), 50); } },
      h("span", { class: "prow__rank" }, ""), h("div", {}, h("div", { class: "prow__name" }, p.name), h("div", { class: "prow__meta" }, `${int(p.games)}試合・平均着順 ${p.avgRank?.toFixed(2) ?? "–"}`)),
      h("div", { class: "prow__val " + ptClass(p.points) }, pt(p.points)))))),
    recent.length ? [h("h3", { class: "section-title" }, "直近の試合"), recent.map(resultCard)] : null);
}

// ---------- 起動 ----------
document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
$("#refresh").addEventListener("click", () => load({ manual: true }));
$("#sheet").addEventListener("click", e => { if (e.target.closest("[data-close]")) closeSheet(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });
window.addEventListener("popstate", () => closeSheet(true));
document.addEventListener("visibilitychange", () => { if (!document.hidden) { load(); scheduleRefresh(); } });
let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (state.tab === "standings") drawChart(); }, 150); });
setInterval(() => { if (state.data) renderUpdated(); }, 30e3);

setTab(state.tab);
load().then(scheduleRefresh);
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
