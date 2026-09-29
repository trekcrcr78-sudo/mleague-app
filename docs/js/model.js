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

// 対局履歴も個人成績と同じ時点（playersAsOf）までにそろえる
export function playerLog(name) {
  const asOf = state.data.playersAsOf;
  const rows = [];
  for (const m of allMatches()) {
    if (asOf && m.date > asOf) continue;
    for (const g of m.games) for (const r of g.results) if (r.name === name) rows.push({ date: m.date, no: g.no, ...r });
  }
  return rows.reverse();
}

// 個人成績がいつの時点のものか。pending = それより後に結果が出ている日（まとめて更新待ち）
export function playersAsOfInfo() {
  const asOf = state.data.playersAsOf ?? null;
  const later = allMatches().filter(m => m.games.length && (!asOf || m.date > asOf)).map(m => m.date);
  return { asOf, pending: later.length ? later.sort().at(-1) : null };
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

// ---------- 個人タイトル（Wikipedia「Mリーグ」個人タイトル） ----------
export const AWARD_ORDER = ["MVP", "最高スコア賞", "平均打点賞", "4着回避率賞", "最多トップ賞"];
export const AWARD_SHORT = { "MVP": "MVP", "最高スコア賞": "最高スコア", "平均打点賞": "平均打点", "4着回避率賞": "4着回避", "最多トップ賞": "最多トップ" };
const byAward = (a, b) => AWARD_ORDER.indexOf(a.award) - AWARD_ORDER.indexOf(b.award);

export function titlesOf(name) {
  return (state.history?.wiki?.titles ?? []).filter(t => t.name === name)
    .sort((a, b) => b.season.localeCompare(a.season) || byAward(a, b));
}
export function titlesInSeason(season) {
  const map = new Map();
  for (const t of (state.history?.wiki?.titles ?? []).filter(t => t.season === season).sort(byAward)) {
    if (!map.has(t.name)) map.set(t.name, []);
    map.get(t.name).push(t.award);
  }
  return map;
}

// ---------- 過去シーズンのチーム順位（ステージ別） ----------
export function standingSeasons() {
  return Object.keys(state.history?.standings ?? {}).filter(s => s !== state.data.season).sort().reverse();
}

// ---------- ポストシーズン（セミファイナル・ファイナル）の個人成績 ----------
// 出どころ: 今季=公式（毎日3時にまとめて更新）、過去=アプリが保存した公式の成績 → なければ Wikipedia
export function postseasonRows(name) {
  const rows = [];
  const add = (season, stages, current) => {
    for (const stage of ["F", "SF"]) {
      const r = stages?.[stage]?.find(x => x.name === name);
      if (r?.games) rows.push({ season, stage, current, team: r.team, points: r.points, games: r.games });
    }
  };
  const cur = state.data.season;
  add(cur, state.data.postseason, true);
  const done = new Set([cur]);
  for (const [season, stages] of Object.entries(state.history?.archivePost ?? {})) {
    if (done.has(season)) continue;
    add(season, stages, false); done.add(season);
  }
  for (const [season, stages] of Object.entries(state.history?.wiki?.postseason ?? {})) {
    if (!done.has(season)) add(season, stages, false);
  }
  return rows.sort((a, b) => b.season.localeCompare(a.season) || (a.stage === "F" ? -1 : 1));
}

// 何卓目か（試合IDの末尾 "2026-09-21-2" の 2）。推しチームで絞り込んでも番号は変わらない
export function tableNo(m) { return Number(m.id.split("-").pop()); }

// ---------- チーム順位にどの試合まで反映されているか ----------
// 公式の順位表の「試合数」は半荘が始まった時点で増え、ポイントは終わってから変わる。
// そこで試合数で「何回戦まで始まったか」、ポイントの変化で「終わったか」を判断する。
// 照合できないとき（公式側の一時的なずれ、試合結果の反映待ちなど）は null（推測で表示しない）
export function standingsProgress() {
  const today = todayStr();
  const matches = allMatches();
  const dates = [...new Set(matches.map(m => m.date))].filter(d => d <= today).sort();
  const day = dates.at(-1);
  if (!day) return null;
  // 前日までの試合数とポイント（試合結果から集計）
  const prior = {}, priorPts = {};
  const addPts = (bag, g) => { for (const r of g.results) { const t = teamOfPlayer(r.name); if (t) bag[t] = (bag[t] || 0) + r.point; } };
  for (const m of matches) if (m.date < day) {
    for (const t of m.teams) prior[t] = (prior[t] || 0) + m.games.length;
    for (const g of m.games) addPts(priorPts, g);
  }
  const std = Object.fromEntries(state.data.standings.map(r => [r.team, r]));
  const same = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) < 0.05;
  const onDay = matches.filter(m => m.date === day).sort((a, b) => tableNo(a) - tableNo(b));
  const playingToday = new Set(onDay.flatMap(m => m.teams));
  // 今日試合のないチームは、試合数もポイントも前日までと同じはず（違えば照合できないので表示しない）
  for (const [t, r] of Object.entries(std)) {
    if (!playingToday.has(t) && (r.games !== (prior[t] || 0) || !same(r.points, priorPts[t]))) return null;
  }
  const tables = [];
  for (const m of onDay) {
    const counts = new Set(m.teams.map(t => (std[t]?.games ?? 0) - (prior[t] || 0)));
    const started = [...counts][0];
    if (counts.size !== 1 || started < 0 || started > 2) return null;
    // 第1回戦の結果が試合結果ページに出ていれば、その後のポイントも分かる
    const after1 = { ...priorPts };
    const g1 = m.games.find(g => g.no === 1);
    if (g1) addPts(after1, g1);
    const changedFrom = base => m.teams.some(t => !same(std[t]?.points, base[t]));
    let done;
    if (started === 0) done = 0;
    else if (started === 1) done = g1 || changedFrom(priorPts) ? 1 : 0;
    else if (m.finished || m.games.length >= 2) done = 2;
    else if (g1) done = changedFrom(after1) ? 2 : 1;   // 第2回戦が始まっている＝第1回戦は終了
    else return null;                                   // 第1回戦の結果待ちで第2回戦の終了が判断できない
    tables.push({ no: tableNo(m), started, done, playing: started > done });
  }
  return { day, prevDay: dates.at(-2) ?? null, tables, single: tables.length === 1 };
}

