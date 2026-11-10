#!/usr/bin/env python3
"""
films.py — Scraper + téléchargeur pour dromoy (et sites similaires)
Télécharge dans /media/films
"""

import asyncio
import subprocess
import os
import re
import sys
import time
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
from playwright.async_api import async_playwright

# Nexus: --json mode (no menu, JSON Lines on stdout)
import nexus_cli
JSON_MODE = nexus_cli.early_json()

# ── Couleurs ANSI ─────────────────────────────────────────────────────────────
R   = "\033[0m"
B   = "\033[1m"
DIM = "\033[2m"
CY  = "\033[96m"
GR  = "\033[92m"
YE  = "\033[93m"
RE  = "\033[91m"
BL  = "\033[94m"

def c(text, *styles):  return "".join(styles) + str(text) + R
def sep():             return c("─" * 54, DIM)
def ok(text):          print(c("  ✅ " + text, GR))
def err(text):         print(c("  ✗  " + text, RE))
def warn(text):        print(c("  ⚠  " + text, YE))
def info(text):        print(c("  •  " + text, BL))
def dl(text):          print(c("  ⬇  " + text, CY))
def step(text):        print(c("  →  " + text, DIM))

RETOUR = "__RETOUR__"
def prompt(msg):
    try:
        val = input(msg).strip()
        if val.lower() in ("r", "0", "retour", "back"):
            return RETOUR
        return val
    except (KeyboardInterrupt, EOFError):
        return RETOUR

def choose_one(items, label_fn, prompt_txt="Choix"):
    if not items:
        print("  Aucun résultat.")
        return RETOUR
    print(c("   0. ← Retour", DIM))
    for i, item in enumerate(items, 1):
        print(f"  {c(str(i).rjust(3), B, CY)}. {label_fn(item)}")
    while True:
        val = prompt(f"\n{prompt_txt} (0=retour, 1-{len(items)}): ")
        if val == RETOUR:
            return RETOUR
        try:
            idx = int(val)
            if 1 <= idx <= len(items):
                return items[idx - 1]
        except ValueError:
            pass
        print(f"  Entrez un nombre entre 0 et {len(items)}.")

# ── Dossiers serveur ──────────────────────────────────────────────────────────
FILMS_DIR = "/media/films"
os.makedirs(FILMS_DIR, exist_ok=True)

# ── Session HTTP ──────────────────────────────────────────────────────────────
SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/123.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
})

def _decode_body(raw, encodings):
    """Bytes of a page whose Content-Encoding could not be undone as announced (Nexus): each
    known compression is tried, the bytes as they are last."""
    import gzip
    import zlib
    tries = [gzip.decompress, zlib.decompress, lambda b: zlib.decompress(b, -zlib.MAX_WBITS)]
    try:
        import brotli
        tries.append(brotli.decompress)
    except ImportError:
        pass
    try:
        import zstandard
        tries.append(lambda b: zstandard.ZstdDecompressor().decompressobj().decompress(b))
    except ImportError:
        pass
    for decode in tries:
        try:
            return decode(raw)
        except Exception:
            continue
    return raw


def _request(method, url, data=None):
    """One request. Some sites announce a compression their page is not in (« Content-Encoding:
    gzip » on plain HTML, a double encoding…): requests then fails with ContentDecodingError.
    The page is asked again without compression, and decoded by hand if it still comes labelled
    wrongly (Nexus)."""
    send = SESSION.post if method == "POST" else SESSION.get
    try:
        return send(url, data=data, timeout=20) if method == "POST" else send(url, timeout=20)
    except requests.exceptions.ContentDecodingError:
        pass
    plain = {"Accept-Encoding": "identity"}
    kwargs = {"data": data} if method == "POST" else {}
    try:
        return send(url, timeout=20, headers=plain, **kwargs)
    except requests.exceptions.ContentDecodingError:
        pass
    r = send(url, timeout=20, headers=plain, stream=True, **kwargs)
    raw = r.raw.read(decode_content=False)
    r._content = _decode_body(raw, r.headers.get("Content-Encoding", ""))
    r._content_consumed = True
    r.headers.pop("Content-Encoding", None)
    return r


