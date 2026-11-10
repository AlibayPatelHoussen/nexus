#!/usr/bin/env python3
"""
oxtorrent.py — films / séries / animes from OxTorrent, downloaded with aria2.

Built from the qBittorrent search plugin by CravateRouge (see the notice
below), turned into a Nexus script like films.py / movix.py / anisama.py:

    python3 oxtorrent.py                      menu (search, choose, download)
    python3 oxtorrent.py --json --search Q    JSON Lines for Nexus
    python3 oxtorrent.py --json --details oxtorrent:film:82140
    python3 oxtorrent.py --json --download oxtorrent:film:82140 --dest /media/films

The site changes domain often: the current one is read from the portal
https://ww1.click/oxtorrent/ (its iframe), remembered for a day in
data/oxtorrent.json, and can be forced with OXTORRENT_URL.

Where files go (what the Nexus library expects):
    films   <dest>/<Titre (Année)>/<vidéo>       (video files of the torrent, flattened)
    séries  <dest>/<Titre>/<contenu du torrent>  (episodes found by their S01E02 names)
    animes  <dest>/<Titre>/<contenu du torrent>
While downloading, everything stays in a hidden <dest>/.part-oxtorrent-<id>/ folder,
so a torrent cut in the middle is never taken for a finished one (and resumes).

Original plugin notice:
#VERSION: 1.0
#AUTHORS:   CravateRouge (github.com/CravateRouge)
# Redistribution and use in source and binary forms, with or without
# modification, are permitted provided that the following conditions are met:
#    * Redistributions of source code must retain the above copyright notice,
#      this list of conditions and the following disclaimer.
#    * Redistributions in binary form must reproduce the above copyright
#      notice, this list of conditions and the following disclaimer in the
#      documentation and/or other materials provided with the distribution.
#    * Neither the name of the author nor the names of its contributors may be
#      used to endorse or promote products derived from this software without
#      specific prior written permission.
# THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
# AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
# IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
# ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
# LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
# CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
# SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
# INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
# CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
# ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
# POSSIBILITY OF SUCH DAMAGE.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import time
import unicodedata
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import quote

import nexus_cli

JSON_MODE = nexus_cli.early_json()

import requests
from bs4 import BeautifulSoup

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
PORTAL = "https://ww1.click/oxtorrent/"
DEFAULT_BASE = "https://ww4-oxtorrent.officiel.cc"
BASE_FILE = DATA / "oxtorrent.json"

FILMS_DIR = os.environ.get("FILMS_PATH") or "/media/films"
SERIES_DIR = os.environ.get("SERIES_PATH") or "/media/series"
ANIMES_DIR = os.environ.get("ANIMES_PATH") or "/media/animes"

TMDB_IMG = "https://image.tmdb.org/t/p/w342"
VIDEO_EXTS = (".mkv", ".mp4", ".avi", ".m4v", ".mov", ".wmv", ".ts", ".webm")
KEEP_EXTS = VIDEO_EXTS + (".srt", ".ass", ".ssa", ".sub", ".idx", ".vtt")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": UA,
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate"
})

R = "\033[0m"; B = "\033[1m"; DIM = "\033[2m"; CY = "\033[96m"; GR = "\033[92m"; YE = "\033[93m"; RE = "\033[91m"


def c(text, *styles): return "".join(styles) + str(text) + R
def ok(t):   print(c("  ✅ " + t, GR))
def err(t):  print(c("  ✗  " + t, RE))
def warn(t): print(c("  ⚠  " + t, YE))
def step(t): print(c("  →  " + t, DIM))


# ── Site address ──────────────────────────────────────────────────────────────

def site_base(refresh=False):
    """Current OxTorrent domain: OXTORRENT_URL, else the portal's iframe (remembered a day)."""
    forced = os.environ.get("OXTORRENT_URL")
    if forced:
        return forced.rstrip("/")
    saved = {}
    try:
        saved = json.loads(BASE_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass
    if not refresh and saved.get("base") and time.time() - saved.get("at", 0) < 86400:
        return saved["base"]
    try:
        r = SESSION.get(PORTAL, timeout=15)
        m = re.search(r"<iframe[^>]+id=[\"']main-iframe[\"'][^>]+src=[\"'](https?://[^\"'/]+)", r.text) \
            or re.search(r"<iframe[^>]+src=[\"'](https?://[^\"'/]*oxtorrent[^\"'/]*)", r.text, re.I)
        if m:
            base = m.group(1).rstrip("/")
            DATA.mkdir(exist_ok=True)
            BASE_FILE.write_text(json.dumps({"base": base, "at": time.time()}), encoding="utf-8")
            return base
    except requests.RequestException as e:
        print(f"portail: {e}")
    return saved.get("base") or DEFAULT_BASE


def get_page(path, retry_portal=True):
    base = site_base()
    for attempt in range(2):
        try:
            r = SESSION.get(base + path, timeout=25, headers={"Referer": base + "/"})
            if r.status_code == 200:
                return r.text, base
            print(f"{base + path} -> {r.status_code}", file=sys.stderr)
        except requests.RequestException as e:
            print(f"{base + path} -> {e}", file=sys.stderr)
        if attempt == 0 and retry_portal:
            base = site_base(refresh=True)      # the domain may have moved: ask the portal again
    return None, base


# ── Release names ─────────────────────────────────────────────────────────────

STOP = re.compile(
    r"\b(S\d{1,2}(?:E\d{1,4})?|E(?:p|pisode)?\s?\d{1,4}|Saison\s*\d+|INT[EÉ]GRALE|COMPLETE|MULTi|MULTI|TRUEFRENCH|FRENCH|SUBFRENCH|VOSTFR|"
    r"VFF|VFQ|VF2|VFI|\d{3,4}p|4K|UHD|HDLight|4KLight|WEB(?:-?DL|RIP)?|BluRay|BDRip|BRRip|DVDRip|HDTV|REMUX|"
    r"x26[45]|HEVC|H26[45])\b", re.I)


def parse_release(name):
    """'Inception.2010.MULTi.VFF.2160p…' -> title, year, season, langs, quality."""
    raw = re.sub(r"^\s*[\[\(][^\]\)]*[\]\)]\s*", "", name or "")   # [ OxTorrent.com ]
    n = re.sub(r"[._]+", " ", raw).strip()
    stop = STOP.search(n)
    end = stop.start() if stop else len(n)
    year = None
    for m in re.finditer(r"\b((?:19|20)\d{2})\b", n):
        if m.start() == 0:
            continue                      # « 1917 », « 2012 »: the year is the title
        year = int(m.group(1))            # before the tags it ends the title, after them it is only the year
        if m.start() <= end:
            end = m.start()
        break
    title = re.sub(r"\s+", " ", n[:end]).strip(" -–([")
    if not title:
        title = n.split(" ")[0]
    up = n.upper()
    langs = []
    if re.search(r"\bMULTI\b", up):
        langs.append("MULTI")
    if re.search(r"\b(TRUEFRENCH|FRENCH|VFF|VFQ|VF2|VFI)\b", up) and "MULTI" not in langs:
        langs.append("VF")
    if re.search(r"\bVOSTFR\b|\bSUBFRENCH\b", up):
        langs.append("VOSTFR")
    q = re.search(r"\b(2160p|1080p|720p|480p)\b", n, re.I) or re.search(r"\b(4KLight|HDLight|4K|UHD)\b", n, re.I) \
        or re.search(r"\b(REMUX|BluRay|BDRip|BRRip|WEB-?DL|WEBRip|WEB|HDTV|DVDRip)\b", n, re.I)
    quality = None
    if q:
        quality = q.group(1)
        quality = quality.lower() if re.fullmatch(r"\d{3,4}p", quality, re.I) else \
            {"bdrip": "BDRip", "brrip": "BRRip", "webrip": "WEBRip", "web-dl": "WEB-DL", "webdl": "WEB-DL", "web": "WEB",
             "hdtv": "HDTV", "dvdrip": "DVDRip", "bluray": "BluRay", "remux": "REMUX", "4klight": "4KLight",
             "hdlight": "HDLight", "4k": "4K", "uhd": "UHD"}.get(quality.lower(), quality)
    s = re.search(r"\bS(\d{1,2})(?:E(\d{1,4}))?\b|\bSaison\s*(\d+)", n, re.I)
    e = re.search(r"\bS\d{1,2}E(\d{1,4})\b|\bE(?:p|pisode)?\s?(\d{1,4})\b", n, re.I)
    return {"title": title, "year": year, "season": int(s.group(1) or s.group(3)) if s else None,
            "episode": int(e.group(1) or e.group(2)) if e else None, "langs": langs, "quality": quality}


def _norm(text):
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def kind_of(category):
    c_ = _norm(category)
    if "film" in c_:
        return "film"
    if "serie" in c_:
        return "serie"
    if "anime" in c_:
        return "anime"
    return None      # music, games, ebooks…: not for the library


def size_bytes(text):
    m = re.search(r"([\d.,]+)\s*([KMGT]?)o?B?", (text or "").upper().replace("O", "B"))
    if not m:
        return None
    mult = {"": 1, "K": 1024, "M": 1024 ** 2, "G": 1024 ** 3, "T": 1024 ** 4}[m.group(2)]
    try:
        return int(float(m.group(1).replace(",", ".")) * mult)
    except ValueError:
        return None


def _int(text):
    m = re.search(r"\d+", (text or "").replace(" ", ""))
    return int(m.group(0)) if m else 0


# ── Search ────────────────────────────────────────────────────────────────────

def parse_results(html):
    """Rows of the result table: name, detail id, category, size, seeds, leech."""
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for tr in soup.select("table tr"):
        a = tr.select_one("td.liste-accueil-nom a[href*='/detail/']") or tr.select_one("a[href*='/detail/']")
        if not a:
            continue
        m = re.search(r"/detail/(\d+)", a.get("href", ""))
        if not m:
            continue
        cat = tr.select_one("td.liste-accueil-type")
        cell = lambda cls: (tr.select_one(f".{cls}").get_text(" ", strip=True) if tr.select_one(f".{cls}") else "")
        out.append({
            "detail": m.group(1),
            "name": (a.get("title") or a.get_text(" ", strip=True)).strip(),
            "category": (cat.get("title") if cat else "") or "",
            "size": cell("liste-accueil-taille"),
            "seeds": _int(cell("liste-accueil-sources")),
            "leech": _int(cell("liste-accueil-clients")),
        })
    return out


MAX_PAGES = 4     # 50 rows a page: a series with every episode in 3 languages needs more than one


def search(query):
    q = query.strip()[:49]              # the site's search box takes 49 characters
    path = "/recherche/" + quote(q)
    html, _ = get_page(path)
    if not html:
        return []
    found = parse_results(html)
    offsets = sorted({int(o) for o in re.findall(re.escape(path) + r"/(\d+)", html) if int(o) > 1})
    offsets = [o for o in (51, 101, 151) if o in offsets or (offsets and o <= max(offsets))][: MAX_PAGES - 1]
    if offsets:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=3) as pool:
            for page in pool.map(lambda o: get_page(f"{path}/{o}", retry_portal=False)[0], offsets):
                found += parse_results(page or "")
    words = [w for w in _norm(q).split() if len(w) > 1] or _norm(q).split()
    rows = []
    for row in found:
        hay = " " + _norm(row["name"]) + " "
        if all(w in hay for w in words):
            rows.append(row)
    rows.sort(key=lambda r: -r["seeds"])
    return rows


