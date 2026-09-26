"""Wikipedia（日本語版）の各シーズン記事から、レギュラーシーズンの個人成績表を取り出す。

公式サイトのチームページには今季の所属選手の過去成績しか無いため、引退・退団した選手の分をここで補う。
出典: https://ja.wikipedia.org/wiki/Mリーグ2018-19 など（CC BY-SA 4.0）
"""
import json
import re
import time
import urllib.parse
import urllib.request

from bs4 import BeautifulSoup

from common import norm, team_id

API = "https://ja.wikipedia.org/w/api.php"
UA = "mleague-personal-viewer/1.0 (https://github.com/trekcrcr78-sudo/mleague-app)"

# 表の見出し -> データのキー（年によって呼び方が違う）
COLUMNS = {
    "選手名": "name", "チーム": "team", "半荘数": "games", "総局数": "hands",
    "個人スコア": "points", "ポイント": "points", "スコア": "points",
    "最高スコア": "bestScore", "ベストスコア": "bestScore",
    "4着回避率": "lastAvoidRate", "ラス回避率": "lastAvoidRate",
    "平着": "avgRank", "平均着順": "avgRank",
    "1位": "r1", "2位": "r2", "3位": "r3", "4位": "r4",
    "トップ率": "topRate", "連対率": "rentaiRate", "平均打点": "avgWin",
    "副露率": "furoRate", "リーチ率": "riichiRate", "アガリ率": "winRate",
    "放銃率": "dealInRate", "放銃平均打点": "avgDealIn",
}


def article_url(season):
    return "https://ja.wikipedia.org/wiki/" + urllib.parse.quote(f"Mリーグ{season}")