def get_page(url, method="GET", data=None):
    for attempt in range(3):
        try:
            r = _request(method, url, data)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r
        except requests.RequestException:
            if attempt == 2:
                return None
            time.sleep(1.5)

def slugify(text):
    text = re.sub(r'[<>:"/\\|?*]', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text.replace(' ', '_') or "video"

def fix_url(url):
    url = url.strip()
    if not url.startswith("http"):
        url = "https://" + url
    return url.rstrip("/")


# ── Détection automatique de la structure du site ────────────────────────────

def detect_site_config(base_url):
    step("Analyse de la structure du site...")
    r = get_page(base_url)
    if not r:
        return None
    soup = BeautifulSoup(r.text, "html.parser")
    SESSION.headers["Referer"] = base_url

    config = {
        "base_url": base_url,
        "search_url": None,
        "search_field": "searchword",
        "categories": [],
        "film_pattern": None,
        "cat_pattern": None,
    }

    for form in soup.find_all("form"):
        for inp in form.find_all("input", {"type": "text"}):
            name = inp.get("name", "")
            if name:
                action = form.get("action", "")
                config["search_url"] = urljoin(base_url, action) if action else base_url
                config["search_field"] = name
                info(f"Recherche → POST {config['search_url']} [{name}]")
                break
        if config["search_url"]:
            break

    if not config["search_url"]:
        config["search_url"] = base_url

    domain = urlparse(base_url).netloc
    for a in soup.select("nav a, header a, .menu a, .navbar a"):
        href = a.get("href", "")
        text = a.get_text(strip=True)
        if not href or not text:
            continue
        full = urljoin(base_url, href)
        if domain not in full:
            continue
        skip = ["home", "accueil", "login", "register", "contact", "javascript"]
        if any(kw in href.lower() for kw in skip):
            continue
        if full != base_url:
            config["categories"].append({"name": text, "url": full})

    info(f"{len(config['categories'])} catégorie(s) détectée(s)")

    for a in soup.find_all("a", href=True):
        href = a["href"]
        m = re.match(r"(/[^/]+)/b/[^/]+/(\d+)", href)
        if m:
            prefix = m.group(1)
            config["film_pattern"] = prefix + "/b/"
            break

    return config


def parse_films_from_page(soup, base_url):
    films = {}
    selectors = [
        "a.trend-card",
        "a.film-card",
        "a[class*='card']",
        "a[href*='/b/']",
    ]

    for sel in selectors:
        for a in soup.select(sel):
            href = a.get("href", "")
            if not href:
                continue
            url = urljoin(base_url, href)
            if url in films:
                continue

            title = ""
            img = a.find("img")
            if img:
                title = img.get("alt", "").strip()
            if not title:
                for cls in ["trend-card-title", "film-card-title", "card-title", "title"]:
                    el = a.find(class_=cls)
                    if el:
                        title = el.get_text(strip=True)
                        break
            if not title:
                title = a.get_text(separator=" ", strip=True)[:60]
            if not title:
                title = href.rstrip("/").split("/")[-1].replace("-", " ").title()

            if title and url:
                films[url] = {"title": title, "url": url}

    return list(films.values())


def scrape_category(cat_url, base_url, cat_name):
    all_films = {}
    offset_step = None

    r = get_page(cat_url)
    if not r:
        return []
    soup = BeautifulSoup(r.text, "html.parser")
    films = parse_films_from_page(soup, base_url)
    for f in films:
        all_films[f["url"]] = f
    count_first = len(films)

    if count_first == 0:
        return []

    next_links = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        m = re.search(r"/(\d+)/?$", href)
        if m and int(m.group(1)) > 0:
            next_links.append(("offset", int(m.group(1)), urljoin(base_url, href)))
        m2 = re.search(r"[?&]page=(\d+)", href)
        if m2:
            next_links.append(("param", int(m2.group(1)), urljoin(base_url, href)))

    if next_links:
        offsets = sorted(set(n[1] for n in next_links if n[0] == "offset"))
        if offsets:
            offset_step = offsets[0]
    else:
        offset_step = count_first

    if offset_step:
        offset = offset_step
        max_empty = 2
        empty_count = 0

        while True:
            next_url = re.sub(r"/\d+/?$", f"/{offset}", cat_url)
            if next_url == cat_url:
                next_url = cat_url.rstrip("/") + f"/{offset}"

            r = get_page(next_url)
            if not r:
                empty_count += 1
                if empty_count >= max_empty:
                    break
                offset += offset_step
                continue

            soup = BeautifulSoup(r.text, "html.parser")
            new_films = parse_films_from_page(soup, base_url)

            if not new_films:
                empty_count += 1
                if empty_count >= max_empty:
                    break
            else:
                empty_count = 0
                added = 0
                for f in new_films:
                    if f["url"] not in all_films:
                        all_films[f["url"]] = f
                        added += 1
                if added == 0:
                    break

            offset += offset_step

    return list(all_films.values())


def build_catalogue(config):
    print()
    step("Construction du catalogue complet...")
    all_films = {}
    categories = config["categories"]
    base_url   = config["base_url"]

    if not categories:
        r = get_page(base_url)
        if r:
            films = parse_films_from_page(BeautifulSoup(r.text, "html.parser"), base_url)
            for f in films:
                all_films[f["url"]] = f
    else:
        for i, cat in enumerate(categories, 1):
            print(f"  {c(cat['name'], CY)}  ({i}/{len(categories)})...", end=" ", flush=True)
            films = scrape_category(cat["url"], base_url, cat["name"])
            added = 0
            for f in films:
                if f["url"] not in all_films:
                    all_films[f["url"]] = f
                    added += 1
            print(c(f"+{added} films  (total: {len(all_films)})", DIM))

    result = sorted(all_films.values(), key=lambda x: x["title"].lower())
    ok(f"{len(result)} films au total dans le catalogue")
    return result


def search_online(config, query):
    all_results = {}
    base_url = config["base_url"]

    r = get_page(config["search_url"], method="POST", data={config["search_field"]: query})
    if not r:
        return []
    soup = BeautifulSoup(r.text, "html.parser")
    for f in parse_films_from_page(soup, base_url):
        all_results[f["url"]] = f

    offset_step = len(all_results) if all_results else 20
    max_empty = 2
    empty_count = 0
    offset = offset_step

    while True:
        search_url_paged = re.sub(r"/\d+/?$", f"/{offset}", config["search_url"])
        if search_url_paged == config["search_url"]:
            search_url_paged = config["search_url"].rstrip("/") + f"/{offset}"

        r = get_page(search_url_paged, method="POST", data={config["search_field"]: query})
        if not r:
            empty_count += 1
            if empty_count >= max_empty:
                break
            offset += offset_step
            continue

        soup = BeautifulSoup(r.text, "html.parser")
        new_films = parse_films_from_page(soup, base_url)

        if not new_films:
            empty_count += 1
            if empty_count >= max_empty:
                break
        else:
            added = 0
            for f in new_films:
                if f["url"] not in all_results:
                    all_results[f["url"]] = f
                    added += 1
            if added == 0:
                break
            empty_count = 0

        offset += offset_step

    return list(all_results.values())


def search_local(catalogue, query):
    q = query.lower()
    return [f for f in catalogue if q in f["title"].lower()]


# ── Téléchargement ────────────────────────────────────────────────────────────

def run_ffmpeg(m3u8_url, m3u8_headers, cookies, referer, output_file):
    ua  = m3u8_headers.get("user-agent",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
    ref = m3u8_headers.get("referer", referer)
    hdr = f"User-Agent: {ua}\r\nReferer: {ref}\r\n"
    if cookies:
        hdr += f"Cookie: {cookies}\r\n"
    step("Conversion ffmpeg...")
    result = subprocess.run([
        "ffmpeg", "-headers", hdr,
        "-i", m3u8_url, "-c", "copy", output_file
    ])
    if result.returncode == 0:
        ok(f"Sauvegardé : {output_file}")
    else:
        err("ffmpeg a rencontré une erreur.")


async def playwright_download(url, titre):
    m3u8_url     = None
    m3u8_headers = {}
    page_title   = ""

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,  # headless sur serveur
            args=["--disable-blink-features=AutomationControlled"]
        )
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/123.0.0.0 Safari/537.36"
            ),
            locale="fr-FR",
        )
        page = await context.new_page()

        async def intercept(request):
            nonlocal m3u8_url, m3u8_headers
            if ".m3u8" in request.url and m3u8_url is None:
                m3u8_url     = request.url
                m3u8_headers = dict(request.headers)
                ok("m3u8 intercepté !")

        page.on("request", intercept)

        step(f"Ouverture : {url}")
        await page.goto(url, wait_until="domcontentloaded")
        step("Attente du flux m3u8 (max 60 secondes)...")

        for _ in range(60):
            if m3u8_url:
                break
            await page.wait_for_timeout(1000)

        page_title = await page.title()
        cookies    = await context.cookies()
        cookie_str = "; ".join([f"{c['name']}={c['value']}" for c in cookies])
        await browser.close()

    if m3u8_url:
        nom = slugify(page_title) if page_title.strip() else slugify(titre)
        output_file = os.path.join(FILMS_DIR, f"{nom}.mp4")
        dl(f"Sauvegarde : {output_file}")
        print(sep())
        run_ffmpeg(m3u8_url, m3u8_headers, cookie_str, url, output_file)
    else:
        err("Aucun flux m3u8 trouvé après 60 secondes.")


# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    print()
    print(c("  ╔══════════════════════════════════════════════════╗", CY))
    print(c("  ║  🎬  FILMS DOWNLOADER  →  /media/films", B, CY))
    print(c("  ╚══════════════════════════════════════════════════╝", CY))
    print()

    BASE_URL = "https://tiprov.com/fc3e940/home/tiprov"

    print(f"  {c('[1]', B, CY)} Rechercher un film sur le site")
    print(f"  {c('[2]', B, CY)} Télécharger avec un lien direct")
    print(f"  {c('[0]', B, DIM)} Quitter")
    print()

    mode = prompt(c("  Choix (1/2/0) : ", B))
    if mode == RETOUR:
        return

    if mode == "2":
        while True:
            print()
            url = prompt(c("  Lien du film (0=quitter) : ", B))
            if url == RETOUR:
                break
            url = fix_url(url)
            print(sep())
            await playwright_download(url, url.rstrip("/").split("/")[-1])
            print()
            val = prompt(c("  Télécharger un autre ? (o/0=quitter) : ", B)).lower()
            if val in ("n", "non", "0", RETOUR):
                break
        print()
        ok("Au revoir !")
        return

    config = detect_site_config(BASE_URL)
    if not config:
        err("Impossible d'accéder au site.")
        return

    catalogue = build_catalogue(config)
    if not catalogue:
        err("Catalogue vide, impossible de continuer.")
        return

    while True:
        print()
        query = prompt(c("  Rechercher un film (0=quitter) : ", B))
        if query == RETOUR:
            break

        local_results = search_local(catalogue, query)
        step("Recherche en ligne...")
        online_results = search_online(config, query)

        seen_urls = set()
        results = []
        for f in online_results + local_results:
            if f["url"] not in seen_urls:
                seen_urls.add(f["url"])
                results.append(f)

        if not results:
            warn("Aucun résultat trouvé.")
            continue

        print()
        film = choose_one(results, lambda x: x["title"], "Choisir le film")
        if film == RETOUR:
            continue

        print()
        dl(f"Film  : {film['title']}")
        dl(f"URL   : {film['url']}")
        print(sep())

        await playwright_download(film["url"], film["title"])

        print()
        val = prompt(c("  Télécharger un autre film ? (o/0=quitter) : ", B)).lower()
        if val in ("n", "non", "0", RETOUR):
            break

    print()
    ok("Au revoir !")


