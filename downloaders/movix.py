# -*- coding: utf-8 -*-
#!/usr/bin/env python3
"""
movix.py - Téléchargeur de séries/films pour movix.college
  - Séries → /media/series
  - Films  → /media/films
"""

import asyncio
import json
import os
import re
import subprocess
import sys
import time

import requests
from playwright.async_api import async_playwright

# Nexus: --json mode (no menu, JSON Lines on stdout)
import nexus_cli
JSON_MODE = nexus_cli.early_json()

# ── Config ────────────────────────────────────────────────────────────────────

TMDB_KEY    = os.environ.get("TMDB_API_KEY") or nexus_cli.env_value("TMDB_API_KEY")
TMDB_BASE   = "https://api.themoviedb.org/3"
MOVIX_API   = "https://api.movix.college/api"

# ── Dossiers serveur ──────────────────────────────────────────────────────────
SERIES_DIR  = "/media/series"
FILMS_DIR   = "/media/films"
os.makedirs(SERIES_DIR, exist_ok=True)
os.makedirs(FILMS_DIR,  exist_ok=True)

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/123.0.0.0 Safari/537.36"
)

# ── Couleurs ──────────────────────────────────────────────────────────────────

R  = "\033[0m"; B  = "\033[1m"; DIM = "\033[2m"
CY = "\033[96m"; GR = "\033[92m"; YE = "\033[93m"
RE = "\033[91m"; BL = "\033[94m"; MG = "\033[95m"

def c(text, *styles): return "".join(styles) + str(text) + R
def sep():   print(c("-" * 54, DIM))
def ok(t):   print(c("  OK  " + t, GR))
def err(t):  print(c("  X   " + t, RE))
def warn(t): print(c("  !   " + t, YE))
def info(t): print(c("  .   " + t, BL))
def dl(t):   print(c("  v   " + t, CY))
def step(t): print(c("  ->  " + t, DIM))

RETOUR = "__RETOUR__"

def prompt(msg):
    try:
        val = input(msg).strip()
        if val in ("0", "r", "retour", "back", ""):
            return RETOUR
        return val
    except (KeyboardInterrupt, EOFError):
        return RETOUR

def choose_one(items, label_fn, prompt_txt="Choix"):
    if not items:
        warn("Aucun resultat.")
        return RETOUR
    print(c("   0. <- Retour", DIM))
    for i, item in enumerate(items, 1):
        print(f"  {c(str(i).rjust(3), B, CY)}. {label_fn(item)}")
    while True:
        val = prompt(f"\n{prompt_txt} (0=retour): ")
        if val == RETOUR:
            return RETOUR
        try:
            idx = int(val)
            if 1 <= idx <= len(items):
                return items[idx - 1]
        except ValueError:
            pass
        print(f"  Entrez un nombre entre 0 et {len(items)}.")

def choose_many(items, label_fn):
    if not items:
        warn("Aucun episode.")
        return []
    print(c("   0. <- Retour", DIM))
    for i, item in enumerate(items, 1):
        print(f"  {c(str(i).rjust(3), B, CY)}. {label_fn(item)}")
    print(c("\n  Exemples : '1'  '1 3 5'  '2-6'  'all'", DIM))
    while True:
        val = prompt("\n  Episodes a telecharger : ")
        if val == RETOUR:
            return []
        val = val.strip().lower()
        if val == "all":
            return items
        m = re.fullmatch(r"(\d+)-(\d+)", val)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            if 1 <= a <= b <= len(items):
                return items[a - 1:b]
        parts = re.split(r"[\s,]+", val)
        selected, valid = [], True
        for p in parts:
            try:
                idx = int(p)
                if 1 <= idx <= len(items):
                    selected.append(items[idx - 1])
                else:
                    valid = False; break
            except ValueError:
                valid = False; break
        if valid and selected:
            return selected
        print("  Format invalide.")

def slugify(text):
    text = re.sub(r'[<>:"/\\|?*]', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text.replace(' ', '_') or "video"

# ── Session HTTP ──────────────────────────────────────────────────────────────

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": UA,
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Referer": "https://movix.college/",
    "Origin":  "https://movix.college",
})

def get_json(url, params=None):
    for attempt in range(3):
        try:
            r = SESSION.get(url, params=params, timeout=15)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if attempt == 2:
                warn(f"  get_json echec : {url[:80]} -> {e}")
                return None
            time.sleep(1)

