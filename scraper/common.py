"""取得と数値変換まわりの共通処理。"""
import re
import time
import urllib.request
from datetime import timedelta, timezone

from bs4 import BeautifulSoup

BASE = "https://m-league.jp"
UA = "Mozilla/5.0 (personal M.League stats viewer; low-frequency fetch)"
JST = timezone(timedelta(hours=9))

# 公式サイトのチームID（成績ページの T0xx）、表示用の短縮名、チームページのスラッグ
TEAMS = {
    "T001": ("赤坂ドリブンズ", "ドリブンズ", "drivens"),
    "T002": ("EX風林火山", "風林火山", "furinkazan"),
    "T003": ("KONAMI麻雀格闘倶楽部", "麻雀格闘倶楽部", "fightclub"),
    "T004": ("渋谷ABEMAS", "ABEMAS", "abemas"),
    "T005": ("セガサミーフェニックス", "フェニックス", "phoenix"),
    "T006": ("TEAM RAIDEN / 雷電", "雷電", "raiden"),
    "T007": ("U-NEXT Pirates", "Pirates", "pirates"),
    "T008": ("KADOKAWAサクラナイツ", "サクラナイツ", "sakuraknights"),
    "T010": ("BEAST X", "BEAST", "beast"),
    "T011": ("EARTH JETS", "JETS", "jets"),
}


def fetch_text(path):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        text = r.read().decode("utf-8")
    time.sleep(1.5)  # 公式サイトに負荷をかけない
    return text


def fetch(path):
    return BeautifulSoup(fetch_text(path), "html.parser")


def norm(s):
    return re.sub(r"\s+", "", s or "")


def team_id(name):
    n = norm(re.sub(r"<br\s*/?>", "", name or ""))
    for tid, (full, short, _) in TEAMS.items():
        if norm(full) == n:
            return tid
    for tid, (_, short, _) in TEAMS.items():
        if short in n:
            return tid
    raise ValueError(f"unknown team: {name!r}")


def num(s):
    s = norm(s).replace("pt", "").replace(",", "").replace("▲", "-")
    try:
        return float(s)
    except ValueError:  # 「―」や未開催試合のプレースホルダ
        return None


def season_label(start_year):
    """2026 -> "2026-27" """
    return f"{start_year}-{str(start_year + 1)[2:]}"