# ── TMDB (posters, exact title for the library) ───────────────────────────────

_TMDB = {}


def tmdb_match(title, year, kind):
    key = nexus_cli.env_value("TMDB_API_KEY")
    k = (title.lower(), year, kind)
    if not key or k in _TMDB:
        return _TMDB.get(k)
    media = "movie" if kind == "film" else "tv"
    hit = None
    try:
        params = {"api_key": key, "query": title, "language": "fr-FR"}
        if year:
            params["year" if media == "movie" else "first_air_date_year"] = year
        res = SESSION.get(f"https://api.themoviedb.org/3/search/{media}", params=params, timeout=10).json()
        hit = (res.get("results") or [None])[0]
    except Exception:
        pass
    _TMDB[k] = {"id": hit["id"], "media_type": media,
                "poster_url": TMDB_IMG + hit["poster_path"] if hit.get("poster_path") else None,
                "description": (hit.get("overview") or None),
                "title": hit.get("title") or hit.get("name"),
                "year": int((hit.get("release_date") or hit.get("first_air_date") or "0")[:4] or 0) or None} if hit else None
    return _TMDB[k]


# ── Versions: one card per film / series ──────────────────────────────────────
# The site lists every release on its own line (720p, 1080p, 4K, VF, VOSTFR…).
# Nexus shows one card per film and per series, with the versions inside.

