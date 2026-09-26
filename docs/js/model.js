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

// 今季の所属選手か（今季の成績表か、公式チームページに載っている）
export function isActive(name) {
  return playerIndex().has(name) || !!state.history?.players?.[name];
}
// 今の所属チーム。現役でなければ最後に出場したシーズンのチーム
export function teamOfPlayer(name) {
  const t = playerIndex().get(name)?.team ?? state.history?.players?.[name]?.team;
  if (t) return t;
  return seasonRows(name)[0]?.team;
}
export function rosterNames({ activeOnly = false } = {}) {
  const names = new Set(playerIndex().keys());
  for (const n of Object.keys(state.history?.players ?? {})) names.add(n);
  if (!activeOnly) for (const s of pastSeasons()) for (const r of seasonTable(s)) names.add(r.name);
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

// ---------- 過去シーズン・通算（レギュラーシーズン） ----------
// 過去シーズンの成績は3つの出どころを重ねる（後のものほど優先）
//   1. Wikipedia の各シーズン記事: 引退・退団した選手も含む全選手、当時の所属チーム
//   2. 公式チームページの対戦成績: 今季の所属選手の5項目
//   3. このアプリが保存した公式の成績（archive）: 2026-27 以降の全項目
let stCache = { key: null, map: new Map() };
export function seasonTable(season) {
  if (stCache.key !== state.history) stCache = { key: state.history, map: new Map() };
  if (stCache.map.has(season)) return stCache.map.get(season);
  const rows = new Map();
  for (const r of state.history?.wiki?.seasons?.[season] ?? []) rows.set(r.name, { ...r, source: "wiki" });
  for (const [name, p] of Object.entries(state.history?.players ?? {})) {
    const off = p.regular.find(r => r.season === season);
    if (off) rows.set(name, { team: p.team, ...rows.get(name), name, ...off, source: "official" });
  }
  if (season !== state.data.season) {
    for (const r of state.history?.archive?.[season] ?? []) if (r.games) rows.set(r.name, { ...rows.get(r.name), ...r, source: "official" });
  }
  const list = [...rows.values()].filter(r => r.games).map(withDerived);
  stCache.map.set(season, list);
  return list;
}

export function pastSeasons() {
  const set = new Set([
    ...Object.keys(state.history?.wiki?.seasons ?? {}),
    ...Object.keys(state.history?.archive ?? {}),
    ...Object.values(state.history?.players ?? {}).flatMap(p => p.regular.map(r => r.season)),
  ]);
  set.delete(state.data.season);
  return [...set].sort().reverse();
}

// 着順の回数があれば、平均着順・トップ率・4着回避率を正確に計算し直す
function withDerived(r) {
  const out = { ...r, perGame: r.games ? r.points / r.games : null };
  if ([1, 2, 3, 4].every(k => r["r" + k] != null)) {
    out.avgRank ??= (r.r1 + 2 * r.r2 + 3 * r.r3 + 4 * r.r4) / r.games;
    out.topRate ??= r.r1 / r.games;
    out.lastAvoidRate = 1 - r.r4 / r.games;
  }
  return out;
}

// 1選手のシーズンごとの行（新しい順）。current=今季
export function seasonRows(name) {
  const rows = [];
  const p = currentPlayer(name);
  if (p?.games) rows.push(withDerived({ ...p, season: state.data.season, current: true }));
  for (const s of pastSeasons()) {
    const r = seasonTable(s).find(x => x.name === name);
    if (r) rows.push({ ...r, season: s });
  }
  return rows;
}

// 行をまとめる。平均打点はアガリ回数が公開されていないため半荘数で加重した近似値
export function aggregate(rows) {
  const games = rows.reduce((a, r) => a + (r.games || 0), 0);
  if (!games) return null;
  const sum = k => rows.reduce((a, r) => a + (r[k] || 0), 0);
  const weighted = k => rows.reduce((a, r) => a + (r[k] ?? 0) * (r.games || 0), 0) / games;
  const hasRanks = rows.every(r => [1, 2, 3, 4].every(k => r["r" + k] != null));
  const r = hasRanks ? [1, 2, 3, 4].map(k => sum("r" + k)) : null;
  const points = sum("points");
  return {
    points: round1(points),
    games,
    perGame: points / games,
    r1: r?.[0] ?? null,
    topRate: r ? r[0] / games : null,
    avgRank: r ? (r[0] + 2 * r[1] + 3 * r[2] + 4 * r[3]) / games : null,
    lastAvoidRate: r ? 1 - r[3] / games : weighted("lastAvoidRate"),
    avgWin: weighted("avgWin"),
    bestScore: Math.max(...rows.map(x => x.bestScore ?? 0)) || null,
    seasons: new Set(rows.map(x => x.season)).size,
    firstSeason: rows.map(x => x.season).sort()[0],
    lastSeason: rows.map(x => x.season).sort().at(-1),
  };
}

export function careerOf(name) { return aggregate(seasonRows(name)); }

export function wikiSource(season) { return state.history?.wiki?.sources?.[season] ?? null; }

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
