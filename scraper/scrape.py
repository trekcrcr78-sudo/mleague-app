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
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

from common import BASE, JST, TEAMS, fetch, fetch_text, name_key, season_label
from parse_history import compute_standings, parse_team_page, parse_team_stage_points
from parse_api import api_season, fetch_data, parse_api_games, parse_api_ranking, parse_api_stats
from parse_wikipedia import (article_url, fetch_article_html, fetch_team_results_html, fetch_titles_html,
                             fetch_yakuman_html, parse_postseason, parse_season, parse_team_results, parse_titles,
                             parse_yakuman)

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


def players_snapshot(fresh, by_month, old):
    """個人成績は「その日の全試合が反映された時点」でまとめて切り替える。

    公式の個人成績は試合結果より遅れて1試合ずつ更新されるため、途中の状態は使わず前回の成績を保つ。
    戻り値: (players, asOf)  asOf = 反映済みの最後の日付（開幕前は None）
    """
    matches = [m for ms in by_month.values() for m in ms]
    days = sorted({m["date"] for m in matches if m["games"]})
    # その日の試合がすべて終わっている日だけが区切りの候補
    complete = [d for d in days if all(m["finished"] for m in matches if m["date"] == d)]
    stats = {p["name"]: int(p.get("games") or 0) for p in fresh}
    for d in reversed(complete):
        played = Counter(r["name"] for m in matches if m["date"] <= d for g in m["games"] for r in g["results"])
        if all(stats.get(n, 0) == played.get(n, 0) for n in set(stats) | set(played)):
            return fresh, d
    if not days and not any(stats.values()):
        return fresh, None  # 開幕前
    if old.get("players") is not None and "playersAsOf" in old:
        return old["players"], old["playersAsOf"]  # 反映の途中なので前回の成績のまま
    return fresh, None


def _same(a, b):
    return abs((a or 0) - (b or 0)) < 0.05


def _table_no(m):
    return int(m["id"].rsplit("-", 1)[1])


def standings_progress(now, by_month, standings, team_of, old):
    """順位表に今日（直近の開催日）のどの半荘まで入っているかを卓ごとに数える。

    公式のデータ API には半荘ごとの結果が終わり次第載るので、
    「前の開催日までの結果の合計 ＋ 今日その卓で終わった半荘のうち最初の k 個」が
    順位表のポイントと一致する k を、卓ごとに毎回数え直す（前回の取り込みの記録には頼らない）。
    一致しないとき（公式側の一時的なずれなど）は checking=True。
    """
    matches = [m for ms in by_month.values() for m in ms]
    ref = (now - timedelta(hours=6)).date().isoformat()  # 深夜（〜6時）は前日扱い
    dates = sorted({m["date"] for m in matches if m["date"] <= ref})
    if not dates:
        return None
    day = dates[-1]
    std = {r["team"]: r["points"] for r in standings}

    def add(bag, game):
        for r in game["results"]:
            t = team_of.get(r["name"])
            if t:
                bag[t] = bag.get(t, 0.0) + r["point"]

    base = {}
    for m in matches:
        if m["date"] < day:
            for g in m["games"]:
                add(base, g)
    on_day = sorted((m for m in matches if m["date"] == day), key=_table_no)
    playing = {t for m in on_day for t in m["teams"]}
    # 今日試合のないチームは、前の開催日までの結果の合計と同じはず（違えば公式側がずれている）
    global_check = any(t not in playing and not _same(p, base.get(t, 0.0)) for t, p in std.items())
    tables = []
    for m in on_day:
        games = sorted(m["games"], key=lambda g: g["no"])
        reflected, checking = len(games), True
        for k in range(len(games), -1, -1):
            expected = dict(base)
            for g in games[:k]:
                add(expected, g)
            if all(_same(std.get(t), expected.get(t, 0.0)) for t in m["teams"]):
                reflected, checking = k, False
                break
        tables.append({"no": _table_no(m), "reflected": min(reflected, 2), "checking": checking or global_check})
    return {"day": day, "prevDay": dates[-2] if len(dates) > 1 else None, "tables": tables}