try:
    from guessit import guessit as _guessit       # proven release-name parser (apt: python3-guessit)
except Exception:                                  # missing: the regexes below do the job
    _guessit = None

LANG_RULES = [   # (token, label, family) — first match wins
    (r"\bMULTI\b", "MULTI", "MULTI"),
    (r"\b(VOSTFR|SUBFRENCH|FASTSUB)\b", "VOSTFR", "VOSTFR"),
    (r"\bTRUEFRENCH\b", "TRUEFRENCH", "VF"),
    (r"\bVFF\b", "VFF", "VF"),
    (r"\bVFQ\b", "VFQ", "VF"),
    (r"\b(VF2|VFI|FRENCH|VF)\b", "VF", "VF"),
]
SOURCE_RULES = [
    (r"\bREMUX\b", "REMUX"), (r"\b(BDRip|BRRip)\b", "BDRip"), (r"\b(Blu-?Ray|UHD)\b", "BluRay"),
    (r"\bWEB-?DL\b", "WEB-DL"), (r"\bWEB-?Rip\b", "WEBRip"), (r"\bHDTV\b", "HDTV"), (r"\bDVDRip\b", "DVDRip"),
    (r"\bHDRip\b", "HDRip"), (r"\b4KLight\b", "4KLight"), (r"\bHDLight\b", "HDLight"), (r"\bWEB\b", "WEB-DL"),
    (r"\bDVD\b", "DVDRip"),
]
CODEC_RULES = [(r"\b(x265|HEVC|H\.?265)\b", "x265"), (r"\b(x264|AVC|H\.?264)\b", "x264"), (r"\bAV1\b", "AV1"),
               (r"\bXviD\b", "XviD")]