# ── Mode Nexus (--json) ───────────────────────────────────────────────────────
# Everything below is only used with --json; the menus above are unchanged.

import base64
import json

FILMS_BASE_URL = "https://tiprov.com/fc3e940/home/tiprov"   # same site as main()
TMDB_IMG = "https://image.tmdb.org/t/p/w342"
_parse_films_original = parse_films_from_page


def _parse_films_with_posters(soup, base_url):
    """parse_films_from_page() + the card image (poster) of each film."""
    films = _parse_films_original(soup, base_url)
    posters = {}
    for a in soup.find_all("a", href=True):
        img = a.find("img")
        if not img:
            continue
        src = img.get("data-src") or img.get("data-lazy-src") or img.get("src") or ""
        if src and not src.startswith("data:"):
            posters.setdefault(urljoin(base_url, a["href"]), urljoin(base_url, src))
    for f in films:
        f["poster"] = posters.get(f["url"])
    return films


def _encode_id(url):
    return "films:" + base64.urlsafe_b64encode(url.encode()).decode().rstrip("=")


def _decode_id(id_):
    m = re.fullmatch(r"films:([A-Za-z0-9_-]{4,2000})", id_ or "")
    if not m:
        nexus_cli.fail(f"Identifiant invalide : {id_}")
    raw = m.group(1)
    try:
        url = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode()
    except Exception:
        nexus_cli.fail("Identifiant invalide")
    if not re.match(r"https?://[^\s/]+/", url):
        nexus_cli.fail("Adresse invalide")
    return url


