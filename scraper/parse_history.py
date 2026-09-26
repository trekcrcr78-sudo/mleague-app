"""過去シーズンの成績の解析。

- 選手別: 各チームページの「対戦成績」表（レギュラーシーズンのみ。セミファイナル・ファイナルは含まない）
- チーム別: 累計ポイントページが読み込む JS 内の、シーズン×ステージごとのチームポイント
"""
import re

from common import norm, num, season_label, team_id

HISTORY_KEYS = {
    "個人スコア": "points", "平均打点": "avgWin", "4着回避率": "lastAvoidRate",
    "最高スコア": "bestScore", "半荘数": "games",
}


def parse_team_page(soup, tid):
    """チームページから所属選手ごとの過去シーズン成績（レギュラー）を取り出す。"""
    players = {}
    for li in soup.select(".p-team-detail__player-list > li"):
        name_el = li.select_one(".c-player-profile__name")
        table = li.select_one("table.c-score-table")
        if not name_el or not table:
            continue  # 監督など
        keys = [HISTORY_KEYS.get(norm(th.text)) for th in table.select("thead th[scope=col]")]
        seasons = []
        for tr in table.select("tbody tr"):
            m = re.match(r"(\d{4})シーズン", norm(tr.select_one("th").text))
            if not m:
                continue  # 「現在」行は今季の成績ページの方が詳しいので使わない
            row = {"season": season_label(int(m.group(1)))}
            for key, td in zip(keys, tr.select("td")):
                if key:
                    row[key] = num(td.text)
            if row.get("games"):
                seasons.append(row)
        players[norm(name_el.text)] = {"team": tid, "regular": seasons}
    return players


def parse_team_stage_points(js):
    """累計ポイントページの JS から {チームID: {"2018-19": {"R":..,"SF":..,"F":..}}} を作る。"""
    teams = {}
    for block in re.findall(r"\{team_name:\"[^\"]+\"[^{}]*\}", js):
        tid = team_id(re.search(r'team_name:"([^"]+)"', block).group(1))
        seasons = {}
        for season, stage, value in re.findall(r'"(\d{4}-\d{2}) (R|SF|F)":(-?[\d.]+)', block):
            seasons.setdefault(season, {})[stage] = float(value)
        # 参戦前のシーズンは全ステージ 0 なので落とす
        teams[tid] = {s: v for s, v in sorted(seasons.items()) if any(v.values())}
    return teams