def _clean_name(name):
    """Release name without the site's additions: extension, « (Titre en clair) », double dots."""
    plain = None
    m = re.search(r"\s\(([^()]*[A-Za-zÀ-ÿ][^()]*)\)\s*$", name or "")
    if m:
        plain, name = m.group(1).strip(), name[: m.start()]
    name = re.sub(r"\.(mkv|mp4|avi|m4v|ts)$", "", name.strip(), flags=re.I)
    return re.sub(r"\.{2,}", ".", name).strip(), plain


def group_key(title):
    """« Georgie & Mandy's First Marriage » == « Georgie.and.Mandys.First.Marriage »."""
    t = _norm(re.sub(r"['’`´]", "", (title or "").replace("&", " and ")))
    words = [w for w in t.split() if w not in ("the", "and", "le", "la", "les")]
    return " ".join(words) or t


def analyse(name):
    """Everything the release name says: title, year, season / episode(s), resolution, source, codec, language."""
    clean, plain = _clean_name(name)
    spaced = re.sub(r"[._]+", " ", clean)
    g = {}
    if _guessit:
        try:
            g = dict(_guessit(clean))
        except Exception:
            g = {}
    rel = parse_release(clean)                      # regex fallback (and what guessit misses)
    title = g.get("title") if isinstance(g.get("title"), str) else rel["title"]
    year = g.get("year") if isinstance(g.get("year"), int) else rel["year"]

    # Season / episode(s): S02E12-22, S02e22, S01, E1180
    season = episode = None
    episodes = None
    m = re.search(r"\bS(\d{1,2})\s?E(\d{1,4})(?:\s?-\s?E?(\d{1,4}))?\b", spaced, re.I)
    if m:
        season, a, b = int(m.group(1)), int(m.group(2)), m.group(3)
        if b and int(b) > a:
            episodes = list(range(a, int(b) + 1))
        else:
            episode = a
    else:
        m = re.search(r"\bS(\d{1,2})\b|\bSaison\s*(\d{1,2})\b", spaced, re.I)
        if m:
            season = int(m.group(1) or m.group(2))
        e = re.search(r"\bE(?:p|pisode)?\s?(\d{1,4})\b", spaced, re.I)
        if e:
            episode = int(e.group(1))
    if season is None and isinstance(g.get("season"), int):
        season = g["season"]
    if episode is None and episodes is None and isinstance(g.get("episode"), int):
        episode = g["episode"]
    elif episode is None and episodes is None and isinstance(g.get("episode"), list):
        episodes = sorted(x for x in g["episode"] if isinstance(x, int))

    up = spaced.upper()
    language = family = None
    for rx, label, fam in LANG_RULES:
        if re.search(rx, up):
            language, family = label, fam
            break
    if not language and g.get("subtitle_language"):
        language, family = "VOSTFR", "VOSTFR"
    elif not language and str(g.get("language", "")).startswith("fr"):
        language, family = "VF", "VF"

    res = re.search(r"\b(2160p|1080p|720p|576p|480p)\b", spaced, re.I)
    resolution = res.group(1).lower() if res else None
    if not resolution and re.search(r"\b(4K|UHD|4KLight)\b", spaced, re.I):
        resolution = "2160p"
    if not resolution and isinstance(g.get("screen_size"), str) and re.fullmatch(r"\d{3,4}p", g["screen_size"]):
        resolution = g["screen_size"]
    if not resolution and re.search(r"\bHDLight\b", spaced, re.I):
        resolution = "1080p"
    source = next((label for rx, label in SOURCE_RULES if re.search(rx, spaced, re.I)), None)
    codec = next((label for rx, label in CODEC_RULES if re.search(rx, spaced, re.I)), None)
    return {"title": title, "plain_title": plain, "year": year, "season": season, "episode": episode,
            "episodes": episodes, "resolution": resolution, "source": source, "codec": codec,
            "language": language, "language_family": family}