# ── TMDB ──────────────────────────────────────────────────────────────────────

def search_tmdb(query):
    step(f"Recherche TMDB : {query}...")
    data = get_json(f"{TMDB_BASE}/search/multi", params={
        "api_key":  TMDB_KEY,
        "query":    query,
        "language": "fr-FR",
    })
    if not data or not data.get("results"):
        return []

    results = []
    for r in data["results"][:15]:
        media_type = r.get("media_type", "")
        if media_type not in ("tv", "movie"):
            continue
        title = r.get("name") or r.get("title") or "?"
        year  = (r.get("first_air_date") or r.get("release_date") or "")[:4]
        label = "[SERIE]" if media_type == "tv" else "[FILM] "
        results.append({
            "title": title,
            "id":    r["id"],
            "year":  year,
            "type":  media_type,
            "label": label,
        })
    return results

def get_seasons(tmdb_id):
    data = get_json(f"{TMDB_BASE}/tv/{tmdb_id}", params={
        "api_key": TMDB_KEY,
        "language": "fr-FR",
    })
    if not data:
        return []
    seasons = []
    for s in data.get("seasons", []):
        if s.get("season_number", 0) == 0:
            continue
        seasons.append({
            "name":  f"Saison {s['season_number']}",
            "num":   s["season_number"],
            "count": s.get("episode_count", 0),
        })
    return sorted(seasons, key=lambda x: x["num"])

def get_episodes(tmdb_id, season_num):
    data = get_json(f"{TMDB_BASE}/tv/{tmdb_id}/season/{season_num}", params={
        "api_key": TMDB_KEY,
        "language": "fr-FR",
    })
    if not data:
        return []
    episodes = []
    for ep in data.get("episodes", []):
        num = ep.get("episode_number", 0)
        name = ep.get("name", f"Episode {num}")
        episodes.append({
            "title": f"E{num:02d} - {name}",
            "num":   num,
            "air_date": ep.get("air_date") or "",   # Nexus copy: to hide episodes not out yet
        })
    return sorted(episodes, key=lambda x: x["num"])

# ── Movix API ─────────────────────────────────────────────────────────────────

def get_purstream_url(tmdb_id, season, episode, lang="vf"):
    data = get_json(f"{MOVIX_API}/purstream/tv/{tmdb_id}/stream", params={
        "season": season,
        "episode": episode,
    })
    if not data:
        return None

    sources = data.get("sources", [])
    if not sources:
        return None

    lang_upper = lang.upper()
    for s in sources:
        name = s.get("name", "").upper()
        url  = s.get("url", "")
        if lang_upper in name and url:
            return url

    for s in sources:
        if s.get("url"):
            return s["url"]

    return None


def get_sources(tmdb_id, season, episode):
    step(f"Recuperation des sources (TMDB {tmdb_id} S{season}E{episode})...")
    data = get_json(f"{MOVIX_API}/links/tv/{tmdb_id}", params={
        "season": season,
        "episode": episode,
    })
    if not data:
        return []

    sources = []
    if isinstance(data, dict) and data.get("success"):
        for item in data.get("data", []):
            for i, link in enumerate(item.get("links", [])):
                if isinstance(link, str) and link.startswith("http"):
                    domain = link.split("/")[2] if "//" in link else "source"
                    sources.append({"name": f"link_{i}_{domain}", "url": link})
                elif isinstance(link, dict) and link.get("url"):
                    sources.append({"name": link.get("name", f"link_{i}"), "url": link["url"]})

    info(f"{len(sources)} source(s) trouvee(s)")
    return sources

# ── Téléchargement ────────────────────────────────────────────────────────────

def run_ffmpeg(m3u8_url, headers, output_file):
    ua  = headers.get("user-agent", UA)
    ref = headers.get("referer", "")
    hdr = f"User-Agent: {ua}\r\n"
    if ref:
        hdr += f"Referer: {ref}\r\n"
    step("Conversion ffmpeg...")
    result = subprocess.run([
        "ffmpeg", "-headers", hdr,
        "-i", m3u8_url, "-c", "copy", "-y", output_file
    ])
    if result.returncode == 0:
        ok(f"Sauvegarde : {output_file}")
    else:
        err("ffmpeg a echoue.")