def scrape_current(now, full, old):
    # 公式サイトのデータ API から読む（画面の HTML は古い数字のまま、ブラウザの中で書き換える作りになったため）
    games_d = fetch_data("games")
    ranking_d = fetch_data("ranking")
    stats_d = fetch_data("stats")
    by_month = parse_api_games(games_d)
    if not by_month and old.get("matchesByMonth"):
        print("games: 公式の日程が空なので、前回の日程と結果のままにします")
        by_month = old["matchesByMonth"]
    # 個人成績の一覧はレギュラーシーズン
    players = parse_api_stats(stats_d) if (stats_d.get("season") or {}).get("phase", "regular") == "regular" else []
    if not players and old.get("players"):
        players = old["players"]
    # 今季のセミファイナル・ファイナルの個人成績（API での形はポストシーズンが始まったら確かめる。それまでは前回のまま）
    postseason, post_as_of = old.get("postseason") or {}, old.get("postseasonAsOf")

    players, as_of = players_snapshot(players, by_month, old)
    standings = parse_api_ranking(ranking_d, games_d)
    season = season_label(api_season(ranking_d) or api_season(games_d) or now.year)
    old_std = old.get("standings") or []
    # 公式の順位表がおかしいときは前回の順位表のまま使う（メンテナンス中に空や古い順位表が返ってきたことがある）
    #  - 空、またはチームが欠けている
    #  - 試合数の合計が前回より減っている（同じシーズン・同じステージ＝予定試合数が同じときだけ。
    #    セミファイナル開始などで試合数が数え直されたときは除く）
    same_stage = sorted(r["totalGames"] for r in standings) == sorted(r.get("totalGames") for r in old_std)
    if old_std and old.get("season") == season and len(standings) < len(old_std):
        print(f"standings: 公式の順位表が{len(standings)}チームしかないので、前回の順位表のままにします")
        standings = old_std
    elif old_std and old.get("season") == season and same_stage and sum(r["games"] for r in standings) < sum(r["games"] for r in old_std):
        print("standings: 公式の順位表が前回より古いので、前回の順位表のままにします")
        standings = old_std
    # レギュラーシーズンが全日程終わったか（選手の試合数の合計 = 各チームの予定試合数の合計）
    regular_total = sum(r["totalGames"] for r in standings)
    regular_complete = bool(regular_total) and sum(int(p.get("games") or 0) for p in players) >= regular_total
    team_of = {p["name"]: p["team"] for p in players if p.get("team")}
    progress = standings_progress(now, by_month, standings, team_of, old)
    return {
        "updatedAt": now.isoformat(timespec="seconds"),
        "source": BASE,
        "season": season,
        "teams": {tid: {"name": full_, "short": short} for tid, (full_, short, _) in TEAMS.items()},
        "standings": standings,
        "standingsProgress": progress,
        "players": players,
        "playersAsOf": as_of,
        "regularComplete": regular_complete,
        "postseason": postseason,
        "postseasonAsOf": post_as_of,
        "matchesByMonth": by_month,
    }