def _version(row, kind, a):
    return {"id": f"oxtorrent:{kind}:{row['detail']}", "release": row["name"], "resolution": a["resolution"],
            "source": a["source"], "codec": a["codec"], "language": a["language"], "language_family": a["language_family"],
            "size": row["size"], "size_bytes": size_bytes(row["size"]), "seeders": row["seeds"], "leechers": row["leech"]}


def group_rows(rows):
    """Search rows -> [{kind, key, title, year, versions | seasons}] (one per film / series)."""
    seen, unique = {}, []
    for row in rows:                       # the same release is sometimes listed twice
        k = (row["name"].strip().lower(), row["size"])
        if k in seen:
            if row["seeds"] > seen[k]["seeds"]:
                unique[unique.index(seen[k])] = row
                seen[k] = row
            continue
        seen[k] = row
        unique.append(row)

    analysed = []
    for row in unique:
        kind = kind_of(row["category"])
        if not kind:
            continue
        a = analyse(row["name"])
        if kind == "film" and (a["season"] or a["episode"] or a["episodes"]):
            kind = "serie"                 # an episode filed under Films
        analysed.append((row, kind, a))

    groups = {}
    for row, kind, a in analysed:
        key = (kind, group_key(a["title"]), a["year"])
        g = groups.setdefault(key, {"kind": kind, "key": group_key(a["title"]), "title": a["plain_title"] or a["title"],
                                    "year": a["year"], "rows": []})
        if a["plain_title"] and not g["title"] == a["plain_title"]:
            g["title"] = a["plain_title"]       # « (Georgie & Mandy's First Marriage) » reads better than the dotted name
        g["rows"].append((row, a))
    # No year on some releases: they join the only group of the same title
    for key in [k for k in groups if k[2] is None]:
        same = [k for k in groups if k[:2] == key[:2] and k[2] is not None]
        if len(same) == 1:
            groups[same[0]]["rows"] += groups.pop(key)["rows"]

    out = []
    for g in groups.values():
        kind = g["kind"]
        if kind == "film":
            g["versions"] = [_version(r, kind, a) for r, a in g["rows"]]
        else:
            seasons = {}
            for r, a in g["rows"]:
                n = a["season"] or 1
                s_ = seasons.setdefault(n, {"number": n, "episodes": {}, "packs": {}})
                v = _version(r, kind, a)
                if a["episode"] is not None:
                    s_["episodes"].setdefault(a["episode"], {"number": a["episode"], "title": None, "versions": []})["versions"].append(v)
                else:
                    eps = a["episodes"]
                    label = f"Épisodes {eps[0]}–{eps[-1]}" if eps else "Saison complète"
                    s_["packs"].setdefault(label, {"label": label, "episodes": eps, "versions": []})["versions"].append(v)
            g["seasons"] = [{"number": n, "episodes": sorted(s_["episodes"].values(), key=lambda e: e["number"]),
                             "packs": sorted(s_["packs"].values(), key=lambda p: (p["episodes"] is not None, p["label"]))}
                            for n, s_ in sorted(seasons.items())]
        g["seeders"] = sum(r["seeds"] for r, _ in g["rows"])
        del g["rows"]
        out.append(g)
    out.sort(key=lambda g: -g["seeders"])
    return out


def _tmdb_episode_titles(tv_id, season):
    key = nexus_cli.env_value("TMDB_API_KEY")
    if not key:
        return {}
    try:
        d = SESSION.get(f"https://api.themoviedb.org/3/tv/{tv_id}/season/{season}",
                        params={"api_key": key, "language": "fr-FR"}, timeout=10).json()
        return {e["episode_number"]: e.get("name") for e in d.get("episodes", []) if e.get("name")}
    except Exception:
        return {}


# ── Detail page ───────────────────────────────────────────────────────────────

def parse_detail(html):
    soup = BeautifulSoup(html, "html.parser")
    info = {}
    for tr in soup.select("#collapseOne table tr, table.table tr"):
        tds = tr.find_all("td")
        if len(tds) >= 2:
            label = _norm(tds[0].get_text(" ", strip=True))
            if label and label not in info:
                info[label] = tds[1].get_text(" ", strip=True)
    torrent = soup.select_one("a[href*='/get_torrents/']")
    magnet = soup.select_one("a[href^='magnet:']")
    img = soup.select_one("#torrentsimage img[src]")
    desc = soup.select_one("#torrentsdesc")
    release = desc.select_one(".maximum") if desc else None
    text = desc.get_text("\n", strip=True) if desc else ""
    if release:
        text = text.replace(release.get_text(" ", strip=True), "", 1).strip()
    return {
        "title": info.get("titre", ""),
        "category": info.get("categories", ""),
        "size": info.get("poids du fichier", ""),
        "seeds": _int(info.get("seeders", "")),
        "leech": _int(info.get("leechers", "")),
        "release": release.get_text(" ", strip=True) if release else "",
        "description": re.sub(r"\s+", " ", text)[:600] or None,
        "poster_url": img["src"] if img else None,
        "torrent": torrent["href"] if torrent else None,
        "magnet": magnet["href"] if magnet else None,
    }


