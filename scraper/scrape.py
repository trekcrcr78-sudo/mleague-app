"""Mリーグ公式サイトから日程・成績を取得して docs/data.json に書き出す。

使い方:
  python scraper/scrape.py          # 当月の日程 + 順位 + 個人成績だけ更新（試合中の高頻度更新向け）
  python scraper/scrape.py --full   # シーズン全月の日程を取り直す（1日1回程度）
"""
import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from bs4 import BeautifulSoup

BASE = "https://m-league.jp"
UA = "Mozilla/5.0 (personal M.League stats viewer; low-frequency fetch)"
JST = timezone(timedelta(hours=9))
OUT = Path(__file__).resolve().parent.parent / "docs" / "data.json"

# 公式サイトのチームID（成績ページの T0xx）と表示用の短縮名
TEAMS = {
    "T001": ("赤坂ドリブンズ", "ドリブンズ"),
    "T002": ("EX風林火山", "風林火山"),
    "T003": ("KONAMI麻雀格闘倶楽部", "麻雀格闘倶楽部"),
    "T004": ("渋谷ABEMAS", "ABEMAS"),
    "T005": ("セガサミーフェニックス", "フェニックス"),
    "T006": ("TEAM RAIDEN / 雷電", "雷電"),
    "T007": ("U-NEXT Pirates", "Pirates"),
    "T008": ("KADOKAWAサクラナイツ", "サクラナイツ"),
    "T010": ("BEAST X", "BEAST"),
    "T011": ("EARTH JETS", "JETS"),
}
NAME_TO_ID = {full: tid for tid, (full, _) in TEAMS.items()}
SHORT_TO_ID = {short: tid for tid, (_, short) in TEAMS.items()}


def fetch(path):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        html = r.read().decode("utf-8")
    time.sleep(1.5)  # 公式サイトに負荷をかけない
    return BeautifulSoup(html, "html.parser")


def norm(s):
    return re.sub(r"\s+", "", s or "")


def team_id(name):
    n = norm(name)
    for full, tid in NAME_TO_ID.items():
        if norm(full) == n:
            return tid
    for short, tid in SHORT_TO_ID.items():
        if short in n:
            return tid
    raise ValueError(f"unknown team: {name!r}")


def num(s):
    s = norm(s).replace("pt", "").replace(",", "").replace("▲", "-")
    try:
        return float(s)
    except ValueError:  # 「―」や未開催試合のプレースホルダ
        return None


def parse_standings(soup):
    rows = []
    for li in soup.select("ol.p-ranking__team-list > li"):
        img = li.select_one(".p-ranking__team-symbol img")
        played, total = norm(li.select_one(".p-ranking__game-count").text).split("/")
        rows.append({
            "rank": int(norm(li.select_one(".p-ranking__rank-number").text)),
            "team": team_id(img["alt"] if img else li.select_one(".p-ranking__team-name").text),
            "points": num(li.select_one(".p-ranking__current-point").text),
            "diff": num(li.select_one(".p-ranking__diff-point").text),
            "games": int(played),
            "totalGames": int(total),
        })
    return rows


STAT_KEYS = {
    "試合数": "games", "総局数": "hands", "ポイント": "points", "平着": "avgRank",
    "1位": "r1", "2位": "r2", "3位": "r3", "4位": "r4",
    "トップ率": "topRate", "連対率": "rentaiRate", "ラス回避率": "lastAvoidRate",
    "ベストスコア": "bestScore", "平均打点": "avgWin", "副露率": "furoRate",
    "リーチ率": "riichiRate", "アガリ率": "winRate", "放銃率": "dealInRate",
    "放銃平均打点": "avgDealIn",
}


def parse_stats(soup):
    players = []
    for sec in soup.select("section.p-stats__team"):
        tid = sec["id"]
        table = sec.select_one("table.p-stats__table")
        rows = table.select("tr")
        names = [norm(th.text) for th in rows[0].select("th[scope=col]")]
        cols = [{"name": n, "team": tid} for n in names]
        for tr in rows[1:]:
            key = STAT_KEYS.get(norm(tr.select_one("th").text))
            if not key:
                continue
            for i, td in enumerate(tr.select("td")):
                cols[i][key] = num(td.text)
        players.extend(cols)
    return players