def _split_year(title):
    m = re.search(r"[\(\[ ]((?:19|20)\d{2})[\)\] ]?\s*$", title)
    if m:
        return title[: m.start()].strip(" -–(["), int(m.group(1))
    return title.strip(), None


def _tmdb_poster(title, year):
    key = nexus_cli.env_value("TMDB_API_KEY")
    if not key:
        return None, None
    try:
        params = {"api_key": key, "query": title, "language": "fr-FR"}
        if year:
            params["year"] = year
        r = SESSION.get("https://api.themoviedb.org/3/search/movie", params=params, timeout=10).json()
        hit = (r.get("results") or [None])[0]
        if hit and hit.get("poster_path"):
            return TMDB_IMG + hit["poster_path"], (hit.get("overview") or None)
    except Exception:
        pass
    return None, None


def _why_unreachable(url):
    """Why the films site does not answer, in plain French (Nexus): one plain request, its outcome."""
    host = urlparse(url).hostname or url
    try:
        r = _request("GET", url)
    except requests.exceptions.SSLError:
        return f"certificat HTTPS refusé pour {host}"
    except requests.exceptions.ConnectionError as e:
        text = str(e).lower()
        if any(k in text for k in ("name or service not known", "nodename nor servname", "getaddrinfo", "name resolution", "no address")):
            return f"adresse {host} introuvable (le nom de domaine ne répond pas depuis le serveur)"
        if "refused" in text:
            return f"connexion refusée par {host}"
        return f"{host} injoignable depuis le serveur"
    except requests.exceptions.Timeout:
        return f"{host} ne répond pas (délai dépassé)"
    except requests.RequestException as e:
        return f"erreur réseau ({type(e).__name__})"
    final = urlparse(r.url).hostname or host
    moved = f" (redirigé vers {final})" if final != host else ""
    body = (r.text or "")[:4000].lower()
    cloudflare = "cloudflare" in r.headers.get("server", "").lower() or "cf-ray" in r.headers
    protected = cloudflare and (
        r.status_code in (403, 429, 503) or "just a moment" in body or "challenge" in body)
    if protected:
        return f"{final} bloque les robots (protection Cloudflare, HTTP {r.status_code}){moved}"
    if r.status_code == 404:
        return f"page introuvable (HTTP 404) à cette adresse{moved} : le lien a peut-être changé"
    if r.status_code >= 400:
        return f"le site répond HTTP {r.status_code}{moved}"
    return f"le site répond, mais sa page n'a pas pu être lue{moved}"