# ── aria2 ─────────────────────────────────────────────────────────────────────

UNITS = {"B": 1, "KiB": 1024, "MiB": 1024 ** 2, "GiB": 1024 ** 3, "TiB": 1024 ** 4}
PROGRESS = re.compile(
    r"\[#\w+\s+(?:SEED\([^)]*\)\s+)?([\d.]+)(B|KiB|MiB|GiB|TiB)/([\d.]+)(B|KiB|MiB|GiB|TiB)\((\d+)%\)"
    r"(?:.*?DL:([\d.]+)(B|KiB|MiB|GiB|TiB))?(?:.*?ETA:([\dhms]+))?")


def parse_progress(line):
    """'[#2089b0 1.2GiB/4.3GiB(28%) CN:44 SD:12 DL:6.1MiB ETA:8m33s]' -> numbers."""
    m = PROGRESS.search(line)
    if not m:
        return None
    eta = None
    if m.group(8):
        parts = dict((u, int(v)) for v, u in re.findall(r"(\d+)([hms])", m.group(8)))
        eta = parts.get("h", 0) * 3600 + parts.get("m", 0) * 60 + parts.get("s", 0)
    return {"done": float(m.group(1)) * UNITS[m.group(2)], "total": float(m.group(3)) * UNITS[m.group(4)],
            "percent": int(m.group(5)), "speed": float(m.group(6)) * UNITS[m.group(7)] if m.group(6) else None,
            "eta": eta}


def aria2(source, work_dir, item):
    """Downloads a .torrent file or a magnet into work_dir (resumes). True when complete."""
    cmd = ["aria2c", f"--dir={work_dir}", "--seed-time=0", "--bt-stop-timeout=1800", "--summary-interval=2",
           "--console-log-level=warn", "--enable-color=false", "--show-console-readout=false",
           "--file-allocation=none", "--continue=true", "--follow-torrent=mem", "--bt-save-metadata=false",
           "--max-overall-upload-limit=1M", "--auto-file-renaming=false", source]
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=0)
    except FileNotFoundError:
        nexus_cli.emit("error", message="aria2 n'est pas installé sur le serveur (sudo apt-get install -y aria2)",
                       item=item, fatal=False)
        return False
    throttle = nexus_cli.Throttle()
    buf = b""
    while True:
        chunk = proc.stdout.read(4096)
        if not chunk:
            break
        buf += chunk
        *lines, buf = re.split(rb"[\r\n]", buf)
        for raw in lines:
            line = raw.decode("utf-8", "replace").strip()
            if not line:
                continue
            p = parse_progress(line)
            if p and p["total"] > 0:
                nexus_cli.video_progress(item, p["done"], p["total"], p["speed"], p["percent"], p["eta"], throttle)
            elif not line.startswith(("***", "FILE:", "-")):
                print(line)
    proc.wait()
    return proc.returncode == 0


def _videos(folder):
    return [p for p in Path(folder).rglob("*") if p.is_file() and p.suffix.lower() in VIDEO_EXTS
            and not re.search(r"(^|[^a-z])sample([^a-z]|$)", p.name, re.I)]


def safe_name(text):
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", text or "").strip(" .")
    return re.sub(r"\s+", " ", text)[:150] or "Torrent"