def fetch_article_html(season):
    q = urllib.parse.urlencode({"action": "parse", "page": f"Mリーグ{season}", "prop": "text",
                                "format": "json", "formatversion": 2, "redirects": 1})
    req = urllib.request.Request(f"{API}?{q}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode("utf-8"))
    time.sleep(1.0)  # Wikipedia に負荷をかけない
    if "error" in data:
        raise ValueError(f"Mリーグ{season}: {data['error'].get('info')}")
    return data["parse"]["text"]


def clean_label(s):
    s = re.sub(r"\[[^\]]*\]", "", s or "")  # 脚注 [ 40 ] [注 1]
    return norm(s)


def wiki_num(s):
    """'▲49.0' '94,400' '0.8421 (32/38)' '14回' -> 数値。読めなければ None"""
    s = clean_label(s).replace(",", "").replace("▲", "-").replace("−", "-").replace("－", "-")
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    return float(m.group()) if m else None


def leaf_headers(table):
    """rowspan/colspan を展開して、各列のいちばん下の見出しを返す。"""
    header_rows = []
    for tr in table.find_all("tr"):
        cells = tr.find_all(["th", "td"])
        if cells and all(c.name == "th" for c in cells):
            header_rows.append(tr)
        else:
            break
    grid = {}
    for r, tr in enumerate(header_rows):
        c = 0
        for cell in tr.find_all("th"):
            while (r, c) in grid:
                c += 1
            rs, cs = int(cell.get("rowspan", 1)), int(cell.get("colspan", 1))
            for dr in range(rs):
                for dc in range(cs):
                    grid[(r + dr, c + dc)] = clean_label(cell.get_text(" "))
            c += cs
    width = max((c for _, c in grid), default=-1) + 1
    bottom = len(header_rows) - 1
    return [grid.get((bottom, c), "") for c in range(width)], len(header_rows)


def season_player_table(html):
    """『レギュラーシーズン（成績）』節の、選手ごとの成績表（いちばん列の多いもの）を探す。"""
    soup = BeautifulSoup(html, "html.parser")
    head = next((x for x in soup.find_all(["h2", "h3", "h4"]) if "レギュラーシーズン（成績）" in x.get_text()), None)
    if head is None:
        raise ValueError("レギュラーシーズン（成績）の節が見つかりません")
    tables = []
    for el in (head.find_parent("div") or head).find_all_next():
        if el.name in ("h2", "h3") and el is not head:
            break
        if el.name == "table" and "選手名" in (el.find("tr").get_text() if el.find("tr") else ""):
            tables.append(el)
    if not tables:
        raise ValueError("選手の成績表が見つかりません")
    return max(tables, key=lambda t: len(leaf_headers(t)[0]))


def parse_season(html):
    table = season_player_table(html)
    labels, n_head = leaf_headers(table)
    keys = [COLUMNS.get(l) for l in labels]
    if "name" not in keys or "points" not in keys:
        raise ValueError(f"想定外の見出し: {labels}")
    rows = []
    for tr in table.find_all("tr")[n_head:]:
        cells = tr.find_all(["th", "td"])
        if len(cells) != len(keys):
            continue  # 区切り行など
        row = {}
        for key, cell in zip(keys, cells):
            if not key:
                continue
            text = cell.get_text(" ")
            if key == "name":
                row["name"] = clean_label(text)
            elif key == "team":
                raw = clean_label(text).replace("俱", "倶")
                try:
                    row["team"] = team_id(raw)
                except ValueError:
                    row["team"] = raw  # 現在は無いチーム名など
            else:
                row[key] = wiki_num(text)
        if row.get("name") and row.get("games"):
            rows.append(row)
    return rows


# ---------- 個人タイトル（「Mリーグ」記事の「個人タイトル」節） ----------
AWARDS = {
    "MVP": "MVP", "個人スコア": "MVP",
    "平均打点": "平均打点賞", "最高スコア": "最高スコア賞",
    "4着回避率": "4着回避率賞", "最多トップ": "最多トップ賞",
}


def _api(params):
    q = urllib.parse.urlencode({**params, "format": "json", "formatversion": 2})
    req = urllib.request.Request(f"{API}?{q}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode("utf-8"))
    time.sleep(1.0)
    if "error" in data:
        raise ValueError(data["error"].get("info"))
    return data["parse"]


def fetch_titles_html():
    sections = _api({"action": "parse", "page": "Mリーグ", "prop": "sections"})["sections"]
    index = next(s["index"] for s in sections if clean_label(s["line"]) == "個人タイトル")
    return _api({"action": "parse", "page": "Mリーグ", "prop": "text", "section": index})["text"]


def award_name(label):
    for key, award in AWARDS.items():
        if key in label:
            return award
    return None  # 優勝など、表示しないもの


def parse_titles(html):
    """[{season, award, name, team, value}] を返す。表は年代ごとに列（賞の種類）が違う。"""
    soup = BeautifulSoup(html, "html.parser")
    titles = []
    for table in soup.find_all("table"):
        groups = {}
        for tr in table.find_all("tr"):
            cells = tr.find_all(["th", "td"])
            first = clean_label(cells[0].get_text(" ")) if cells else ""
            # 「年度」行が出てくるたびに、賞の名前（colspan=3）を列ごとに展開し直す（途中で賞の種類が変わる）
            if first == "年度":
                groups, c = {}, 0
                for cell in cells:
                    span = int(cell.get("colspan", 1))
                    for dc in range(span):
                        groups[c + dc] = clean_label(cell.get_text(" "))
                    c += span
                continue
            m = re.match(r"(\d{4}-\d{2})", first)
            if not m:
                continue  # 「選手・チーム・Pt」の2段目の見出しなど
            cells = [clean_label(x.get_text(" ")) for x in cells]
            for start in range(1, len(cells) - 2, 3):  # 選手・チーム・値 の3列ずつ
                award = award_name(groups.get(start, ""))
                name, team, value = cells[start:start + 3]
                if not award or not name:
                    continue
                try:
                    tid = team_id(team)
                except ValueError:
                    tid = team
                titles.append({"season": m.group(1), "award": award, "name": name, "team": tid, "value": wiki_num(value)})
    return titles


# ---------- チーム成績（「Mリーグ」記事の「チーム成績」節: レギュラー／セミファイナル／ファイナル） ----------
TEAM_SECTIONS = {"レギュラーシーズン": "R", "セミファイナル": "SF", "ファイナルシリーズ": "F"}


def fetch_team_results_html():
    """{"R": html, "SF": html, "F": html}"""
    sections = _api({"action": "parse", "page": "Mリーグ", "prop": "sections"})["sections"]
    parent = next(s["number"] for s in sections if clean_label(s["line"]) == "チーム成績")
    out = {}
    for s in sections:
        stage = TEAM_SECTIONS.get(clean_label(s["line"]))
        if stage and s["number"].startswith(parent + "."):
            out[stage] = _api({"action": "parse", "page": "Mリーグ", "prop": "text", "section": s["index"]})["text"]
    return out


def parse_team_results(html_by_stage):
    """{"2019-20": {"R": [{"team", "points"}], "SF": [...], "F": [...]}}。レギュラーは順位だけ（points=None）"""
    out = {}
    for stage, html in html_by_stage.items():
        for tr in BeautifulSoup(html, "html.parser").find_all("tr"):
            cells = [clean_label(x.get_text(" ")) for x in tr.find_all(["th", "td"])]
            m = re.match(r"(\d{4}-\d{2})", cells[0] if cells else "")
            if not m:
                continue
            if stage == "R":
                rows = [{"team": team_id(c), "points": None} for c in cells[1:] if c]
            else:
                rows = [{"team": team_id(cells[i]), "points": wiki_num(cells[i + 1])}
                        for i in range(1, len(cells) - 1, 2) if cells[i]]
            out.setdefault(m.group(1), {})[stage] = rows
    return out
