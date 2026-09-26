"""Mリーグ公式サイトから日程・成績を取得して docs/ 以下の JSON に書き出す。

使い方:
  python scraper/scrape.py          # 当月の日程 + 順位 + 今季の個人成績だけ更新（試合中の高頻度更新向け）
  python scraper/scrape.py --full   # シーズン全月の日程と過去シーズンの成績も取り直す（1日1回程度）

出力:
  docs/data.json     今季のデータ（アプリが1分ごとに読み直す）
  docs/history.json  過去シーズンの成績（--full のときだけ更新）
"""
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

from common import BASE, JST, TEAMS, fetch, fetch_text, season_label
from parse_history import parse_team_page, parse_team_stage_points
from parse_live import parse_month, parse_standings, parse_stats, season_months, stage_links

DOCS = Path(__file__).resolve().parent.parent / "docs"
DATA = DOCS / "data.json"
HISTORY = DOCS / "history.json"


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

    # 公開済みのステージ（レギュラー／セミファイナル／ファイナル）の個人成績
    stages = {}
    for stage, href in stage_links(stats_page).items():
        stages[stage] = parse_stats(fetch(href))
    if not stages:  # タブが読めなくても表示中の成績は使う
        stages["R"] = parse_stats(stats_page)

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
        "stages": stages,
        "matchesByMonth": by_month,
    }


def scrape_history(now, data, old):
    players = {}
    for tid, (_, _, slug) in TEAMS.items():
        players.update(parse_team_page(fetch(f"/teams/{slug}/"), tid))
    team_stages = parse_team_stage_points(fetch_text("/assets/js/main.bundle.js"))

    # 今季のステージ別個人成績を保存しておき、翌シーズン以降も「過去のセミファイナル・ファイナル」として見られるようにする
    archive = dict(old.get("archive") or {})
    archive[data["season"]] = data["stages"]

    return {
        "updatedAt": now.isoformat(timespec="seconds"),
        "players": players,
        "teamStages": team_stages,
        "archive": archive,
    }


def main():
    full = "--full" in sys.argv
    now = datetime.now(JST)
    old_data = load(DATA)

    data = scrape_current(now, full, old_data)
    changed = save_if_changed(DATA, old_data, data)
    matches = [m for ms in data["matchesByMonth"].values() for m in ms]
    print(f"data.json: {'updated' if changed else 'no change'} "
          f"({len(data['standings'])} teams, stages={ {k: len(v) for k, v in data['stages'].items()} }, "
          f"{sum(1 for m in matches if m['games'])}/{len(matches)} matches with results)")

    if full or not HISTORY.exists():
        old_hist = load(HISTORY)
        hist = scrape_history(now, data, old_hist)
        changed = save_if_changed(HISTORY, old_hist, hist)
        print(f"history.json: {'updated' if changed else 'no change'} "
              f"({len(hist['players'])} players, {len(hist['teamStages'])} teams, archive={list(hist['archive'])})")


if __name__ == "__main__":
    main()