def place(work_dir, kind, title, year, dest, tmdb_id=None):
    """Moves the finished torrent where the library looks. Returns (folder, video files)."""
    work = Path(work_dir)
    if kind == "film":
        target = Path(dest) / safe_name(f"{title} ({year})" if year else title)
        target.mkdir(parents=True, exist_ok=True)
        moved = []
        for f in sorted(p for p in work.rglob("*") if p.is_file() and p.suffix.lower() in KEEP_EXTS
                        and not p.name.startswith(".")):
            if f.suffix.lower() in VIDEO_EXTS and re.search(r"(^|[^a-z])sample([^a-z]|$)", f.name, re.I):
                continue
            to = target / f.name
            if not to.exists():
                shutil.move(str(f), str(to))
            moved.append(to)
        return target, [p for p in moved if p.suffix.lower() in VIDEO_EXTS]
    # A series already downloaded by movix (« Titre_avec_underscores ») or under another
    # title: same folder, so the library shows it once
    target = nexus_cli.series_folder(dest, title, safe_name(title), tmdb_id) if kind == "serie" else Path(dest) / safe_name(title)
    target.mkdir(parents=True, exist_ok=True)
    for entry in work.iterdir():
        if entry.name.startswith(".") or entry.suffix == ".aria2":
            continue
        to = target / entry.name
        if to.exists() and entry.is_dir():
            for sub in entry.rglob("*"):         # same folder already there (resumed / re-download): merge
                if sub.is_file():
                    rel = target / entry.name / sub.relative_to(entry)
                    rel.parent.mkdir(parents=True, exist_ok=True)
                    if not rel.exists():
                        shutil.move(str(sub), str(rel))
        elif not to.exists():
            shutil.move(str(entry), str(to))
    return target, _videos(target)


def write_hint(kind, folder, paths, tmdb):
    """Exact TMDB id next to the files (read by the library scan, like movix downloads)."""
    if not tmdb or not paths:
        return
    hint = json.dumps({"source": "oxtorrent", "media_type": tmdb["media_type"], "tmdb_id": tmdb["id"],
                       "title": tmdb.get("title")}) + "\n"
    try:
        if kind == "film":
            for p in paths:
                h = p.with_name(f".{p.name}.nexus.json")
                if not h.exists():
                    h.write_text(hint, encoding="utf-8")
        elif kind == "serie":
            h = Path(folder) / ".nexus.json"
            if not h.exists():
                h.write_text(hint, encoding="utf-8")
    except OSError as e:
        print(f"hint: {e}")


def fetch_torrent(base, detail, work_dir):
    """The .torrent file (no DHT needed for the metadata), else the magnet."""
    if detail.get("torrent"):
        try:
            r = SESSION.get(base + detail["torrent"], timeout=30, headers={"Referer": base + "/"})
            if r.status_code == 200 and r.content[:1] == b"d":
                f = Path(work_dir) / ".source.torrent"
                f.write_bytes(r.content)
                return str(f)
        except requests.RequestException as e:
            print(f"torrent: {e}")
    return detail.get("magnet")


# ── Nexus (--json) ────────────────────────────────────────────────────────────

def _parse_id(id_):
    m = re.fullmatch(r"oxtorrent:(film|serie|anime):(\d{1,10})", id_ or "")
    if not m:
        nexus_cli.fail(f"Identifiant invalide : {id_}")
    return m.group(1), m.group(2)


def json_search(query, limit):
    groups = group_rows(search(query))[: (limit or 12)]

    def one(g):
        tmdb = tmdb_match(g["title"], g["year"], g["kind"])
        res = {"id": f"oxtorrent:group:{g['kind']}:{re.sub(r'[^a-z0-9]+', '-', g['key'])}-{g['year'] or ''}".rstrip("-"),
               "source": "oxtorrent", "kind": g["kind"], "title": (tmdb or {}).get("title") or g["title"],
               "year": g["year"] or (tmdb or {}).get("year"), "poster_url": (tmdb or {}).get("poster_url"),
               "description": (tmdb or {}).get("description")}
        if g["kind"] == "film":
            res["versions"] = g["versions"]
        else:
            if tmdb:
                for s_ in g["seasons"]:
                    names = _tmdb_episode_titles(tmdb["id"], s_["number"]) if s_["episodes"] else {}
                    for e in s_["episodes"]:
                        e["title"] = names.get(e["number"])
            res["seasons"] = g["seasons"]
        return res

    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=6) as pool:
        for res in pool.map(one, groups):
            nexus_cli.emit("result", **res)


def json_details(id_):
    kind, detail_id = _parse_id(id_)
    html, _ = get_page(f"/detail/{detail_id}")
    if not html:
        nexus_cli.fail("OxTorrent ne répond pas")
    d = parse_detail(html)
    rel = parse_release(d["release"] or d["title"])
    tmdb = tmdb_match(rel["title"], rel["year"], kind) if kind != "anime" else None
    nexus_cli.emit("details", id=id_, kind=kind, title=rel["title"], year=rel["year"],
                   poster_url=d["poster_url"] or (tmdb or {}).get("poster_url"),
                   description=d["description"] or (tmdb or {}).get("description"),
                   release=d["release"] or d["title"], size=d["size"], seeds=d["seeds"], leech=d["leech"],
                   langs=rel["langs"], quality=rel["quality"], season=rel["season"], episode=rel["episode"],
                   downloadable=bool(d["torrent"] or d["magnet"]))