def scrape_wikipedia(now, current_season, old_wiki):
    """過去シーズンの全選手の成績（Wikipedia）。前回から7日以内なら取り直さない。"""
    start = int(current_season[:4])
    wanted = [season_label(y) for y in range(FIRST_SEASON, start)]
    fetched = old_wiki.get("fetchedAt")
    fresh = fetched and now - datetime.fromisoformat(fetched) < WIKI_REFRESH
    if fresh and all(k in old_wiki for k in ("titles", "teams", "postseason")) and all(s in old_wiki.get("seasons", {}) for s in wanted):
        return json.loads(json.dumps(old_wiki))  # コピーを返す（後で書き換えても前回分との比較が狂わないように）
    seasons, postseason, sources, errors = {}, {}, {}, []
    for s in wanted:
        try:
            html = fetch_article_html(s)
            seasons[s] = parse_season(html)
            postseason[s] = parse_postseason(html, {r["name"]: r["team"] for r in seasons[s]})
            sources[s] = article_url(s)
        except Exception as e:  # 1シーズン失敗しても前回の分を使い続ける
            errors.append(f"{s}: {e}")
            if s in old_wiki.get("seasons", {}):
                seasons[s], sources[s] = old_wiki["seasons"][s], old_wiki["sources"][s]
                postseason[s] = old_wiki.get("postseason", {}).get(s, {})
    try:
        titles = parse_titles(fetch_titles_html())
    except Exception as e:
        errors.append(f"個人タイトル: {e}")
        titles = old_wiki.get("titles", [])
    try:
        teams = parse_team_results(fetch_team_results_html())
    except Exception as e:
        errors.append(f"チーム成績: {e}")
        teams = old_wiki.get("teams", {})
    main_article = "https://ja.wikipedia.org/wiki/" + urllib.parse.quote("Mリーグ")
    sources["titles"] = main_article + "#" + urllib.parse.quote("個人タイトル")
    sources["teams"] = main_article + "#" + urllib.parse.quote("チーム成績")
    for e in errors:
        print("wikipedia:", e)
    return {"fetchedAt": now.isoformat(timespec="seconds"), "license": "CC BY-SA 4.0", "sources": sources,
            "seasons": seasons, "postseason": postseason, "titles": titles, "teams": teams}


def merge_standings(computed, wiki_teams):
    """公式のポイントから計算した順位を、Wikipedia の順位表と照合する。

    並び順は計算値を使い、セミファイナル・ファイナルのポイントは Wikipedia の値（最終順位として発表された値）を優先する。
    """
    for season, stages in computed.items():
        for stage, rows in stages.items():
            w = wiki_teams.get(season, {}).get(stage)
            if not w:
                continue
            if [r["team"] for r in rows] != [x["team"] for x in w]:
                print(f"  mismatch: {season} {stage} 順位 計算={[r['team'] for r in rows]} Wikipedia={[x['team'] for x in w]}")
                continue
            for r, x in zip(rows, w):
                if x["points"] is not None and abs(r["points"] - x["points"]) > 0.05:
                    print(f"  note: {season} {stage} {r['team']} 計算={r['points']} Wikipedia={x['points']}（Wikipedia の値を使用）")
                    r["points"] = x["points"]
    return computed


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


def check_postseason(wiki, team_stages):
    """セミファイナル・ファイナルの選手の pt をチームごとに足し、公式のステージ別ポイントと照合する。

    対戦成績の表から集計した分（fromLog）が合わなければ、読み違いの可能性があるので載せない。
    """
    for season, stages in wiki.get("postseason", {}).items():
        for stage in list(stages):
            rows = stages[stage]
            sums = {}
            for r in rows:
                sums[r["team"]] = sums.get(r["team"], 0) + (r["points"] or 0)
            bad = [t for t, v in sums.items() if abs(v - team_stages.get(t, {}).get(season, {}).get(stage, 0)) > 0.25]
            if bad:
                from_log = any(r.get("fromLog") for r in rows)
                print(f"  mismatch: {season} {stage} 選手ptの合計がチームと不一致 {bad}" + ("（対戦成績から集計した分なので載せない）" if from_log else ""))
                if from_log:
                    del stages[stage]


def scrape_yakuman(now, old, wiki, data, players):
    """役満の一覧（Wikipedia）。今季に出た分も翌朝には入るよう、毎日の全体更新で取り直す。"""
    old_y = old.get("yakuman") or {}
    try:
        rows = parse_yakuman(fetch_yakuman_html())
    except Exception as e:
        print("wikipedia: 役満:", e)
        return old_y
    # 当時の所属チーム: そのシーズンの成績表 → 今季の成績 → 公式チームページの順に探す
    for r in rows:
        season_rows = list(wiki.get("seasons", {}).get(r["season"], []))
        for rows_ in wiki.get("postseason", {}).get(r["season"], {}).values():
            season_rows += rows_
        if r["season"] == data["season"]:
            season_rows += data["players"]
        team_of = {x["name"]: x["team"] for x in season_rows}
        for key in ("winner", "loser"):
            n = r[key]
            r[key + "Team"] = team_of.get(n) or (players.get(n) or {}).get("team") if n else None
        r["yaku"] = r["yaku"].replace("（単騎）", "単騎")
    main_article = "https://ja.wikipedia.org/wiki/" + urllib.parse.quote("Mリーグ")
    return {"fetchedAt": now.isoformat(timespec="seconds"), "source": main_article + "#" + urllib.parse.quote("役満"),
            "license": "CC BY-SA 4.0", "rows": rows}