// ---------- 今季の順位表の追加列 ----------
export const SEMIFINAL_SPOTS = 6;

// セミファイナルボーダー差: 1〜6位は7位との差（＋）、7位以下は6位との差（▲）
export function borderDiffs() {
  const rows = [...state.data.standings].sort((a, b) => a.rank - b.rank);
  const p6 = rows[SEMIFINAL_SPOTS - 1]?.points, p7 = rows[SEMIFINAL_SPOTS]?.points;
  if (p6 == null || p7 == null) return {};
  return Object.fromEntries(rows.map(r => [r.team, round1(r.rank <= SEMIFINAL_SPOTS ? r.points - p7 : r.points - p6)]));
}

// 各チームの今季の着順回数（試合結果から数える）
export function teamPlacements() {
  const out = {};
  for (const m of allMatches()) for (const g of m.games) for (const r of g.results) {
    const t = teamOfPlayer(r.name);
    if (!t) continue;
    out[t] ??= [0, 0, 0, 0];
    out[t][r.rank - 1]++;
  }
  return out;
}

// ---------- 役満（Wikipedia「Mリーグ」役満達成一覧） ----------
export const STAGE_NAME = { R: "レギュラー", SF: "セミファイナル", F: "ファイナル" };
export function yakumanRows() {
  return [...(state.history?.yakuman?.rows ?? [])].sort((a, b) => b.date.localeCompare(a.date) || (b.game ?? 0) - (a.game ?? 0));
}
export function yakumanOf(name) {
  const rows = yakumanRows();
  return { won: rows.filter(r => r.winner === name), dealt: rows.filter(r => r.loser === name) };
}

// ---------- 推しチームのまとめ（日程タブの一番上） ----------
// 今日の対局（なければ次の対局）と、直近の半荘の着順（新しい→古い）
export function favSummary(team, recentCount = 5) {
  const today = todayStr();
  const matches = allMatches();
  const mine = matches.filter(m => m.teams.includes(team));
  const match = mine.find(m => m.date === today) ?? mine.find(m => m.date > today && !m.finished) ?? null;
  const tablesThatDay = match ? matches.filter(m => m.date === match.date).length : 0;
  const recent = [];
  for (const m of mine) for (const g of [...m.games].sort((a, b) => a.no - b.no)) {
    const r = g.results.find(x => teamOfPlayer(x.name) === team);
    if (r) recent.push(r.rank);
  }
  return { match, isToday: match?.date === today, tablesThatDay, recent: recent.slice(-recentCount).reverse() };
}