def parse_month(soup, year_of_month):
    """月別日程ページから試合（1カード＝2半荘）の一覧と結果を取り出す。"""
    results = {}
    for modal in soup.select(".c-modal2"):
        key = modal["id"].removeprefix("js-modal-")
        games = []
        for col in modal.select(".p-gamesResult__column"):
            m = re.search(r"\d+", col.select_one(".p-gamesResult__number").text)
            ranks = []
            for item in col.select(".p-gamesResult__rank-item"):
                ranks.append({
                    "rank": num(item.select_one(".p-gamesResult__rank-badge").text),
                    "name": norm(item.select_one(".p-gamesResult__name").text),
                    "point": num(item.select_one(".p-gamesResult__point").text),
                })
            if ranks and all(r["point"] is not None and r["rank"] is not None for r in ranks):
                for r in ranks:
                    r["rank"] = int(r["rank"])
                games.append({"no": int(m.group()) if m else len(games) + 1, "results": ranks})
        results[key] = games

    matches = []
    seen = {}
    for li in soup.select("section.p-gamesSchedule2 li.p-gamesSchedule2__list"):
        md = norm(li.select_one(".p-gamesSchedule2__data").text)
        mm, dd = re.match(r"(\d+)/(\d+)", md).groups()
        mm, dd = int(mm), int(dd)
        date = f"{year_of_month(mm)}-{mm:02d}-{dd:02d}"
        seen[date] = seen.get(date, 0) + 1
        key = li.get("data-target")
        teams = [team_id(img["alt"]) for img in li.select("img")]
        games = results.get(key, []) if key else []
        matches.append({
            "id": f"{date}-{seen[date]}",
            "date": date,
            "teams": teams,
            "finished": "is-finish" in (li.get("class") or []),
            "games": games,
        })
    return matches


def season_months(soup):
    months = []
    for a in soup.select(".p-gamesSchedule2__tab a[href]"):
        m = re.search(r"mly=(\d+)&(?:amp;)?mlm=(\d+)", a["href"])
        if m:
            months.append((int(m.group(1)), int(m.group(2))))
    return sorted(set(months))


def main():
    full = "--full" in sys.argv
    now = datetime.now(JST)
    old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}

    top = fetch("/")
    stats = fetch("/stats/")
    months = season_months(fetch("/games/"))
    ym = {m: y for y, m in months}
    year_of_month = lambda m: ym.get(m, now.year)

    # 過去に取った月はそのまま使い、必要な月だけ取り直す
    by_month = {k: v for k, v in (old.get("matchesByMonth") or {}).items()}
    targets = months if (full or not by_month) else [(now.year, now.month)]
    # 月初は前月の最終日の結果が遅れて載ることがあるので前月も取る
    if not full and now.day <= 2:
        prev = (now.replace(day=1) - timedelta(days=1))
        targets = [(prev.year, prev.month)] + targets
    for y, m in targets:
        if (y, m) not in months:
            continue
        by_month[f"{y}-{m:02d}"] = parse_month(fetch(f"/games/?mly={y}&mlm={m}"), year_of_month)

    matches = [mt for k in sorted(by_month) for mt in by_month[k]]
    data = {
        "updatedAt": now.isoformat(timespec="seconds"),
        "source": BASE,
        "teams": {tid: {"name": full_, "short": short} for tid, (full_, short) in TEAMS.items()},
        "standings": parse_standings(top),
        "players": parse_stats(stats),
        "matchesByMonth": by_month,
    }
    # 中身が変わっていなければ書き換えない（無駄なコミットを作らない）
    strip = lambda d: {k: v for k, v in d.items() if k != "updatedAt"}
    if old and strip(old) == json.loads(json.dumps(strip(data), ensure_ascii=False)):
        print("no change")
        return
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    done = sum(1 for m in matches if m["games"])
    print(f"ok: {len(data['standings'])} teams, {len(data['players'])} players, "
          f"{len(matches)} matches ({done} with results), months={[f'{y}-{m}' for y, m in targets]}")


if __name__ == "__main__":
    main()
