"""公式サイトのデータ API（/api/mleague/data）から今季の順位・日程と結果・個人成績を読む。

2026年10月末のメンテナンス以降、公式サイトの画面（HTML）には古い数字が入っていて、
ブラウザの中でこの API の数字に書き換える作りになった。そのため画面ではなく API を読む。
"""
import json
from collections import defaultdict
from datetime import datetime

from common import JST, fetch_text, norm
from parse_live import STAT_KEYS


def fetch_data(kind):
    d = json.loads(fetch_text(f"/api/mleague/data?kind={kind}"))
    if d.get("stale"):
        print(f"api: kind={kind} は公式側で古いデータ（stale）と表示されています")
    return d


def jst_date(iso):
    """API の日時（UTC）を日本時間の日付に。"""
    t = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(JST)
    return t.date().isoformat()


def api_season(d):
    """シーズンの開始年（2026-27 なら 2026）。"""
    return (d.get("season") or {}).get("year")


def parse_api_games(d):
    """日程と各半荘の結果。同じ日・同じ卓（desk）の半荘を1カードにまとめる（従来の matchesByMonth と同じ形）。"""
    cards = defaultdict(list)
    for g in d.get("games") or []:
        cards[(jst_date(g["date"]), g.get("desk") or 0)].append(g)
    by_month = defaultdict(list)
    for (date, desk), gs in sorted(cards.items()):
        gs.sort(key=lambda g: g.get("no") or 0)
        teams = [p["teamId"] for p in gs[0]["players"]]
        games = []
        for g in gs:
            if not g.get("complete"):
                continue
            results = [{"rank": int(p["rank"]), "name": norm(p["name"]), "point": float(p["point"])}
                       for p in g["players"] if p.get("rank") is not None and p.get("point") is not None and p.get("name")]
            if len(results) == 4:
                games.append({"no": g.get("no") or len(games) + 1, "results": sorted(results, key=lambda r: r["rank"])})
        by_month[date[:7]].append({
            "id": f"{date}-{desk + 1}",
            "date": date,
            "teams": teams,
            "finished": bool(gs) and all(g.get("complete") for g in gs) and len(games) == len(gs),
            "games": games,
        })
    return dict(by_month)


def parse_api_ranking(d, games_d):
    """順位表（従来の parse_standings と同じ形）。予定試合数は日程から数える。"""
    total = defaultdict(int)
    for g in games_d.get("games") or []:
        for p in g["players"]:
            total[p.get("teamId")] += 1
    rows = sorted(d.get("ranking", {}).get("teams") or [], key=lambda r: r["rank"])
    out = []
    for i, r in enumerate(rows):
        out.append({
            "rank": int(r["rank"]),
            "team": r["id"],
            "points": round(float(r["points"]), 1),
            "diff": round(rows[i - 1]["points"] - r["points"], 1) if i else None,
            "games": int(r["games"]),
            "totalGames": total.get(r["id"], 0),
        })
    return out


def parse_api_stats(d):
    """個人成績（従来の parse_stats と同じ形）。"""
    players = []
    for t in (d.get("stats") or {}).get("teams") or []:
        cols = [{"name": norm(n), "team": t["id"]} for n in t["players"]]
        for m in t.get("metrics") or []:
            key = STAT_KEYS.get(norm(m["name"]))
            if not key:
                continue
            for i, v in enumerate(m["values"]):
                if i < len(cols):
                    cols[i][key] = None if v is None else float(v)
        players.extend(cols)
    return players
