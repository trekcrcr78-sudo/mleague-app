"""Mリーグ公式サイトから日程・成績を取得して docs/ 以下の JSON に書き出す。

使い方:
  python scraper/scrape.py          # 当月の日程 + 順位 + 今季の個人成績（レギュラー）だけ更新（試合中の高頻度更新向け）
  python scraper/scrape.py --full   # シーズン全月の日程と過去シーズンの成績も取り直す（1日1回程度）

出力:
  docs/data.json     今季のデータ（アプリが1分ごとに読み直す）
  docs/history.json  過去シーズンの成績（--full のときだけ更新。Wikipedia は7日に1回だけ取り直す）
"""
import json
import sys
import urllib.parse
from datetime import datetime, timedelta
from pathlib import Path

from common import BASE, JST, TEAMS, fetch, fetch_text, season_label
from parse_history import parse_team_page, parse_team_regular_points
from parse_live import parse_month, parse_standings, parse_stats, regular_stats_href, season_months
from parse_wikipedia import article_url, fetch_article_html, fetch_titles_html, parse_season, parse_titles

DOCS = Path(__file__).resolve().parent.parent / "docs"
DATA = DOCS / "data.json"
HISTORY = DOCS / "history.json"
WIKI_REFRESH = timedelta(days=7)
FIRST_SEASON = 2018


def load(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def save_if_changed(path, old, new):
    """updatedAt 以外に変化がなければ書き換えない（無駄なコミットを作らない）。"""
    strip = lambda d: {k: v for k, v in d.items() if k != "updatedAt"}
    if old and strip(old) == json.loads(json.dumps(strip(new), ensure_ascii=False)):
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(new, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return True


def scrape_current(now, full, old):
    top = fetch("/")
    stats_page = fetch("/stats/")
    months = season_months(fetch("/games/"))
    ym = {m: y for y, m in months}
    year_of_month = lambda m: ym.get(m, now.year)

    # 個人成績はレギュラーシーズンのみ（成績ページの既定表示がポストシーズンに変わっても固定）
    href = regular_stats_href(stats_page)
    players = parse_stats(fetch(href) if href and "season=" in href else stats_page)

    # 過去に取った月はそのまま使い、必要な月だけ取り直す
    by_month = dict(old.get("matchesByMonth") or {})
    targets = months if (full or not by_month) else [(now.year, now.month)]
    if not full and now.day <= 2:  # 月初は前月末の結果が遅れて載ることがある
        prev = now.replace(day=1) - timedelta(days=1)
        targets = [(prev.year, prev.month)] + targets
    for y, m in targets:
        if (y, m) in months:
            by_month[f"{y}-{m:02d}"] = parse_month(fetch(f"/games/?mly={y}&mlm={m}"), year_of_month)

    return {
        "updatedAt": now.isoformat(timespec="seconds"),
        "source": BASE,
        "season": season_label(months[0][0] if months else now.year),
        "teams": {tid: {"name": full_, "short": short} for tid, (full_, short, _) in TEAMS.items()},
        "standings": parse_standings(top),
        "players": players,
        "matchesByMonth": by_month,
    }


def scrape_wikipedia(now, current_season, old_wiki):
    """過去シーズンの全選手の成績（Wikipedia）。前回から7日以内なら取り直さない。"""
    start = int(current_season[:4])
    wanted = [season_label(y) for y in range(FIRST_SEASON, start)]
    fetched = old_wiki.get("fetchedAt")
    fresh = fetched and now - datetime.fromisoformat(fetched) < WIKI_REFRESH
    if fresh and "titles" in old_wiki and all(s in old_wiki.get("seasons", {}) for s in wanted):
        return old_wiki
    seasons, sources, errors = {}, {}, []
    for s in wanted:
        try:
            seasons[s] = parse_season(fetch_article_html(s))
            sources[s] = article_url(s)
        except Exception as e:  # 1シーズン失敗しても前回の分を使い続ける
            errors.append(f"{s}: {e}")
            if s in old_wiki.get("seasons", {}):
                seasons[s], sources[s] = old_wiki["seasons"][s], old_wiki["sources"][s]
    try:
        titles = parse_titles(fetch_titles_html())
    except Exception as e:
        errors.append(f"個人タイトル: {e}")
        titles = old_wiki.get("titles", [])
    sources["titles"] = "https://ja.wikipedia.org/wiki/" + urllib.parse.quote("Mリーグ") + "#" + urllib.parse.quote("個人タイトル")
    for e in errors:
        print("wikipedia:", e)
    return {"fetchedAt": now.isoformat(timespec="seconds"), "license": "CC BY-SA 4.0", "sources": sources,
            "seasons": seasons, "titles": titles}


def cross_check(players, wiki):
    """公式（チームページ）と Wikipedia の数字が合っているか。合わないものを返す。"""
    compared, mismatches = 0, []
    for t in wiki.get("titles", []):  # MVP はその年の個人スコア1位のはず
        if t["award"] != "MVP":
            continue
        row = next((r for r in wiki["seasons"].get(t["season"], []) if r["name"] == t["name"]), None)
        compared += 1
        if row is None or abs(row["points"] - t["value"]) > 0.05:
            mismatches.append(f"{t['season']} MVP {t['name']}: タイトル表={t['value']} 成績表={row and row['points']}")
    for name, p in players.items():
        for off in p["regular"]:
            w = next((r for r in wiki["seasons"].get(off["season"], []) if r["name"] == name), None)
            if w is None:
                continue
            compared += 1
            for k in ("points", "games"):
                if w.get(k) is None or abs(w[k] - off[k]) > 0.05:
                    mismatches.append(f"{off['season']} {name} {k}: 公式={off[k]} Wikipedia={w.get(k)}")
    return compared, mismatches


def scrape_history(now, data, old):
    players = {}
    for tid, (_, _, slug) in TEAMS.items():
        players.update(parse_team_page(fetch(f"/teams/{slug}/"), tid))
    team_regular = parse_team_regular_points(fetch_text("/assets/js/main.bundle.js"))
    wiki = scrape_wikipedia(now, data["season"], old.get("wiki") or {})
    compared, mismatches = cross_check(players, wiki)
    print(f"cross-check: {compared} rows compared, {len(mismatches)} mismatches")
    for m in mismatches:
        print("  mismatch:", m)

    # 今季の詳しい個人成績を保存しておき、翌シーズン以降も過去シーズンとして全項目を見られるようにする
    archive = dict(old.get("archive") or {})
    archive[data["season"]] = data["players"]

    return {
        "updatedAt": now.isoformat(timespec="seconds"),
        "players": players,
        "teamRegular": team_regular,
        "archive": archive,
        "wiki": wiki,
    }


def main():
    full = "--full" in sys.argv
    now = datetime.now(JST)
    old_data = load(DATA)

    data = scrape_current(now, full, old_data)
    changed = save_if_changed(DATA, old_data, data)
    matches = [m for ms in data["matchesByMonth"].values() for m in ms]
    print(f"data.json: {'updated' if changed else 'no change'} "
          f"({len(data['standings'])} teams, {len(data['players'])} players, "
          f"{sum(1 for m in matches if m['games'])}/{len(matches)} matches with results)")

    if full or not HISTORY.exists():
        old_hist = load(HISTORY)
        hist = scrape_history(now, data, old_hist)
        changed = save_if_changed(HISTORY, old_hist, hist)
        print(f"history.json: {'updated' if changed else 'no change'} "
              f"({len(hist['players'])} players, {len(hist['teamRegular'])} teams, archive={list(hist['archive'])})")


if __name__ == "__main__":
    main()
