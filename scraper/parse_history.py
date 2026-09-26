"""過去シーズンの成績の解析。

- 選手別: 各チームページの「対戦成績」表（レギュラーシーズンのみ。セミファイナル・ファイナルは含まない）
- チーム別: 累計ポイントページが読み込む JS 内の、シーズン×ステージ（R/SF/F）ごとのチームポイント
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
    """累計ポイントページの JS から {チームID: {"2018-19": {"R": .., "SF": .., "F": ..}}} を作る。

    値はそのステージで稼いだポイントだけ（持ち越し前）。進出しなかったステージや参戦前は 0 なので落とす。
    """
    teams = {}
    for block in re.findall(r"\{team_name:\"[^\"]+\"[^{}]*\}", js):
        tid = team_id(re.search(r'team_name:"([^"]+)"', block).group(1))
        seasons = {}
        for season, stage, value in re.findall(r'"(\d{4}-\d{2}) (R|SF|F)":(-?[\d.]+)', block):
            if float(value):
                seasons.setdefault(season, {})[stage] = float(value)
        teams[tid] = dict(sorted(seasons.items()))
    return teams


def compute_standings(team_stages):
    """ステージごとの最終順位を計算する。

    セミファイナルはレギュラーの半分、ファイナルは直前のステージの半分を持ち越す（2018-19 はセミファイナルなし）。
    戻り値: {"2018-19": {"R": [{"team", "points"}, ...], "SF": [...], "F": [...]}}（ポイントの高い順）
    """
    seasons = {}
    for tid, by_season in team_stages.items():
        for season, v in by_season.items():
            seasons.setdefault(season, {})[tid] = v
    # 持ち越しは半分を小数第1位に丸めてから足す（Wikipedia の最終順位表とほぼ一致。差は ±0.2 以内）
    half = lambda x: round(x / 2 + 1e-9, 1)
    out = {}
    for season, teams in sorted(seasons.items()):
        r = {t: v["R"] for t, v in teams.items() if "R" in v}
        sf = {t: round(half(r.get(t, 0)) + v["SF"], 1) for t, v in teams.items() if "SF" in v}
        base = sf or r
        f = {t: half(base.get(t, 0)) + v["F"] for t, v in teams.items() if "F" in v}
        out[season] = {
            stage: [{"team": t, "points": round(p, 1)} for t, p in sorted(d.items(), key=lambda x: -x[1])]
            for stage, d in (("R", r), ("SF", sf), ("F", f)) if d
        }
    return out
