// 複数の画面で使う部品

import { actions } from "./actions.js";
import { h, pressable } from "./dom.js";
import { dayLabel, int, pct, pt, ptClass } from "./format.js";
import { AWARD_SHORT, isLiveNow, livePhase, matchStatus, watchUrl, playersAsOfInfo, STAGE_NAME, teamOfPlayer, teamShort, wikiSource } from "./model.js";
import { state } from "./store.js";

// チーム名の札。推しチームの色付けは日程だけで使う（markFav: true）
// チーム名を押すとチームの画面を開く（行やカードを押したときの動きとは別にするため、押したときは止める）
function teamPress(id) {
  return id && state.data?.teams?.[id] ? pressable(e => { e.stopPropagation(); actions.openTeam(id); }) : {};
}

export function teamTag(id, { markFav = false } = {}) {
  return h("span", { class: "team-tag" + (markFav && id === state.fav ? " is-fav" : ""), ...teamPress(id) }, teamShort(id));
}

// 小さい文字のチーム名（選手名の横など）。押せることが分かるよう下線を付ける
export function teamLink(id, cls = "") {
  return h("small", { class: `${cls} tlink`.trim(), ...teamPress(id) }, teamShort(id));
}

// m を渡すと、対局中の卓は「第1回戦 対局中」のように何回戦かも出す（終わった半荘の数＋1）
export function statusBadge(st, m) {
  const ph = st === "live" && m ? livePhase(m) : null;
  if (ph) {
    if (ph.reflected >= 2) st = "done";
    else return h("span", { class: "badge badge--live" }, `第${ph.reflected + 1}回戦 対局中`);
  }
  if (st === "live") return h("span", { class: "badge badge--live" }, "対局中");
  if (st === "today") return h("span", { class: "badge badge--next" }, "本日");
  if (st === "done") return h("span", { class: "badge badge--done" }, "終了");
  if (st === "pending") return h("span", { class: "badge badge--done" }, "集計中");
  return null;
}

// 対局中の卓だけに出す中継ボタン（カードのタップで結果が開かないよう、押したときは止める）
export function watchButton(m) {
  if (!isLiveNow(m)) return null;
  return h("a", { class: "watch", href: watchUrl(m), target: "_blank", rel: "noopener",
    onclick: e => e.stopPropagation(), onkeydown: e => e.stopPropagation() }, "▶ ABEMAで見る");
}

export function playerLink(name, opts) {
  return h("span", { class: "plink", ...pressable(e => { e.stopPropagation(); actions.openPlayer(name, opts); }) }, name);
}

// 試合結果。markFav: 推しチームの試合・選手を緑にする（「結果」タブだけで使う）
export function gameBlock(g, { markFav = false } = {}) {
  return h("div", { class: "game" }, h("div", { class: "game__no" }, `第${g.no}回戦`),
    [...g.results].sort((a, b) => a.rank - b.rank).map(r => {
      const team = teamOfPlayer(r.name);
      return h("div", { class: "grow" },
        h("span", { class: "grow__rank" + (r.rank === 1 ? " r1" : "") }, r.rank),
        h("span", { class: "grow__name" }, playerLink(r.name), teamLink(team, markFav && team === state.fav ? "is-fav" : "")),
        h("span", { class: "grow__pt " + ptClass(r.point) }, pt(r.point)));
    }));
}

export function resultCard(m, { markFav = false } = {}) {
  const fav = markFav && state.fav && m.teams.includes(state.fav);
  return h("section", { class: "card result" + (fav ? " is-fav" : "") },
    h("div", { class: "result__head" }, h("span", { class: "result__date" }, dayLabel(m.date)), statusBadge(matchStatus(m), m)),
    h("div", { class: "games" }, m.games.map(g => gameBlock(g, { markFav: fav }))));
}

export function stat(label, value, cls = "") {
  return h("div", { class: "stat" }, h("div", { class: "stat__label" }, label), h("div", { class: "stat__value " + cls }, value));
}

export function note(text) { return h("p", { class: "note" }, text); }
export function sectionTitle(text) { return h("h2", { class: "section-title" }, text); }

// 過去シーズンの出典（Wikipedia, CC BY-SA 4.0）
export function sourceNote(seasons) {
  const links = seasons.map(s => [s, s === "yakuman" ? state.history?.yakuman?.source : wikiSource(s)]).filter(([, url]) => url);
  if (!links.length) return null;
  return h("p", { class: "note source" }, "過去シーズンの出典: 公式サイト、Wikipedia（",
    links.map(([s, url], i) => [i ? "・" : "", h("a", { href: url, target: "_blank", rel: "noopener" }, { titles: "個人タイトル", teams: "チーム成績", yakuman: "役満" }[s] ?? s)]),
    "、CC BY-SA 4.0）");
}

export function titleBadges(awards) {
  if (!awards?.length) return null;
  return awards.map(a => h("span", { class: "title-badge" }, AWARD_SHORT[a] ?? a));
}

export function awardValue(t) {
  if (t.value == null) return "";
  if (t.award === "MVP") return `${pt(t.value)}pt`;
  if (t.award === "最高スコア賞") return `${int(t.value)}点`;
  if (t.award === "平均打点賞") return int(t.value);
  if (t.award === "4着回避率賞") return pct(t.value);
  if (t.award === "最多トップ賞") return `${int(t.value)}回`;
  return String(t.value);
}

// 個人成績の時点表示（例: 9/28（月）終了時点の成績）
export function asOfLine() {
  const { asOf, pending } = playersAsOfInfo();
  if (!asOf && !pending) return null;
  // レギュラーシーズンが終わったら、以降の試合（ポストシーズン）は個人成績の一覧には入らないので「反映待ち」は出さない
  const done = state.data.regularComplete;
  return h("div", { class: "asof" },
    h("span", { class: "asof__main" }, done ? "レギュラーシーズン最終成績" : asOf ? `${dayLabel(asOf)}終了時点の成績` : "開幕前の成績"),
    pending && !done ? h("span", { class: "asof__sub" }, `${dayLabel(pending)}の分は、その日の全試合が公式に反映されてからまとめて更新します`) : null);
}

// 役満1件（個人成績タブの役満の一覧用）。markFav: 推しチームが関わったもの（アガリ・放銃）を緑に（★の設定でオンのときだけ）
export function yakumanCard(y, { markFav = false } = {}) {
  const fav = markFav && state.fav && (y.winnerTeam === state.fav || y.loserTeam === state.fav);
  const team = t => teamLink(t, "yk__team" + (markFav && t === state.fav ? " is-fav" : ""));
  return h("section", { class: "card yk" + (fav ? " is-fav" : "") },
    h("div", { class: "yk__head" }, h("span", { class: "yk__name" }, y.yaku),
      h("span", { class: "yk__meta" }, `${y.date.replaceAll("-", "/")}　${STAGE_NAME[y.stage] ?? y.stage}`)),
    h("div", { class: "yk__who" },
      playerLink(y.winner, { view: "career" }), team(y.winnerTeam),
      h("span", { class: "title-badge" }, y.loser ? "ロン" : "ツモ"),
      y.dealer === y.winner ? h("span", { class: "title-badge" }, "親") : null),
    y.loser ? h("div", { class: "yk__loser" }, "放銃: ", playerLink(y.loser, { view: "career" }), team(y.loserTeam)) : null,
    h("div", { class: "yk__hand" }, `第${y.game ?? "?"}戦 ${y.hand}`));
}
