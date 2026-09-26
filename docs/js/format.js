// 数値・日付の表示形式

export const DOW = ["日", "月", "火", "水", "木", "金", "土"];
export const STAGE_LABEL = { R: "レギュラー", SF: "セミファイナル", F: "ファイナル" };
export const STAGE_ORDER = ["R", "SF", "F"];

export function jstNow() { return new Date(Date.now() + 9 * 3600e3); }
export function todayStr() { return jstNow().toISOString().slice(0, 10); }
function parseDate(d) { const [y, m, dd] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd)); }
export function mdLabel(d) { const t = parseDate(d); return `${t.getUTCMonth() + 1}/${t.getUTCDate()}`; }
export function dowOf(d) { return parseDate(d).getUTCDay(); }
export function dayLabel(d) { return `${mdLabel(d)}（${DOW[dowOf(d)]}）`; }

export function pt(v) { if (v == null) return "–"; const a = Math.abs(v).toFixed(1); return v < 0 ? "▲" + a : a; }
export function ptClass(v) { return v > 0 ? "pos" : v < 0 ? "neg" : ""; }
export function pct(v) { return v == null ? "–" : (v * 100).toFixed(1) + "%"; }
export function int(v) { return v == null ? "–" : Math.round(v).toLocaleString("ja-JP"); }
export function dec2(v) { return v == null ? "–" : v.toFixed(2); }
export function round1(v) { return Math.round(v * 10) / 10; }