def json_download(args):
    kind, detail_id = _parse_id(args.download)
    if not shutil.which("aria2c"):
        nexus_cli.fail("aria2 n'est pas installé sur le serveur (sudo apt-get install -y aria2)")
    dest = args.dest or {"film": FILMS_DIR, "serie": SERIES_DIR, "anime": ANIMES_DIR}[kind]
    html, base = get_page(f"/detail/{detail_id}")
    if not html:
        nexus_cli.fail("OxTorrent ne répond pas")
    d = parse_detail(html)
    rel = parse_release(d["release"] or d["title"])
    item = d["release"] or rel["title"]
    nexus_cli.emit("item_start", name=item, index=1, total=1)
    if not (d["torrent"] or d["magnet"]):
        nexus_cli.emit("error", message="Pas de lien torrent sur cette page", item=item, fatal=False)
        nexus_cli.emit("done", ok=0, failed=1, skipped=0)
        return 2
    os.makedirs(dest, exist_ok=True)
    need = size_bytes(d["size"])
    free = shutil.disk_usage(dest).free
    work = Path(dest) / f".part-oxtorrent-{detail_id}"
    already = sum(f.stat().st_size for f in work.rglob("*") if f.is_file()) if work.exists() else 0
    if need and free + already < need * 1.02:
        nexus_cli.emit("error", message=f"Pas assez de place : {d['size']} à télécharger, {free / 1024 ** 3:.1f} GB libres",
                       item=item, fatal=False)
        nexus_cli.emit("done", ok=0, failed=1, skipped=0)
        return 2
    work.mkdir(parents=True, exist_ok=True)
    source = fetch_torrent(base, d, work)
    if not aria2(source, str(work), item):
        # Keep what was received (resumed when retried), but not an empty folder
        if not any(f.is_file() and f.name != ".source.torrent" for f in work.rglob("*")):
            shutil.rmtree(work, ignore_errors=True)
        nexus_cli.emit("error", message="Le torrent n'a pas pu être téléchargé (pas de sources ?)", item=item, fatal=False)
        nexus_cli.emit("done", ok=0, failed=1, skipped=0)
        return 2
    tmdb = tmdb_match(rel["title"], rel["year"], kind) if kind != "anime" else None
    title = (tmdb or {}).get("title") or rel["title"]
    folder, paths = place(work, kind, title, rel["year"], dest, (tmdb or {}).get("id"))
    shutil.rmtree(work, ignore_errors=True)
    if not paths:
        nexus_cli.emit("error", message="Aucune vidéo dans ce torrent", item=item, fatal=False)
        nexus_cli.emit("done", ok=0, failed=1, skipped=0)
        return 2
    write_hint(kind, folder, paths, tmdb)
    for p in paths:
        nexus_cli.emit("item_done", name=item, path=str(p))
    nexus_cli.emit("done", ok=1, failed=0, skipped=0)
    return 0


def json_main():
    args = nexus_cli.parser("oxtorrent.py — mode Nexus").parse_args()
    if args.search is not None:
        json_search(args.search, args.limit)
        nexus_cli.emit("done")
    elif args.details:
        json_details(args.details)
        nexus_cli.emit("done")
    elif args.download:
        sys.exit(json_download(args))
    else:
        nexus_cli.fail("Option non prise en charge")


# ── Menu (without --json) ─────────────────────────────────────────────────────

def main():
    print(c("\n  OxTorrent — films, séries, animes (aria2)\n", B, CY))
    while True:
        q = input(c("  Rechercher (0 = quitter) : ", B)).strip()
        if q in ("", "0"):
            return
        rows = [r for r in search(q) if kind_of(r["category"])][:25]
        if not rows:
            warn("Aucun résultat.")
            continue
        for i, r in enumerate(rows, 1):
            print(f"  {c(i, B, CY):>3}. [{r['category'][:6]}] {r['name']}  {c(r['size'], DIM)}  {c(str(r['seeds']) + ' seeds', GR)}")
        choice = input("  Numéro (0 = retour) : ").strip()
        if not choice.isdigit() or not 0 < int(choice) <= len(rows):
            continue
        row = rows[int(choice) - 1]
        kind = kind_of(row["category"])
        dest = {"film": FILMS_DIR, "serie": SERIES_DIR, "anime": ANIMES_DIR}[kind]
        step(f"Téléchargement dans {dest}…")
        code = json_download(SimpleNamespace(download=f"oxtorrent:{kind}:{row['detail']}", dest=dest))
        (ok if code == 0 else err)("Terminé" if code == 0 else "Échec")


if __name__ == "__main__" and JSON_MODE:
    json_main()
elif __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nAu revoir !")