def unify_names(wiki, official_names, extra_rows=()):
    """Wikipedia の選手名の表記ゆれを1つにそろえる（公式の表記があればそれ、なければ最も多い表記）。

    extra_rows: 役満の一覧など、winner/loser/dealer/seats に選手名を持つ行も一緒にそろえる。
    """
    post_rows = [rows for stages in wiki.get("postseason", {}).values() for rows in stages.values()]
    counts = Counter(r["name"] for rows in list(wiki.get("seasons", {}).values()) + post_rows for r in rows)
    counts.update(t["name"] for t in wiki.get("titles", []))
    groups = {}
    for n in list(official_names) + list(counts):
        groups.setdefault(name_key(n), set()).add(n)
    canonical = {}
    for variants in groups.values():
        official = [n for n in variants if n in official_names]
        best = official[0] if official else max(variants, key=lambda n: (counts[n], n))
        for n in variants:
            canonical[n] = best
    changed = Counter()
    for rows in list(wiki.get("seasons", {}).values()) + post_rows + [wiki.get("titles", [])]:
        for r in rows:
            if canonical.get(r["name"], r["name"]) != r["name"]:
                changed[(r["name"], canonical[r["name"]])] += 1
                r["name"] = canonical[r["name"]]
    for r in extra_rows:
        for key in ("winner", "loser", "dealer"):
            if r.get(key) and canonical.get(r[key], r[key]) != r[key]:
                changed[(r[key], canonical[r[key]])] += 1
                r[key] = canonical[r[key]]
        r["seats"] = [canonical.get(n, n) for n in r.get("seats", [])]
    for (a, b), n in changed.items():
        print(f"  unify: {a} -> {b} ({n}件)")


def scrape_history(now, data, old):
    players = {}
    for tid, (_, _, slug) in TEAMS.items():
        players.update(parse_team_page(fetch(f"/teams/{slug}/"), tid))
    team_stages = parse_team_stage_points(fetch_text("/assets/js/main.bundle.js"))
    wiki = scrape_wikipedia(now, data["season"], old.get("wiki") or {})
    yakuman = scrape_yakuman(now, old, wiki, data, players)
    unify_names(wiki, set(players) | {p["name"] for p in data["players"]}, yakuman.get("rows", []))
    check_postseason(wiki, team_stages)
    standings = merge_standings(compute_standings(team_stages), wiki.get("teams", {}))
    compared, mismatches = cross_check(players, wiki)
    print(f"cross-check: {compared} rows compared, {len(mismatches)} mismatches")
    for m in mismatches:
        print("  mismatch:", m)

    # 今季の詳しい個人成績を保存しておき、翌シーズン以降も過去シーズンとして全項目を見られるようにする
    archive = dict(old.get("archive") or {})
    archive[data["season"]] = data["players"]
    archive_post = dict(old.get("archivePost") or {})
    if data.get("postseason"):
        archive_post[data["season"]] = data["postseason"]

    # メンテナンス中などで公式のページが空だったときは、前回の内容のまま使う
    if not players and old.get("players"):
        print("history: 公式チームページの成績が空なので、前回のままにします")
        players = old["players"]
    if not team_stages and old.get("teamStages"):
        print("history: 公式のステージ別ポイントが空なので、前回のままにします")
        team_stages = old["teamStages"]
        standings = old.get("standings") or standings

    return {
        "updatedAt": now.isoformat(timespec="seconds"),
        "players": players,
        "teamStages": team_stages,
        "standings": standings,
        "archive": archive,
        "archivePost": archive_post,
        "wiki": wiki,
        "yakuman": yakuman,
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
              f"({len(hist['players'])} players, {len(hist['teamStages'])} teams, {len(hist['standings'])} seasons of standings, archive={list(hist['archive'])})")


if __name__ == "__main__":
    main()