async def download_from_embed(embed_url, output_file):
    m3u8_url     = None
    m3u8_headers = {}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,  # headless sur serveur
            args=["--disable-blink-features=AutomationControlled"]
        )
        context = await browser.new_context(user_agent=UA, locale="fr-FR")

        async def on_request(request):
            nonlocal m3u8_url, m3u8_headers
            if m3u8_url is not None:
                return
            url = request.url
            skip = [
                "api.movix.college", "api.themoviedb.org", "google-analytics",
                "cloudflare", "analytics", "tracker", "beacon",
                ".png", ".jpg", ".svg", ".css", ".woff", ".ico",
                "thumbnail", "poster", "image", "font",
            ]
            if any(s in url for s in skip):
                return
            if any(x in url for x in [".m3u8", ".mp4", "/manifest", "/playlist"]):
                m3u8_url     = url
                m3u8_headers = dict(request.headers)
                ok(f"Flux video intercepte : {url[:80]}")

        context.on("request", on_request)
        page = await context.new_page()

        async def on_new_page(new_page):
            if new_page is page:
                return
            await asyncio.sleep(0.3)
            try:
                await new_page.close()
            except Exception:
                pass

        context.on("page", on_new_page)

        step(f"Ouverture embed : {embed_url[:80]}")
        await page.goto(embed_url, wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(3000)

        try:
            dims = await page.evaluate("() => ({ w: window.innerWidth, h: window.innerHeight })")
            cx = dims["w"] // 2
            cy = dims["h"] // 2
            await page.mouse.click(cx, cy)
            await page.wait_for_timeout(2000)
        except Exception:
            pass

        step("Attente du flux video (max 60s)...")
        for _ in range(60):
            if m3u8_url:
                break
            await page.wait_for_timeout(1000)

        if not m3u8_url:
            found = await page.evaluate("""() => {
                for (const v of document.querySelectorAll('video')) {
                    if (v.src && v.src.startsWith('http')) return v.src;
                }
                return null;
            }""")
            if found:
                m3u8_url = found

        await browser.close()

    if m3u8_url:
        dl(f"Fichier : {output_file}")
        sep()
        run_ffmpeg(m3u8_url, m3u8_headers, output_file)
        # Nexus copy: success only if ffmpeg really wrote the file, else try the next source
        return os.path.exists(output_file) and os.path.getsize(output_file) > 0
    else:
        err("Aucun m3u8 trouve pour cet embed.")
        return False


def get_movie_sources(tmdb_id):
    data = get_json(f"{MOVIX_API}/links/movie/{tmdb_id}")
    if not data:
        return []

    sources = []
    if isinstance(data, dict) and data.get("success"):
        for item in data.get("data", []):
            for i, link in enumerate(item.get("links", [])):
                if isinstance(link, str) and link.startswith("http"):
                    domain = link.split("/")[2] if "//" in link else "source"
                    sources.append({"name": f"link_{i}_{domain}", "url": link})
                elif isinstance(link, dict) and link.get("url"):
                    sources.append({"name": link.get("name", f"link_{i}"), "url": link["url"]})

    pdata = get_json(f"{MOVIX_API}/purstream/movie/{tmdb_id}/stream")
    if pdata and isinstance(pdata, dict):
        for s in pdata.get("sources", []):
            url = s.get("url", "")
            if url:
                sources.insert(0, {"name": s.get("name", "purstream"), "url": url})

    return sources


async def download_movie(tmdb_id, title, lang_filter, output_file):
    sources = get_movie_sources(tmdb_id)
    lang_upper = lang_filter.upper()
    preferred = [s for s in sources if lang_upper in s["name"].upper()]
    ordered   = preferred + [s for s in sources if s not in preferred]

    for source in ordered:
        step(f"Tentative : {source['name']}...")
        url = source["url"]
        if ".m3u8" in url:
            run_ffmpeg(url, {}, output_file)
            if os.path.exists(output_file) and os.path.getsize(output_file) > 0:
                return
        else:
            success = await download_from_embed(url, output_file)
            if success:
                return

    movix_url = f"https://movix.college/watch/movie/{tmdb_id}"
    await download_from_embed(movix_url, output_file)


async def download_episode(tmdb_id, season, episode, lang_filter, output_file):
    step(f"Tentative purstream ({lang_filter})...")
    purstream_url = get_purstream_url(
        tmdb_id, season, episode,
        lang="vf" if lang_filter == "VF" else "vostfr"
    )

    if purstream_url:
        if ".m3u8" in purstream_url:
            run_ffmpeg(purstream_url, {}, output_file)
            if os.path.exists(output_file) and os.path.getsize(output_file) > 0:
                return
        else:
            success = await download_from_embed(purstream_url, output_file)
            if success:
                return

    sources = get_sources(tmdb_id, season, episode)
    for source in sources:
        step(f"Tentative : {source['name']}...")
        url = source["url"]
        if ".m3u8" in url:
            run_ffmpeg(url, {}, output_file)
            if os.path.exists(output_file) and os.path.getsize(output_file) > 0:
                return
        else:
            success = await download_from_embed(url, output_file)
            if success:
                return

    movix_url = f"https://movix.college/watch/tv/{tmdb_id}/s/{season}/e/{episode}"
    await download_from_embed(movix_url, output_file)

# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    print()
    print(c("  +==================================================+", CY))
    print(c("  |  movix.college -- Films & Series Downloader        |", B, CY))
    print(c("  |  Films  → /media/films                           |", DIM))
    print(c("  |  Series → /media/series                          |", DIM))
    print(c("  +==================================================+", CY))
    print()

    while True:
        print()
        query = prompt(c("  Rechercher (film ou serie, 0=quitter) : ", B))
        if query == RETOUR:
            break

        results = search_tmdb(query)
        if not results:
            warn("Aucun resultat TMDB.")
            continue

        print()
        media = choose_one(
            results,
            lambda s: f"{s['label']} {s['title']} ({s['year']})  [ID: {s['id']}]",
            "Choisir"
        )
        if media == RETOUR:
            continue

        print()
        print(c("  Langue :", B))
        print(f"  {c('1', B, CY)}. VF")
        print(f"  {c('2', B, CY)}. VOSTFR")
        lc = prompt("  Choix (1/2) : ")
        lang = "VOSTFR" if lc == "2" else "VF"

        if media["type"] == "movie":
            film_folder = os.path.join(FILMS_DIR, lang)
            os.makedirs(film_folder, exist_ok=True)
            filename = f"{slugify(media['title'])}_{media['year']}.mp4"
            output   = os.path.join(film_folder, filename)

            sep()
            dl(f"Film    : {media['title']} ({media['year']})")
            dl(f"Langue  : {c(lang, MG)}")
            dl(f"Dossier : {film_folder}")
            sep()

            if os.path.exists(output):
                warn(f"Deja telecharge : {filename}")
            else:
                await download_movie(media["id"], media["title"], lang, output)

        else:
            step(f"Chargement des saisons de '{media['title']}'...")
            seasons = get_seasons(media["id"])
            if not seasons:
                warn("Aucune saison trouvee.")
                continue

            print()
            season = choose_one(
                seasons,
                lambda s: f"{s['name']} ({s['count']} episodes)",
                "Choisir la saison"
            )
            if season == RETOUR:
                continue

            print()
            step("Chargement des episodes...")
            episodes = get_episodes(media["id"], season["num"])
            if not episodes:
                warn("Aucun episode trouve.")
                continue

            print()
            chosen = choose_many(episodes, lambda e: e["title"])
            if not chosen:
                continue

            serie_folder = os.path.join(
                SERIES_DIR,
                slugify(media["title"]),
                lang,
                slugify(season["name"])
            )
            os.makedirs(serie_folder, exist_ok=True)

            for ep in chosen:
                print()
                sep()
                dl(f"Serie   : {media['title']}")
                dl(f"Saison  : {season['name']}")
                dl(f"Episode : {ep['title']}")
                dl(f"Langue  : {c(lang, MG)}")
                sep()

                filename = f"{slugify(ep['title'])}.mp4"
                output   = os.path.join(serie_folder, filename)

                if os.path.exists(output):
                    warn(f"Deja telecharge : {filename}")
                    continue

                await download_episode(
                    tmdb_id=media["id"],
                    season=season["num"],
                    episode=ep["num"],
                    lang_filter=lang,
                    output_file=output,
                )

            print()
            ok(f"Fichiers dans : {serie_folder}")

        again = prompt(c("\n  Telecharger autre chose ? (o / 0=quitter) : ", B)).lower()
        if again not in ("o", "oui", "y", "yes"):
            break

    print()
    ok("Au revoir !")


# ── Mode Nexus (--json) ───────────────────────────────────────────────────────
# Everything below is only used with --json; the menus above are unchanged.

TMDB_IMG = "https://image.tmdb.org/t/p/w342"


def _tmdb(path, **params):
    if not TMDB_KEY:
        nexus_cli.fail("Clé TMDB absente (TMDB_API_KEY)")
    return get_json(f"{TMDB_BASE}{path}", params={"api_key": TMDB_KEY, "language": "fr-FR", **params})


def _year(r):
    y = (r.get("first_air_date") or r.get("release_date") or "")[:4]
    return int(y) if y.isdigit() else None


def _short(text, n=280):
    text = (text or "").strip()
    return text if len(text) <= n else text[: n - 1].rsplit(" ", 1)[0] + "…"


def json_search(query, limit):
    data = _tmdb("/search/multi", query=query)
    results = [r for r in (data or {}).get("results", []) if r.get("media_type") in ("tv", "movie")][: (limit or 12)]

    def one(r):
        kind = "serie" if r["media_type"] == "tv" else "film"
        res = {
            "id": f"movix:{r['media_type']}:{r['id']}", "source": "movix", "kind": kind,
            "title": r.get("name") or r.get("title") or "?", "original_title": r.get("original_name") or r.get("original_title"),
            "year": _year(r), "poster_url": TMDB_IMG + r["poster_path"] if r.get("poster_path") else None,
            "description": _short(r.get("overview")), "langs": ["VF", "VOSTFR"],
        }
        if kind == "serie":
            res["seasons"] = [{"id": s["num"], "label": s["name"], "episodes_count": s["count"]} for s in get_seasons(r["id"])]
        return res

    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=6) as pool:
        for res in pool.map(one, results):
            nexus_cli.emit("result", **res)