def json_search(query, limit):
    global parse_films_from_page
    parse_films_from_page = _parse_films_with_posters
    config = detect_site_config(FILMS_BASE_URL)
    if not config:
        nexus_cli.fail(f"Site de films inaccessible : {_why_unreachable(FILMS_BASE_URL)}")
    films = search_online(config, query)
    q = query.lower()
    films.sort(key=lambda f: (q not in f["title"].lower(), f["title"].lower()))
    films = films[: (limit or 24)]

    def one(f):
        title, year = _split_year(f["title"])
        poster, desc = f.get("poster"), None
        if not poster:
            poster, desc = _tmdb_poster(title, year)
        return {"id": _encode_id(f["url"]), "source": "films", "kind": "film", "title": title,
                "year": year, "poster_url": poster, "description": desc}

    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=6) as pool:
        for res in pool.map(one, films):
            nexus_cli.emit("result", **res)


_RESULT = {"status": None, "item": ""}


def _ffmpeg_json(m3u8_url, m3u8_headers, cookies, referer, output_file):
    """Replaces run_ffmpeg() in --json mode: same command, temporary name, progress."""
    item = _RESULT["item"]
    if os.path.exists(output_file):
        nexus_cli.emit("item_skipped", name=item, reason="exists", path=output_file)
        _RESULT["status"] = "skipped"
        return
    ua = m3u8_headers.get("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
    ref = m3u8_headers.get("referer", referer)
    hdr = f"User-Agent: {ua}\r\nReferer: {ref}\r\n" + (f"Cookie: {cookies}\r\n" if cookies else "")
    part = nexus_cli.part_path(output_file)
    # HLS segments several at a time (ffmpeg alone reads them one by one); plain ffmpeg
    # for what that cannot take or when it fails
    http_headers = {"User-Agent": ua, "Referer": ref, **({"Cookie": cookies} if cookies else {})}
    fast = nexus_cli.hls_download(m3u8_url, part, item, http_headers)
    if fast is False:
        print("hls: parallel download failed, plain ffmpeg")
    if (fast or nexus_cli.ffmpeg_download(m3u8_url, part, item, hdr)) and nexus_cli.finish(part, output_file):
        nexus_cli.emit("item_done", name=item, path=output_file)
        _RESULT["status"] = "ok"
    else:
        try:
            os.remove(part)
        except OSError:
            pass


async def json_download(args):
    global FILMS_DIR, run_ffmpeg
    url = _decode_id(args.download)
    if args.dest:
        FILMS_DIR = args.dest
        os.makedirs(FILMS_DIR, exist_ok=True)
    run_ffmpeg = _ffmpeg_json
    name = url.rstrip("/").split("/")[-2] if re.search(r"/\d+/?$", url) else url.rstrip("/").split("/")[-1]
    _RESULT["item"] = name.replace("-", " ").strip() or "Film"
    nexus_cli.emit("item_start", name=_RESULT["item"], index=1, total=1)
    try:
        await playwright_download(url, _RESULT["item"])
    except Exception as e:
        print(f"playwright: {e}")
    status = _RESULT["status"] or "failed"
    if status == "failed":
        nexus_cli.emit("error", message="Aucun flux vidéo trouvé", item=_RESULT["item"], fatal=False)
    nexus_cli.emit("done", ok=int(status == "ok"), failed=int(status == "failed"), skipped=int(status == "skipped"))
    return 0 if status != "failed" else 2


def json_main():
    args = nexus_cli.parser("films.py — mode Nexus").parse_args()
    if args.search is not None:
        json_search(args.search, args.limit)
        nexus_cli.emit("done")
    elif args.details:
        url = _decode_id(args.details)
        nexus_cli.emit("details", id=args.details, kind="film", url=url)
        nexus_cli.emit("done")
    else:
        sys.exit(asyncio.run(json_download(args)))


if __name__ == "__main__" and JSON_MODE:
    json_main()
elif __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\nAu revoir !")
    except Exception as e:
        print()
        print("\033[91m  ✗  Erreur fatale :\033[0m", e)
        import traceback
        traceback.print_exc()
