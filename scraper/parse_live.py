"""今シーズンのページ（トップ、成績、月別日程）の解析。"""
import re

from common import norm, num, team_id

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


def regular_stats_href(soup):
    """成績ページのタブから「レギュラーシーズン」のリンクを探す（ポストシーズン中も表示をレギュラーに固定するため）。"""
    for a in soup.select(".p-stats__tab a.c-tab__clickable[href]"):
        if norm(a.select_one(".c-tab__label-main").text) == "Regular":
            return a["href"]
    return None


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
        rows = sec.select_one("table.p-stats__table").select("tr")
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
            ranks = [{
                "rank": num(item.select_one(".p-gamesResult__rank-badge").text),
                "name": norm(item.select_one(".p-gamesResult__name").text),
                "point": num(item.select_one(".p-gamesResult__point").text),
            } for item in col.select(".p-gamesResult__rank-item")]
            if ranks and all(r["point"] is not None and r["rank"] is not None for r in ranks):
                for r in ranks:
                    r["rank"] = int(r["rank"])
                games.append({"no": int(m.group()) if m else len(games) + 1, "results": ranks})
        results[key] = games

    matches = []
    seen = {}
    for li in soup.select("section.p-gamesSchedule2 li.p-gamesSchedule2__list"):
        md = norm(li.select_one(".p-gamesSchedule2__data").text)
        mm, dd = (int(x) for x in re.match(r"(\d+)/(\d+)", md).groups())
        date = f"{year_of_month(mm)}-{mm:02d}-{dd:02d}"
        seen[date] = seen.get(date, 0) + 1
        key = li.get("data-target")
        matches.append({
            "id": f"{date}-{seen[date]}",
            "date": date,
            "teams": [team_id(img["alt"]) for img in li.select("img")],
            "finished": "is-finish" in (li.get("class") or []),
            "games": results.get(key, []) if key else [],
        })
    return matches


def season_months(soup):
    months = set()
    for a in soup.select(".p-gamesSchedule2__tab a[href]"):
        m = re.search(r"mly=(\d+)&(?:amp;)?mlm=(\d+)", a["href"])
        if m:
            months.add((int(m.group(1)), int(m.group(2))))
    return sorted(months)