def _parse_id(id_):
    m = re.fullmatch(r"movix:(tv|movie):(\d{1,10})", id_ or "")
    if not m:
        nexus_cli.fail(f"Identifiant invalide : {id_}")
    return m.group(1), int(m.group(2))


def _media(kind, tmdb_id):
    d = _tmdb(f"/{kind}/{tmdb_id}")
    if not d:
        nexus_cli.fail("Titre introuvable sur TMDB")
    return {"title": d.get("name") or d.get("title") or "?", "year": _year(d),
            "poster_url": TMDB_IMG + d["poster_path"] if d.get("poster_path") else None,
            "description": _short(d.get("overview"))}


def _movie_file(title, year, lang):
    # Same name as the menu: /media/films/VF/Titre_2020.mp4
    return os.path.join(FILMS_DIR, lang, f"{slugify(title)}_{year or ''}.mp4")


def _episode_file(title, lang, season_num, ep):
    return os.path.join(SERIES_DIR, slugify(title), lang, slugify(f"Saison {season_num}"), f"{slugify(ep['title'])}.mp4")


def json_details(id_):
    kind, tmdb_id = _parse_id(id_)
    m = _media(kind, tmdb_id)
    if kind == "movie":
        nexus_cli.emit("details", id=id_, kind="film", **m, langs=[
            {"lang": l, "downloaded": os.path.exists(_movie_file(m["title"], m["year"], l))} for l in ("VF", "VOSTFR")])
        return
    seasons = get_seasons(tmdb_id)
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=6) as pool:
        eps = list(pool.map(lambda s: get_episodes(tmdb_id, s["num"]), seasons))
    nexus_cli.emit("details", id=id_, kind="serie", **m, langs=["VF", "VOSTFR"], seasons=[
        {"id": s["num"], "label": s["name"], "episodes": [
            {"n": e["num"], "label": e["title"], "air_date": e.get("air_date") or None, "available": _aired(e),
             "downloaded": [l for l in ("VF", "VOSTFR") if os.path.exists(_episode_file(m["title"], l, s["num"], e))]}
            for e in ep_list]}
        for s, ep_list in zip(seasons, eps)])


