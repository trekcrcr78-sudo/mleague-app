// データから画面用の値を組み立てる（DOM には触らない）。

import { state } from "./store.js";
import { jstNow, mdLabel, round1, todayStr } from "./format.js";

export function teamShort(id) { return state.data.teams[id]?.short ?? id ?? ""; }
export function teamName(id) { return state.data.teams[id]?.name ?? id ?? ""; }

export function allMatches() {
  const byMonth = state.data.matchesByMonth;
  return Object.keys(byMonth).sort().flatMap(k => byMonth[k]);
}

// 選手名 -> 今季の成績（レギュラー）
let pmCache = { key: null, map: null };
function playerIndex() {
  if (pmCache.key !== state.data) pmCache = { key: state.data, map: new Map(state.data.players.map(p => [p.name, p])) };
  return pmCache.map;
}
export function currentPlayer(name) { return playerIndex().get(name) ?? null; }
export function teamOfPlayer(name) {
  return playerIndex().get(name)?.team ?? state.history?.players?.[name]?.team;
}
export function rosterNames() {
  const names = new Set(playerIndex().keys());
  for (const n of Object.keys(state.history?.players ?? {})) names.add(n);
  return [...names];
}

export function matchStatus(m) {
  const today = todayStr();
  if (m.finished) return "done";
  if (m.date === today) return jstNow().getUTCHours() >= 19 ? "live" : "today";
  if (m.date < today) return m.games.length ? "done" : "pending";
  return "upcoming";
}

export function playerLog(name) {
  const rows = [];
  for (const m of allMatches()) for (const g of m.games) for (const r of g.results) if (r.name === name) rows.push({ date: m.date, no: g.no, ...r });
  return rows.reverse();
}

// ---------- 通算成績（レギュラーシーズン） ----------
// 1シーズンの行: { season, points, games, avgWin, lastAvoidRate, bestScore, current }
export function seasonRows(name) {
  const rows = [];
  const cur = state.data.season;
  const p = currentPlayer(name);
  if (p?.games) rows.push({ season: cur, current: true, ...pick(p) });
  for (const [season, players] of Object.entries(state.history?.archive ?? {})) {
    const a = season !== cur && players.find(x => x.name === name);
    if (a?.games) rows.push({ season, ...pick(a) });
  }
  // 詳細版（archive）があるシーズンはそちらを優先し、残りをチームページの過去成績で埋める
  const have = new Set(rows.map(r => r.season));
  for (const r of state.history?.players?.[name]?.regular ?? []) if (!have.has(r.season)) rows.push({ ...r });
  return rows.sort((a, b) => b.season.localeCompare(a.season));
}
function pick(p) {
  return { points: p.points, games: p.games, avgWin: p.avgWin, lastAvoidRate: p.lastAvoidRate, bestScore: p.bestScore };
}

// 行をまとめる。平均打点はアガリ回数が公開されていないため半荘数で加重した近似値
export function aggregate(rows) {
  const games = rows.reduce((a, r) => a + (r.games || 0), 0);
  if (!games) return null;
  const w = (k) => rows.reduce((a, r) => a + (r[k] ?? 0) * (r.games || 0), 0) / games;
  return {
    points: round1(rows.reduce((a, r) => a + (r.points || 0), 0)),
    games,
    perGame: rows.reduce((a, r) => a + (r.points || 0), 0) / games,
    lastAvoidRate: w("lastAvoidRate"),
    avgWin: w("avgWin"),
    bestScore: Math.max(...rows.map(r => r.bestScore ?? 0)),
    seasons: new Set(rows.map(r => r.season)).size,
    firstSeason: rows.map(r => r.season).sort()[0],
  };
}

export function careerOf(name) { return aggregate(seasonRows(name)); }

// ---------- ポイント推移 ----------
export function progression() {
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
      if (t) cum[t] = round1(cum[t] + r.point);
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

export function chartSelection() {
  if (Array.isArray(state.chartTeams) && state.chartTeams.length) return state.chartTeams;
  const sel = state.fav ? [state.fav] : [];
  for (const r of state.data.standings) { if (sel.length >= 3) break; if (!sel.includes(r.team)) sel.push(r.team); }
  return sel;
}