def _aired(ep):
    """TMDB lists announced episodes (« Épisode 3 », date to come): movix has nothing for them yet."""
    date = ep.get("air_date") or ""
    if date:
        return date <= time.strftime("%Y-%m-%d")
    return not re.fullmatch(r"E\d+ - [ÉE]pisode \d+", ep.get("title", ""))


def _movix_missing(path, params=None):
    """True when movix answers 404 « not found » (nothing hosted), not on network errors."""
    try:
        return SESSION.get(f"{MOVIX_API}{path}", params=params, timeout=15).status_code == 404
    except requests.RequestException:
        return False


def _episode_missing(tmdb_id, season, episode):
    p = {"season": season, "episode": episode}
    return _movix_missing(f"/links/tv/{tmdb_id}", p) and _movix_missing(f"/purstream/tv/{tmdb_id}/stream", p)


_CURRENT_ITEM = {"name": ""}


def _ffmpeg_json(m3u8_url, headers, output_file):
    """Replaces run_ffmpeg() in --json mode: same command, with progress."""
    ua = headers.get("user-agent", UA)
    ref = headers.get("referer", "")
    hdr = f"User-Agent: {ua}\r\n" + (f"Referer: {ref}\r\n" if ref else "")
    if not nexus_cli.ffmpeg_download(m3u8_url, output_file, _CURRENT_ITEM["name"], hdr):
        # A failed source must not leave a half file that would look finished
        try:
            os.remove(output_file)
        except OSError:
            pass


async def _download_one(item, final, coro_factory):
    if os.path.exists(final):
        nexus_cli.emit("item_skipped", name=item, reason="exists", path=final)
        return "skipped"
    os.makedirs(os.path.dirname(final), exist_ok=True)
    part = str(nexus_cli.part_path(final))
    _CURRENT_ITEM["name"] = item
    try:
        await coro_factory(part)
    except Exception as e:
        print(f"{item}: {e}")
    if nexus_cli.finish(part, final):
        nexus_cli.emit("item_done", name=item, path=final)
        return "ok"
    nexus_cli.emit("error", message="Aucune source n'a fonctionné", item=item, fatal=False)
    return "failed"


async def json_download(args):
    global FILMS_DIR, SERIES_DIR, run_ffmpeg
    run_ffmpeg = _ffmpeg_json   # used by download_movie / download_episode / download_from_embed
    kind, tmdb_id = _parse_id(args.download)
    lang = (args.lang or "VF").upper()
    if lang not in ("VF", "VOSTFR"):
        nexus_cli.fail("Langue invalide (VF ou VOSTFR)")
    m = _media(kind, tmdb_id)
    stats = {"ok": 0, "failed": 0, "skipped": 0}
    if kind == "movie":
        if args.dest:
            FILMS_DIR = args.dest
        item = f"{m['title']} ({m['year']})" if m["year"] else m["title"]
        nexus_cli.emit("item_start", name=item, index=1, total=1)
        stats[await _download_one(item, _movie_file(m["title"], m["year"], lang),
                                  lambda part: download_movie(tmdb_id, m["title"], lang, part))] += 1
    else:
        if args.dest:
            SERIES_DIR = args.dest
        try:
            season_num = int(args.season or 1)
        except ValueError:
            nexus_cli.fail("Saison invalide")
        episodes = get_episodes(tmdb_id, season_num)
        if not episodes:
            nexus_cli.fail("Aucun épisode trouvé pour cette saison")
        by_num = {e["num"]: e for e in episodes}
        wanted = nexus_cli.parse_selection(args.episodes, list(by_num))
        for i, n in enumerate(wanted, 1):
            ep = by_num[n]
            item = f"S{season_num:02d}E{n:02d}"
            final = _episode_file(m["title"], lang, season_num, ep)
            if not os.path.exists(final):
                nexus_cli.emit("item_start", name=item, index=i, total=len(wanted))
                if _episode_missing(tmdb_id, season_num, n):
                    # No need to wait 60 s for the web player: movix has no link at all
                    when = f" (sortie le {ep['air_date']})" if ep.get("air_date") and not _aired(ep) else ""
                    nexus_cli.emit("error", message=f"Épisode pas encore disponible sur movix{when}", item=item, fatal=False)
                    stats["failed"] += 1
                    continue
            stats[await _download_one(item, final, lambda part, ep=ep: download_episode(
                tmdb_id=tmdb_id, season=season_num, episode=ep["num"], lang_filter=lang, output_file=part))] += 1
    nexus_cli.emit("done", **stats)
    return 0 if stats["failed"] == 0 else 2


def json_main():
    args = nexus_cli.parser("movix.py — mode Nexus").parse_args()
    try:
        if args.search is not None:
            json_search(args.search, args.limit)
            nexus_cli.emit("done")
        elif args.details:
            json_details(args.details)
            nexus_cli.emit("done")
        else:
            sys.exit(asyncio.run(json_download(args)))
    except ValueError as e:
        nexus_cli.fail(str(e))


if __name__ == "__main__" and JSON_MODE:
    json_main()
elif __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\nAu revoir !")
    except Exception as e:
        print()
        print("\033[91m  X  Erreur fatale :\033[0m", e)
        import traceback
        traceback.print_exc()
