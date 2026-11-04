#!/usr/bin/env python3
"""
anisama.py — CLI tout-en-un pour anime-sama.to
  • Streaming anime  (VF / VOSTFR) via mpv
  • Téléchargement scans / manhwa / webtoon

Dépendances : pip install requests beautifulsoup4
Optionnel    : mpv, yt-dlp
"""

import re
import sys
import json
import time
import subprocess
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# Nexus: --json mode (no menu, JSON Lines on stdout). Must run before the
# domain lookup below, which prints.
import nexus_cli
JSON_MODE = nexus_cli.early_json()

# ── Couleurs ANSI ────────────────────────────────────────────────────────────
R  = "\033[0m"
B  = "\033[1m"
DIM= "\033[2m"
CY = "\033[96m"
GR = "\033[92m"
YE = "\033[93m"
RE = "\033[91m"
BL = "\033[94m"
MA = "\033[95m"

def c(text, *styles):
    return "".join(styles) + str(text) + R

def sep(char="─", width=54):
    return c(char * width, DIM)

def header(text):
    print()
    print(c("  " + text, B, CY))
    print(sep())

def ok(text):    print(c("  ✅ " + text, GR))
def skip(text):  print(c("  ✓  " + text, DIM))
def err(text):   print(c("  ✗  " + text, RE))
def warn(text):  print(c("  ⚠  " + text, YE))
def info(text):  print(c("  •  " + text, BL))
def dl(text):    print(c("  ⬇  " + text, CY))


import requests
from bs4 import BeautifulSoup

# ── Config ────────────────────────────────────────────────────────────────────

PIVOT_URL    = "https://anime-sama.to"
FALLBACK_URL = "https://anime-sama.tv"

# ── Dossiers serveur ──────────────────────────────────────────────────────────
ANIME_DL_DIR = Path("/media/animes")
DOWNLOAD_DIR = Path("/media/scans")
ANIME_DL_DIR.mkdir(parents=True, exist_ok=True)
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/123.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)


def _domain_works(base: str) -> bool:
    """Nexus copy: the domain announced by the pivot page can be dead (404)."""
    try:
        r = SESSION.get(f"{base}/catalogue/", timeout=10, headers={"Referer": base + "/"})
        return r.status_code < 400
    except Exception:
        return False


def resolve_base_url() -> str:
    try:
        r = SESSION.get(PIVOT_URL, timeout=10)
        soup = BeautifulSoup(r.text, "html.parser")
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if re.match(r"https://anime-sama\.\w+/?$", href):
                base = href.rstrip("/")
                if not _domain_works(base):
                    continue
                print(c(f"  Domaine : {base}", DIM))
                return base
        if _domain_works(PIVOT_URL):
            print(c(f"  Domaine : {PIVOT_URL}", DIM))
            return PIVOT_URL
    except Exception:
        pass
    print(c(f"  Fallback : {FALLBACK_URL}", DIM))
    return FALLBACK_URL


BASE_URL   = resolve_base_url()
CATALOGUE  = f"{BASE_URL}/catalogue"
SEARCH_API = f"{BASE_URL}/template-fonction/fetch/fetch_catalogue.php"
SESSION.headers["Referer"] = BASE_URL

# Nexus copy: the catalogue lives in data/ (not versioned, the script updates
# it), first taken from the original script folder when it exists
CATALOGUE_FILE = Path(__file__).resolve().parent / "data" / "catalogue.json"
if not CATALOGUE_FILE.exists():
    CATALOGUE_FILE.parent.mkdir(parents=True, exist_ok=True)
    _original = Path("/media/scripts/catalogue.json")
    if _original.exists():
        import shutil as _shutil
        _shutil.copyfile(_original, CATALOGUE_FILE)
_catalogue_cache = None

# ── Helpers partagés ──────────────────────────────────────────────────────────

def _own_referer(url, kwargs):
    """Nexus copy: each site expects its own address as Referer (403 otherwise)."""
    m = re.match(r"https?://[^/]+", url)
    if m:
        headers = dict(kwargs.get("headers") or {})
        headers.setdefault("Referer", m.group(0) + "/")
        kwargs["headers"] = headers
    return kwargs


def get(url, silent_404=False, **kwargs):
    kwargs = _own_referer(url, kwargs)
    for attempt in range(3):
        try:
            r = SESSION.get(url, timeout=20, **kwargs)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r
        except requests.RequestException as e:
            if attempt == 2:
                if not silent_404:
                    print(f"\n[ERREUR] {url}\n  → {e}")
                return None
            time.sleep(1.5)


def slugify(text: str) -> str:
    text = re.sub(r'[<>:"/\\|?*]', '', text)
    return re.sub(r'\s+', ' ', text).strip()


def choose_one(items, label_fn, prompt="Choix"):
    if not items:
        print("  Aucun résultat.")
        sys.exit(0)
    for i, item in enumerate(items, 1):
        print(f"  {i:>3}. {label_fn(item)}")
    while True:
        try:
            idx = int(input(f"\n{prompt} (1-{len(items)}): ").strip())
            if 1 <= idx <= len(items):
                return items[idx - 1]
        except (ValueError, KeyboardInterrupt):
            pass
        print(f"  Entrez un nombre entre 1 et {len(items)}.")


def choose_multi(items, label_fn, prompt="Chapitres"):
    if not items:
        print("  Aucun résultat.")
        sys.exit(0)
    for i, item in enumerate(items, 1):
        print(f"  {i:>3}. {label_fn(item)}")
    print(f"\n  Exemples : '1'  '3-7'  '1,4,6'  'all'")
    while True:
        try:
            raw = input(f"{prompt} : ").strip().lower()
            if raw == "all":
                return items
            selected = set()
            for part in raw.split(","):
                part = part.strip()
                if "-" in part:
                    a, b = part.split("-", 1)
                    selected.update(range(int(a) - 1, int(b)))
                else:
                    selected.add(int(part) - 1)
            return [items[i] for i in sorted(selected) if 0 <= i < len(items)]
        except (ValueError, KeyboardInterrupt):
            pass
        print("  Format invalide. Exemples : '1-5', '1,3', 'all'")


# ── Catalogue local ───────────────────────────────────────────────────────────

def _load_catalogue() -> list:
    global _catalogue_cache
    if _catalogue_cache is not None:
        return _catalogue_cache
    if CATALOGUE_FILE.exists():
        try:
            _catalogue_cache = json.loads(CATALOGUE_FILE.read_text(encoding="utf-8"))
            return _catalogue_cache
        except Exception:
            pass
    return []


def build_catalogue(force=False):
    if CATALOGUE_FILE.exists() and not force:
        data = _load_catalogue()
        if data:
            print(c(f"  Catalogue : {len(data)} titres", DIM))
            return data

    CAT_BASE = "https://anime-sama.to"
    CAT_URL  = f"{CAT_BASE}/catalogue"

    r0 = get(CAT_URL)
    if not r0:
        return []
    soup0 = BeautifulSoup(r0.text, "html.parser")

    page_nums = [int(m) for m in re.findall(r"[?&]page=(\d+)", r0.text)]
    max_page  = max(page_nums) if page_nums else 43
    print(f"  Construction du catalogue ({max_page} pages)...")

    results = {}

    def extract_page(soup):
        for a in soup.find_all("a", href=True):
            href = a["href"]
            m = re.search(r"/catalogue/([^/?#]+)/?$", href)
            if not m:
                continue
            slug = m.group(1)
            if slug in results:
                continue
            img = a.find("img")
            if not img:
                continue
            title = img.get("alt", "").strip()
            if not title:
                h2 = a.find("h2")
                title = h2.get_text(strip=True) if h2 else slug.replace("-", " ").title()
            url = (href if href.startswith("http") else CAT_BASE + href).rstrip("/")
            results[slug] = {"title": title, "url": url, "slug": slug}

    extract_page(soup0)

    for page in range(2, max_page + 1):
        pr = get(CAT_URL, params={"page": page})
        if not pr:
            continue
        extract_page(BeautifulSoup(pr.text, "html.parser"))
        print(f"  Page {page}/{max_page}  ({len(results)} total)", end="\r", flush=True)

    data = sorted(results.values(), key=lambda x: x["title"].lower())
    print(f"\n  {len(data)} titres sauvegardes -> {CATALOGUE_FILE.name}")
    CATALOGUE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    global _catalogue_cache
    _catalogue_cache = data
    return data


def _fuzzy_match(query: str, title: str) -> int:
    q = query.lower().strip()
    t = title.lower().strip()
    if q == t:
        return 1000
    if t.startswith(q):
        return 900
    if q in t:
        return 800
    words = [w for w in q.split() if w]
    if not words:
        return 0
    min_len = 2 if len(q) <= 4 else 3
    sig_words = [w for w in words if len(w) > min_len]
    if sig_words and all(w in t for w in sig_words):
        if q.replace(" ", "") in t.replace(" ", ""):
            return 750
        return 600
    if all(w in t for w in words):
        return 400
    if sig_words:
        matches = sum(1 for w in sig_words if w in t)
        ratio = matches / len(sig_words)
        if ratio >= 0.8:
            return int(200 * ratio)
    return 0


def search(query: str) -> list:
    catalogue = _load_catalogue()
    if catalogue:
        scored = []
        for item in catalogue:
            score = _fuzzy_match(query, item["title"])
            if score == 0:
                score = _fuzzy_match(query, item["slug"].replace("-", " "))
            if score > 0:
                scored.append((score, item))
        min_score = 200 if len(query.split()) > 1 else 100
        scored = [(s, i) for s, i in scored if s >= min_score]
        scored.sort(key=lambda x: x[0], reverse=True)
        results = []
        for _, item in scored[:20]:
            url = item["url"]
            url = re.sub(r"https?://[^/]+", BASE_URL, url)
            results.append({"title": item["title"], "url": url})
        return results

    try:
        r = SESSION.get(SEARCH_API, params={"query": query}, timeout=10)
        data = r.json()
        results = []
        for item in data:
            title = item.get("title") or item.get("name") or ""
            url   = item.get("url")  or item.get("link") or ""
            if title and url:
                if not url.startswith("http"):
                    url = BASE_URL + url
                results.append({"title": title, "url": url.rstrip("/")})
        if results:
            return results
    except Exception:
        pass

    r = get(CATALOGUE, params={"search": query})
    if not r:
        return []
    soup = BeautifulSoup(r.text, "html.parser")
    results, seen = [], set()
    for a in soup.select("a[href*='/catalogue/']"):
        href  = a["href"]
        title = a.get("title", "").strip()
        q_norm = query.strip().lower()
        q_words = q_norm.split()
        if re.match(r".*/catalogue/([^/]+)/?$", href) and title:
            if not all(w in title.lower() + href.lower() for w in q_words):
                continue
            url = (href if href.startswith("http") else BASE_URL + href).rstrip("/")
            if url not in seen:
                seen.add(url)
                results.append({"title": title or href, "url": url})
    return results


def get_title_page(anime_url: str):
    r = get(anime_url)
    return BeautifulSoup(r.text, "html.parser") if r else None


# ── Anime streaming ───────────────────────────────────────────────────────────

def _check_url_exists(url: str) -> bool:
    try:
        r = SESSION.head(url, timeout=6, allow_redirects=True, **_own_referer(url, {}))
        return r.status_code < 400
    except Exception:
        return False


def get_seasons(soup, anime_url: str) -> list:
    slug_match = re.search(r"/catalogue/([^/]+)/?$", anime_url.rstrip("/"))
    if not slug_match:
        return []
    slug = slug_match.group(1)
    season_domain = "https://anime-sama.to"
    base = f"{season_domain}/catalogue/{slug}"

    segments = (
        [f"saison{i}" for i in range(1, 25)] +
        ["film"] +
        [f"film{i}" for i in range(1, 10)] +
        ["oav", "oav1", "oav2", "speciaux", "special", "specials"]
    )
    langs = ["vostfr", "vf"]

    candidates = [
        {"label": f"{seg.capitalize()} — {lang.upper()}",
         "url":   f"{base}/{seg}/{lang}/"}
        for seg in segments for lang in langs
    ]

    print(f"  Sondage de {len(candidates)} URLs possibles...", end="\r")

    valid = []
    with ThreadPoolExecutor(max_workers=16) as pool:
        futs = {pool.submit(_check_url_exists, c["url"]): c for c in candidates}
        for fut in as_completed(futs):
            if fut.result():
                valid.append(futs[fut])

    valid.sort(key=lambda s: s["url"])
    print(f"  {len(valid)} saison(s) trouvee(s).               ")
    return valid


EMBED_DOMAINS = (
    "sibnet", "sendvid", "vidmoly", "myvi", "dailymotion",
    "okru", "ok.ru", "vk.com", "streamtape", "yourupload",
    "vidbam", "vidoza", "voe.sx", "upstream", "doodstream",
    "filemoon", "vidplay", "mp4upload",
    "ansembed", "embed4me", "smoothpre", "movearnpre",
)

def _is_embed_url(url: str) -> bool:
    url = url.lower()
    if not url.startswith("http"):
        return False
    if len(url) < 20:
        return False
    if re.match(r"https?://[^/]+/?$", url):
        return False
    if any(d in url for d in EMBED_DOMAINS):
        return True
    if re.search(r"/(embed|player|watch|video|stream)[/-]", url):
        return True
    return False


def _parse_episodes_js(js_text: str) -> list:
    import ast as _ast
    candidates = []
    for m in re.finditer(r'var\s+(\w+)\s*=\s*(\[.*?\])\s*;', js_text, re.DOTALL):
        var_name = m.group(1).lower()
        if not re.search(r'eps|episode|lecteur|lect\d', var_name):
            continue
        raw = m.group(2)
        urls = []
        try:
            urls = _ast.literal_eval(raw)
        except Exception:
            pass
        if not urls:
            try:
                urls = json.loads(raw.replace("'", '"'))
            except Exception:
                pass
        if not urls:
            quoted = re.findall(r'["\'](https?://[^"\'\s]+)["\']', raw)
            # Nexus copy: the site sometimes forgets closing quotes ('https://…html,),
            # which hides those links from the regex above — keep the longer list.
            loose = re.findall(r"https?://[^'\"\s\],]+", raw)
            urls = loose if len(loose) > len(quoted) else quoted
        valid = [u.strip() for u in urls if isinstance(u, str) and _is_embed_url(u.strip())]
        if valid:
            candidates.append((var_name, valid))

    PREF_ORDER = ["sibnet", "sendvid", "vk.com", "ok.ru", "dailymotion",
                  "streamtape", "mp4upload", "vidmoly", "filemoon", "ansembed"]

    def lecteur_score(item):
        name, urls = item
        if not urls:
            return -1
        sample = urls[0].lower()
        for i, domain in enumerate(PREF_ORDER):
            if domain in sample:
                return 1000 - i
        return 500 - len(urls)

    if candidates:
        candidates.sort(key=lecteur_score, reverse=True)
        _, best_urls = candidates[0]
        episodes = [{"label": f"Episode {i+1}", "url": u,
                     "alt_urls": [c[1][i] for c in candidates[1:] if i < len(c[1])]}
                    for i, u in enumerate(best_urls)]
        return episodes

    urls = [u for u in re.findall(r'["\'](https?://[^"\'\s]+)["\']', js_text) if _is_embed_url(u)]
    return [{"label": f"Episode {i+1}", "url": u} for i, u in enumerate(urls)]


def get_episodes(season_url: str) -> list:
    season_url = season_url.rstrip("/") + "/"
    path_match = re.search(r"/catalogue/.+", season_url)
    rel_path = path_match.group(0) if path_match else ""

    seen_d, domains = set(), []
    for d in ["https://anime-sama.to", BASE_URL, "https://anime-sama.si",
              "https://anime-sama.fr", "https://anime-sama.tv"]:
        if d not in seen_d:
            seen_d.add(d)
            domains.append(d)

    for domain in domains:
        js_url = domain + rel_path + "episodes.js"
        r = get(js_url, silent_404=True)
        if r and r.status_code == 200 and r.text.strip():
            if len(r.text) > 100_000:
                continue
            if not any(d in r.text for d in EMBED_DOMAINS):
                continue
            episodes = _parse_episodes_js(r.text)
            if episodes:
                return episodes

    r = get(season_url)
    if not r:
        return []
    soup = BeautifulSoup(r.text, "html.parser")
    episodes, seen = [], set()

    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "episode" in href.lower() or re.search(r"[?&]ep=\d+", href):
            if href not in seen:
                seen.add(href)
                url = href if href.startswith("http") else BASE_URL + href
                episodes.append({"label": a.get_text(strip=True) or href, "url": url})

    if not episodes:
        for script in soup.find_all("script"):
            text = script.string or ""
            if "var" in text and ("episode" in text.lower() or "lecteur" in text.lower()):
                eps = _parse_episodes_js(text)
                if eps:
                    return eps

    return episodes


def _resolve_with_playwright(embed_url: str) -> str:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return ""

    found_url = ""
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent=SESSION.headers["User-Agent"],
                extra_http_headers={
                    "Referer": BASE_URL + "/",
                    "Accept-Language": "fr-FR,fr;q=0.9",
                },
            )
            page = context.new_page()

            def on_request(request):
                nonlocal found_url
                if found_url:
                    return
                url = request.url
                if re.search(r"\.(m3u8|mp4)(\?|$)", url, re.I):
                    found_url = url

            def on_response(response):
                nonlocal found_url
                if found_url:
                    return
                url = response.url
                if "api/source" in url:
                    try:
                        data = response.json()
                        sources = data.get("data", [])
                        if isinstance(sources, list):
                            for s in sources:
                                f = s.get("file", "")
                                if f.startswith("http"):
                                    found_url = f
                                    return
                    except Exception:
                        pass

            page.on("request", on_request)
            page.on("response", on_response)

            try:
                page.goto(embed_url, timeout=20000, wait_until="domcontentloaded")
            except Exception:
                pass

            try:
                page.click("button.vjs-big-play-button, .play-button, #play, .jw-icon-play", timeout=3000)
            except Exception:
                pass

            for _ in range(20):
                if found_url:
                    break
                page.wait_for_timeout(500)

            if not found_url:
                try:
                    src = page.evaluate("""() => {
                        const v = document.querySelector('video');
                        if (v) return v.src || (v.querySelector('source') ? v.querySelector('source').src : '');
                        return '';
                    }""")
                    if src and src.startswith("http"):
                        found_url = src
                except Exception:
                    pass

            browser.close()
    except Exception:
        pass

    return found_url


def resolve_direct_url(embed_url: str) -> str:
    url_lower = embed_url.lower()
    if "sibnet" in url_lower:
        headers = {"User-Agent": SESSION.headers["User-Agent"], "Referer": BASE_URL + "/"}
        try:
            r = requests.get(embed_url, headers=headers, timeout=15)
            text = r.text
            m = re.search(r"https://video[.]sibnet[.]ru[^\x22\x27\s]+[.]mp4", text)
            if m:
                return m.group(0)
        except Exception:
            pass
    return _resolve_with_playwright(embed_url)


def download_direct(url: str, dest: Path, label: str) -> bool:
    headers = dict(SESSION.headers)
    headers["Referer"] = BASE_URL + "/"

    if ".m3u8" in url.lower():
        try:
            result = subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-headers", f"Referer: {BASE_URL}/\r\nUser-Agent: {SESSION.headers['User-Agent']}\r\n",
                    "-i", url,
                    "-c", "copy",
                    str(dest.with_suffix(".mp4")),
                ],
                timeout=7200,
                capture_output=True,
            )
            if result.returncode == 0:
                return True
            return False
        except FileNotFoundError:
            err("ffmpeg non installé")
            return False
        except subprocess.TimeoutExpired:
            return False
    else:
        try:
            r = requests.get(url, headers=headers, stream=True, timeout=30)
            if r.status_code >= 400:
                return False
            total = int(r.headers.get("content-length", 0))
            dest_mp4 = dest.with_suffix(".mp4")
            downloaded = 0
            with open(dest_mp4, "wb") as f:
                for chunk in r.iter_content(chunk_size=1024 * 256):
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)
                        if total:
                            pct = downloaded * 100 // total
                            mb = downloaded / 1024 / 1024
                            print(f"  {label} : {pct}% ({mb:.1f} MB)", end="\r")
            print(f"  {label} : 100% ({downloaded/1024/1024:.1f} MB)    ")
            return True
        except Exception as e:
            err(str(e))
            return False


def download_video(embed_url: str, anime_title: str, season_label: str, ep_label: str, ep: dict = None) -> bool:
    folder = ANIME_DL_DIR / slugify(anime_title) / slugify(season_label)
    folder.mkdir(parents=True, exist_ok=True)

    num_match = re.search(r"\d+", ep_label)
    num = int(num_match.group()) if num_match else 0
    dest = folder / f"ep{num:03d}"

    existing = list(folder.glob(f"ep{num:03d}.*"))
    if existing:
        skip(f"{ep_label} — déjà téléchargé")
        return True

    host = "inconnu"
    for d in ["sibnet", "sendvid", "vidmoly", "ok.ru", "vk.com", "dailymotion", "streamtape"]:
        if d in embed_url.lower():
            host = d
            break
    dl(f"{ep_label}  {c(host, DIM)}")

    out_path = folder / f"ep{num:03d}.%(ext)s"
    urls_to_try = [embed_url] + (ep.get("alt_urls", []) if ep else [])

    for i, url in enumerate(urls_to_try):
        direct = resolve_direct_url(url)
        if direct and direct != url:
            success = download_direct(direct, dest, ep_label)
            if success:
                return True

        try:
            result = subprocess.run(
                ["yt-dlp", "-o", str(out_path), "--no-warnings",
                 "--progress", "--no-playlist", url],
                timeout=7200,
            )
            if result.returncode == 0:
                return True
        except FileNotFoundError:
            warn("yt-dlp non installé")
        except subprocess.TimeoutExpired:
            pass

    return False


# ── Scan ──────────────────────────────────────────────────────────────────────

def get_scan_langs(anime_url: str) -> list:
    slug_match = re.search(r"/catalogue/([^/]+)/?$", anime_url.rstrip("/"))
    if not slug_match:
        return []
    slug = slug_match.group(1)
    season_domain = "https://anime-sama.to"
    base = f"{season_domain}/catalogue/{slug}"

    candidates = [
        {"label": "Scan VF",     "url": f"{base}/scan/vf/",     "lang": "VF"},
        {"label": "Scan VOSTFR", "url": f"{base}/scan/vostfr/", "lang": "VOSTFR"},
    ]

    valid = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futs = {pool.submit(_check_url_exists, c["url"]): c for c in candidates}
        for fut in as_completed(futs):
            if fut.result():
                valid.append(futs[fut])
    valid.sort(key=lambda x: x["lang"])
    return valid


def get_chapters(scan_url: str) -> list:
    r = get(scan_url)
    if not r:
        return []
    soup = BeautifulSoup(r.text, "html.parser")
    el = soup.find(id="titreOeuvre")
    if not el:
        return []
    # Nexus copy: the site sends the title exactly as written in the page,
    # spaces included ("Naruto  "); the stripped one is "not found"
    raw = re.search(r'id=["\']titreOeuvre["\'][^>]*>(.*?)</', r.text, re.S)
    names = [raw.group(1)] if raw else []
    names.append(el.get_text(strip=True))

    domain = re.match(r"https?://[^/]+", scan_url).group(0)
    api_url = f"{domain}/s2/scans/get_nb_chap_et_img.php"
    data, titre = None, None
    for name in dict.fromkeys(names):
        api_r = get(api_url, params={"oeuvre": name})
        try:
            candidate = api_r.json() if api_r else None
        except Exception:
            candidate = None
        if isinstance(candidate, dict) and candidate and "error" not in candidate:
            data, titre = candidate, name
            break
    if not data:
        return []

    chapters = []
    numeric = [(k, v) for k, v in data.items() if re.fullmatch(r"\d+", str(k))]
    for chap_num_str, nb_pages in sorted(numeric, key=lambda x: int(x[0])):
        chap_num = int(chap_num_str)
        chapters.append({
            "label":    f"Chapitre {chap_num}",
            "url":      scan_url,
            "num":      chap_num,
            "nb_pages": int(nb_pages),
            "titre":    titre,
            "domain":   domain,
        })
    return chapters


def get_pages(chapter: dict) -> list:
    domain   = chapter.get("domain", BASE_URL)
    titre    = chapter.get("titre", "")
    num      = chapter.get("num", 1)
    nb_pages = chapter.get("nb_pages", 0)
    return [f"{domain}/s2/scans/{titre}/{num}/{i}.jpg" for i in range(1, nb_pages + 1)]


def download_chapter(chapter: dict, title: str, lang: str):
    chapter_dir = DOWNLOAD_DIR / slugify(title) / lang / slugify(chapter["label"])
    pdf_path_check = chapter_dir.parent / f"{slugify(chapter['label'])}.pdf"
    if pdf_path_check.exists():
        print(f"  ✓ Deja telecharge : {chapter['label']}")
        return
    if chapter_dir.exists() and any(chapter_dir.iterdir()):
        print(f"  ✓ Deja telecharge : {chapter['label']} (images)")
        return

    print(f"  ⬇  {chapter['label']} ({chapter.get('nb_pages', '?')} pages)…")
    pages = get_pages(chapter)
    if not pages:
        return

    chapter_dir.mkdir(parents=True, exist_ok=True)

    def _dl_page(args):
        i, url = args
        ext = re.search(r"\.(jpg|jpeg|png|webp)", url, re.I)
        ext = ("." + ext.group(1).lower()) if ext else ".jpg"
        dest = chapter_dir / f"{i:04d}{ext}"
        if dest.exists():
            return i, True
        r = get(url)
        if r:
            dest.write_bytes(r.content)
            return i, True
        return i, False

    total = len(pages)
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(_dl_page, (i + 1, url)) for i, url in enumerate(pages)]
        for done, fut in enumerate(as_completed(futures), 1):
            i, success = fut.result()
            print(f"     [{done}/{total}] {'✓' if success else '✗'} page {i:04d}", end="\r")

    print(f"\n  ✅ {chapter['label']} → images téléchargées")

    images = sorted(set(
        list(chapter_dir.glob("*.jpg")) +
        list(chapter_dir.glob("*.jpeg")) +
        list(chapter_dir.glob("*.png")) +
        list(chapter_dir.glob("*.webp"))
    ), key=lambda p: p.name)

    if not images:
        return

    pdf_path = chapter_dir.parent / f"{slugify(chapter['label'])}.pdf"

    try:
        from PIL import Image as PILImage
        pil_images = []
        for img_path in images:
            try:
                img = PILImage.open(img_path).convert("RGB")
                pil_images.append(img)
            except Exception:
                pass

        if pil_images:
            pil_images[0].save(pdf_path, save_all=True, append_images=pil_images[1:])
            import shutil
            shutil.rmtree(chapter_dir)
            print(f"     📄 PDF : {pdf_path}")
    except ImportError:
        print("     ⚠ Pillow non installé — images gardées sans PDF")
    except Exception as e:
        print(f"     ⚠ Erreur PDF : {e}")


# ── Navigation ────────────────────────────────────────────────────────────────

RETOUR = "__RETOUR__"

def prompt(msg: str) -> str:
    try:
        val = input(msg).strip()
        if val.lower() in ("r", "0", "retour", "back"):
            return RETOUR
        return val
    except (KeyboardInterrupt, EOFError):
        return RETOUR


def choose_one_nav(items, label_fn, prompt_txt="Choix"):
    if not items:
        print("  Aucun résultat.")
        return RETOUR
    print(c("   0. ← Retour", DIM))
    for i, item in enumerate(items, 1):
        print(f"  {c(str(i).rjust(3), B, CY)}. {label_fn(item)}")
    while True:
        val = prompt(f"\n{prompt_txt} (0=retour, 1-{len(items)}): ")
        if val == RETOUR or val == "0":
            return RETOUR
        try:
            idx = int(val)
            if 1 <= idx <= len(items):
                return items[idx - 1]
        except ValueError:
            pass
        print(f"  Entrez un nombre entre 0 et {len(items)}.")


def choose_multi_nav(items, label_fn, prompt_txt="Sélection"):
    if not items:
        print("  Aucun résultat.")
        return RETOUR
    print(c("   0. ← Retour", DIM))
    for i, item in enumerate(items, 1):
        print(f"  {c(str(i).rjust(3), B, CY)}. {label_fn(item)}")
    print(c("\n  Sélection : '1'  '3-7'  '1,4,6'  'all'  '0'=retour", DIM))
    while True:
        val = prompt(f"{prompt_txt} : ")
        if val == RETOUR or val == "0":
            return RETOUR
        if val.lower() == "all":
            return items
        try:
            selected = set()
            for part in val.split(","):
                part = part.strip()
                if "-" in part:
                    a, b = part.split("-", 1)
                    selected.update(range(int(a) - 1, int(b)))
                else:
                    selected.add(int(part) - 1)
            result = [items[i] for i in sorted(selected) if 0 <= i < len(items)]
            if result:
                return result
        except (ValueError, IndexError):
            pass
        print("  Format invalide.")


def run_anime(title: dict):
    while True:
        soup = get_title_page(title["url"])
        if not soup:
            return

        seasons = get_seasons(soup, title["url"])
        if not seasons:
            print("  Aucune saison trouvée.")
            return

        print()
        season = choose_one_nav(seasons, lambda x: x["label"], "Saison / langue")
        if season == RETOUR:
            return

        while True:
            print(c("  Chargement des épisodes...", DIM))
            episodes = get_episodes(season["url"])
            if not episodes:
                err("Aucun épisode trouvé pour cette saison.")
                break

            print(f"\n{len(episodes)} épisode(s) :\n")
            selected = choose_multi_nav(episodes, lambda x: x["label"], "Episodes à télécharger")
            if selected == RETOUR:
                break

            ok_count = 0
            for ep in selected:
                success = download_video(ep["url"], title["title"], season["label"], ep["label"], ep=ep)
                if success:
                    ok_count += 1
                    ok(ep["label"])
                else:
                    err(ep["label"] + " — échec")

            print(c(f"\n  🎉 {ok_count}/{len(selected)} téléchargé(s).", B, GR))

            val = prompt("\nAutres épisodes de cette saison ? (o/n/0=retour saison) : ").lower()
            if val in ("n", "non", "0", RETOUR):
                break


def run_scan(title: dict):
    while True:
        langs = get_scan_langs(title["url"])
        if not langs:
            print("  Aucun scan disponible.")
            return

        print()
        lang = choose_one_nav(langs, lambda x: x["label"], "Langue du scan")
        if lang == RETOUR:
            return

        while True:
            print(c("  Chargement des chapitres...", DIM))
            chapters = get_chapters(lang["url"])
            if not chapters:
                break

            print(f"  {len(chapters)} chapitre(s)\n")
            selected = choose_multi_nav(chapters, lambda x: x["label"], "Chapitres à télécharger")
            if selected == RETOUR:
                break

            for chap in selected:
                download_chapter(chap, title["title"], lang["lang"])
            print(f"\n🎉 Terminé !")

            val = prompt("\nAutres chapitres ? (o/n/0=retour langue) : ").lower()
            if val in ("n", "non", "0", RETOUR):
                break


def main():
    if not CATALOGUE_FILE.exists():
        print(c("  Catalogue introuvable, construction en cours...", YE))
        build_catalogue(force=True)
    else:
        build_catalogue(force=False)

    cat = _load_catalogue()
    cat_info = f"{len(cat)} titres" if cat else "non construit"

    print()
    print(c("  ╔══════════════════════════════════════════════════╗", CY))
    print(c("  ║  🎌  ANISAMA-CLI", B, CY) + c(f"  ·  {BASE_URL.replace('https://', '')}", DIM) + c("", R))
    print(c(f"  ║  Catalogue : {cat_info}", DIM))
    print(c("  ╚══════════════════════════════════════════════════╝", CY))
    print()
    print(f"  {c('[1]', B, CY)} Télécharger un anime  →  /media/animes")
    print(f"  {c('[2]', B, CY)} Télécharger un scan   →  /media/animes/scans")
    print(f"  {c('[3]', B, CY)} Reconstruire le catalogue")
    print(f"  {c('[0]', B, DIM)} Quitter")
    print()

    while True:
        mode = prompt("\nMode (1/2/3/0) : ")
        if mode == RETOUR or mode == "0":
            print("Au revoir !")
            return
        if mode == "3":
            build_catalogue(force=True)
            cat = _load_catalogue()
            print(c(f"  Catalogue mis à jour : {len(cat)} titres", GR))
            continue
        if mode not in ("1", "2"):
            print("  Entrez 1, 2, 3 ou 0.")
            continue

        while True:
            query = prompt("Rechercher un titre (0=retour) : ")
            if query == RETOUR or query == "0":
                break
            if not query:
                continue

            print(f"\nRecherche de « {query} »…\n")
            results = search(query)
            if not results:
                print("  Aucun résultat.")
                continue

            while True:
                title = choose_one_nav(results, lambda x: x["title"], "Choisir le titre")
                if title == RETOUR:
                    break
                print()
                if mode == "1":
                    run_anime(title)
                else:
                    run_scan(title)
                val = prompt("\n[1] Autre chose pour ce titre  [0] Nouvelle recherche : ")
                if val != "1":
                    break


# ── Mode Nexus (--json) ───────────────────────────────────────────────────────
# Everything below is only used with --json; the menus above are unchanged.

ANIME_SEGMENT = re.compile(r"^(?:(?:saison\d+|kai\d*|film\d*|oav\d*)(?:hs)?|saison\d+-\d+|speciaux|specials?)$")
LANGS = ("vostfr", "vf", "va", "vj", "vcn", "vqc", "vkr", "vf1", "vf2")


def _slug_of(url):
    m = re.search(r"/catalogue/([^/?#]+)", url or "")
    return m.group(1) if m else None


def _catalogue_entry(slug):
    for item in _load_catalogue():
        if item.get("slug") == slug:
            return item
    return None


def _save_catalogue_fields(slug, **fields):
    """Remember poster / description in catalogue.json (incremental, no rebuild)."""
    cat = _load_catalogue()
    changed = False
    for item in cat:
        if item.get("slug") == slug:
            for k, v in fields.items():
                if v and item.get(k) != v:
                    item[k] = v
                    changed = True
    if changed:
        tmp = CATALOGUE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(cat, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(CATALOGUE_FILE)


def _page_info(slug):
    """Poster, description and the season / scan links written in the title page."""
    url = f"https://anime-sama.to/catalogue/{slug}/"
    r = get(url, silent_404=True)
    if not r:
        return {}
    html = r.text
    soup = BeautifulSoup(html, "html.parser")
    poster = None
    for sel in ("#coverOeuvre", "img#coverOeuvre", "meta[property='og:image']"):
        el = soup.select_one(sel)
        if el:
            poster = el.get("src") or el.get("content")
            if poster:
                break
    if poster and poster.startswith("/"):
        poster = BASE_URL + poster
    desc = None
    meta = soup.select_one("meta[name='description'], meta[property='og:description']")
    if meta and meta.get("content"):
        desc = meta["content"].strip()
    for h in soup.find_all(["h2", "h3"]):
        if "synopsis" in h.get_text(strip=True).lower():
            p = h.find_next("p")
            if p and p.get_text(strip=True):
                desc = p.get_text(" ", strip=True)
            break
    # Links like panneauAnime("Saison 1", "saison1/vostfr") or panneauScan("Scans", "scan/vf"),
    # read like a browser runs them: only inside <script> blocks that are not in an HTML
    # comment, without the JavaScript comments (the site disables seasons / sections that
    # way), and without the examples — panneauAnime("nom", "url").
    links = []
    for name, seg, lang in re.findall(
            r"panneau\w*\(\s*[\"']([^\"']*)[\"']\s*,\s*[\"']([a-z0-9_-]+)/([a-z0-9]+)/?[\"']",
            _active_scripts(html), re.I):
        if name.strip().lower() in ("", "nom", "url", "name") or seg.lower() == "url":
            continue
        links.append((name.strip(), seg, lang))
    return {"poster": poster, "description": desc, "links": links}


def _active_scripts(html):
    """JavaScript the browser really runs: <script> contents outside <!-- -->, minus JS comments."""
    out, i, n = [], 0, len(html)
    low = html.lower()
    while i < n:
        c = low.find("<!--", i)
        sc = low.find("<script", i)
        if sc < 0:
            break
        if 0 <= c < sc:                       # an HTML comment comes first: skip it whole
            end = low.find("-->", c + 4)
            i = n if end < 0 else end + 3
            continue
        start = low.find(">", sc)
        end = low.find("</script", start)
        if start < 0 or end < 0:
            break
        out.append(html[start + 1:end])
        i = end + 9
    code = "\n".join(out)
    code = re.sub(r"/\*.*?\*/", "", code, flags=re.S)        # /* … */
    code = re.sub(r"(?m)^\s*//.*$", "", code)                 # // … (whole line)
    return code


def _probe(urls):
    found = set()
    with ThreadPoolExecutor(max_workers=16) as pool:
        futs = {pool.submit(_check_url_exists, u): u for u in urls}
        for fut in as_completed(futs):
            if fut.result():
                found.add(futs[fut])
    return found


def _season_label(seg):
    if seg.endswith("hs") and len(seg) > 2:
        return f"{_season_label(seg[:-2])} (sans fillers)"
    m = re.match(r"saison(\d+)", seg)
    if m:
        return f"Saison {m.group(1)}"
    m = re.match(r"(kai|film|oav)(\d+)$", seg)
    if m:
        return f"{ {'kai': 'Kai', 'film': 'Film', 'oav': 'OAV'}[m.group(1)] } {m.group(2)}"
    return {"film": "Film", "oav": "OAV", "speciaux": "Spéciaux", "special": "Spécial", "specials": "Spéciaux"}.get(seg, seg.capitalize())


def _season_sort(seg):
    if seg.endswith("hs") and len(seg) > 2:
        base = _season_sort(seg[:-2])
        return base[:2] + (base[2] + "~",)
    m = re.match(r"(saison|film|kai|oav)(\d*)", seg)
    if not m:
        return (9, 0, seg)
    return ({"saison": 0, "film": 1, "kai": 2, "oav": 3}[m.group(1)], int(m.group(2) or 0), seg)


def _structure(slug, full_probe=False):
    """Anime seasons {seg: [langs]} and scan langs [..] of a title."""
    info = _page_info(slug)
    base = f"https://anime-sama.to/catalogue/{slug}"
    seasons, scans, variants = {}, set(), {}
    for name, seg, lang in info.get("links", []):
        seg, lang = seg.lower(), lang.lower()
        if seg == "scan":
            scans.add(lang.upper())
        elif seg.startswith("scan"):
            # Other scans on the same page: one-shot, spin-off, black & white, sequel…
            v = variants.setdefault(seg, {"seg": seg, "name": name, "langs": set()})
            v["langs"].add(lang.upper())
        elif ANIME_SEGMENT.match(seg):
            seasons.setdefault(seg, set()).add(lang)
    if not seasons and not scans and not variants or full_probe:
        # Same probing as the menu (get_seasons)
        segs = ([f"saison{i}" for i in range(1, 25)] + ["film"] + [f"film{i}" for i in range(1, 10)]
                + ["oav", "oav1", "oav2", "speciaux", "special", "specials"])
        cand = {f"{base}/{seg}/{lang}/": (seg, lang) for seg in segs for lang in ("vostfr", "vf")}
        for u in _probe(list(cand)):
            seg, lang = cand[u]
            seasons.setdefault(seg, set()).add(lang)
        # Scan pages answer 200 even when there are none: only real chapters count
        for lang in ("vf", "vostfr"):
            if get_chapters(f"{base}/scan/{lang}/"):
                scans.add(lang.upper())
    else:
        # The page often lists only VOSTFR; VF may exist next to it
        extra = {f"{base}/{seg}/vf/": seg for seg, langs in seasons.items() if "vf" not in langs}
        for u in _probe(list(extra)):
            seasons[extra[u]].add("vf")
    info["scan_variants"] = [{"seg": v["seg"], "name": v["name"], "langs": sorted(v["langs"])} for v in variants.values()]
    ordered = [{"id": seg, "label": _season_label(seg),
                "langs": sorted((l.upper() for l in langs), key=lambda l: (l != "VOSTFR", l))}
               for seg, langs in sorted(seasons.items(), key=lambda kv: _season_sort(kv[0]))]
    return ordered, sorted(scans), info


def _poster_url(entry, info):
    return (info or {}).get("poster") or entry.get("poster")


def _live_search(query):
    """The site's own search, for titles added after the catalogue was built."""
    global _catalogue_cache
    saved = _catalogue_cache
    _catalogue_cache = []          # search() falls back to the site when the catalogue is empty
    try:
        return search(query)
    finally:
        _catalogue_cache = saved


def _add_to_catalogue(hits):
    """Titles found live are added to catalogue.json (incremental update)."""
    cat = _load_catalogue()
    known = {e.get("slug") for e in cat}
    added = []
    for h in hits:
        slug = _slug_of(h.get("url", ""))
        if slug and slug not in known:
            known.add(slug)
            added.append({"title": h["title"], "url": f"https://anime-sama.to/catalogue/{slug}", "slug": slug})
    if added:
        cat.extend(added)
        cat.sort(key=lambda x: x["title"].lower())
        tmp = CATALOGUE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(cat, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(CATALOGUE_FILE)


def json_refresh_catalogue():
    """Rebuilds catalogue.json from the site, keeping the posters / synopses already found."""
    old = {e.get("slug"): e for e in _load_catalogue()}
    data = build_catalogue(force=True)
    if not data:
        nexus_cli.fail("Catalogue d'anime-sama inaccessible")
    for e in data:
        prev = old.get(e["slug"]) or {}
        for k in ("poster", "description"):
            if prev.get(k) and not e.get(k):
                e[k] = prev[k]
    # Union with the old list: a page the site failed to send never makes titles disappear
    fresh = {e["slug"] for e in data}
    data += [e for slug, e in old.items() if slug and slug not in fresh]
    data.sort(key=lambda x: x["title"].lower())
    CATALOGUE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    global _catalogue_cache
    _catalogue_cache = data
    new = [e["title"] for e in data if e["slug"] not in old]
    nexus_cli.emit("catalogue", count=len(data), added=len(new), new_titles=new[:50])


def json_search(query, limit):
    hits = search(query)[: (limit or 8)]
    if not hits:
        # Not in the local catalogue: ask the site (new titles), and remember them
        hits = _live_search(query)[: (limit or 8)]
        _add_to_catalogue(hits)
    if not hits:
        return 0
    def one(hit):
        slug = _slug_of(hit["url"])
        if not slug:
            return []
        entry = _catalogue_entry(slug) or {"title": hit["title"], "slug": slug}
        seasons, scans, info = _structure(slug)
        poster = _poster_url(entry, info)
        _save_catalogue_fields(slug, poster=poster, description=info.get("description"))
        base = {"source": "anisama", "title": entry.get("title") or hit["title"], "poster_url": poster,
                "year": None, "description": info.get("description") or entry.get("description"), "slug": slug}
        out = []
        if seasons:
            out.append({**base, "id": f"anisama:anime:{slug}", "kind": "anime", "seasons": seasons})
        if scans:
            out.append({**base, "id": f"anisama:manga:{slug}", "kind": "manga", "langs": scans})
        for v in info.get("scan_variants", []):
            out.append({**base, "id": f"anisama:manga:{slug}~{v['seg']}", "kind": "manga", "langs": v["langs"],
                        "title": _variant_title(base["title"], v)})
        return out
    count = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        for fut in as_completed([pool.submit(one, h) for h in hits]):
            try:
                for res in fut.result():
                    nexus_cli.emit("result", **res)
                    count += 1
            except Exception as e:
                print(f"search: {e}")
    return count


def _parse_id(id_):
    """anisama:anime:slug, anisama:manga:slug, anisama:manga:slug~scan_one_shot (other scans of the page)."""
    m = re.fullmatch(r"anisama:(anime|manga):([a-z0-9][a-z0-9-]*)(?:~(scan[a-z0-9_-]+))?", id_ or "")
    if not m:
        nexus_cli.fail(f"Identifiant invalide : {id_}")
    return m.group(1), m.group(2), m.group(3)


def _variant_title(title, v):
    name = (v.get("name") or "").strip()
    if name.lower() in ("", "scans", "scan"):
        return f"{title} ({v['seg'].replace('_', ' ').replace('-', ' ')[4:].strip() or 'scans'})"
    return name


def _title_of(slug):
    entry = _catalogue_entry(slug)
    return (entry or {}).get("title") or slug.replace("-", " ").title()


def _anime_folder(title, seg, lang):
    # Same folder names as the menu: "Saison1 — VOSTFR"
    return ANIME_DL_DIR / slugify(title) / slugify(f"{seg.capitalize()} — {lang.upper()}")


def _scan_pdf(title, lang, num):
    return DOWNLOAD_DIR / slugify(title) / lang / f"{slugify(f'Chapitre {num}')}.pdf"


def json_details(id_):
    kind, slug, scan_seg = _parse_id(id_)
    title = _title_of(slug)
    base = f"https://anime-sama.to/catalogue/{slug}"
    seasons, scans, info = _structure(slug)
    if scan_seg:
        variant = next((v for v in info.get("scan_variants", []) if v["seg"] == scan_seg), None)
        if not variant:
            nexus_cli.fail("Ces scans n'existent plus sur le site")
        title, scans = _variant_title(title, variant), variant["langs"]
    if kind == "anime":
        def season_eps(season, lang):
            eps = get_episodes(f"{base}/{season['id']}/{lang.lower()}/")
            folder = _anime_folder(title, season["id"], lang)
            return {"id": season["id"], "lang": lang, "label": f"{season['label']} — {lang}",
                    "episodes": [{"n": i, "label": e["label"], "downloaded": any(folder.glob(f"ep{i:03d}.*"))}
                                 for i, e in enumerate(eps, 1)]}
        jobs = [(s, l) for s in seasons for l in s["langs"]]
        with ThreadPoolExecutor(max_workers=6) as pool:
            out = list(pool.map(lambda a: season_eps(*a), jobs))
        nexus_cli.emit("details", id=id_, kind="anime", title=title, poster_url=_poster_url({}, info),
                       description=info.get("description"), seasons=[s for s in out if s["episodes"]])
    else:
        langs = []
        for lang in scans:
            chs = get_chapters(f"{base}/{scan_seg or 'scan'}/{lang.lower()}/")
            langs.append({"lang": lang, "chapters": [
                {"n": ch["num"], "pages": ch["nb_pages"], "downloaded": _scan_pdf(title, lang, ch["num"]).exists()}
                for ch in chs]})
        nexus_cli.emit("details", id=id_, kind="manga", title=title, poster_url=_poster_url({}, info),
                       description=info.get("description"), langs=[l for l in langs if l["chapters"]])


def _download_episode_json(ep, n, total, title, seg, lang):
    """Like download_video(), with progress and a temporary name."""
    item = f"{_season_label(seg)} · Épisode {n}"
    folder = _anime_folder(title, seg, lang)
    folder.mkdir(parents=True, exist_ok=True)
    existing = [p for p in folder.glob(f"ep{n:03d}.*")]
    if existing:
        nexus_cli.emit("item_skipped", name=item, reason="exists", path=str(existing[0]))
        return "skipped"
    nexus_cli.emit("item_start", name=item, index=n, total=total)
    final = folder / f"ep{n:03d}.mp4"
    part = nexus_cli.part_path(final)
    for url in [ep["url"]] + ep.get("alt_urls", []):
        direct = resolve_direct_url(url)
        if direct and direct != url:
            if ".m3u8" in direct.lower():
                hdr = f"Referer: {BASE_URL}/\r\nUser-Agent: {SESSION.headers['User-Agent']}\r\n"
                done = nexus_cli.ffmpeg_download(direct, part, item, hdr)
            else:
                done = nexus_cli.http_download(SESSION, direct, part, item, headers={"Referer": BASE_URL + "/"})
            if done and nexus_cli.finish(part, final):
                nexus_cli.emit("item_done", name=item, path=str(final))
                return "ok"
        # yt-dlp as last resort, like the menu
        tmpl = str(folder / f".part-ep{n:03d}.%(ext)s")
        code, _ = nexus_cli.ytdlp_run(["-o", tmpl, "--no-warnings", "--no-playlist", url], item)
        if code == 0:
            got = sorted(folder.glob(f".part-ep{n:03d}.*"))
            if got:
                dest = folder / f"ep{n:03d}{got[0].suffix}"
                got[0].replace(dest)
                nexus_cli.emit("item_done", name=item, path=str(dest))
                return "ok"
        for leftover in folder.glob(f".part-ep{n:03d}.*"):
            leftover.unlink(missing_ok=True)
    nexus_cli.emit("error", message="Aucune source n'a fonctionné", item=item, fatal=False)
    return "failed"


def _download_chapter_json(ch, title, lang, index, total):
    """Like download_chapter(), with progress; the PDF is written under a temporary name."""
    num = ch["num"]
    item = f"Chapitre {num}"
    pdf = _scan_pdf(title, lang, num)
    if pdf.exists():
        nexus_cli.emit("item_skipped", name=item, reason="exists", path=str(pdf))
        return "skipped"
    nexus_cli.emit("item_start", name=item, index=index, total=total)
    pages = get_pages(ch)
    if not pages:
        nexus_cli.emit("error", message="Aucune page", item=item, fatal=False)
        return "failed"
    img_dir = DOWNLOAD_DIR / slugify(title) / lang / slugify(item)
    img_dir.mkdir(parents=True, exist_ok=True)
    throttle = nexus_cli.Throttle(0.4)
    done_pages = 0

    def dl_page(args):
        i, url = args
        ext = re.search(r"\.(jpg|jpeg|png|webp)", url, re.I)
        dest = img_dir / f"{i:04d}{('.' + ext.group(1).lower()) if ext else '.jpg'}"
        if dest.exists() and dest.stat().st_size > 0:
            return True
        r = get(url)
        if r:
            tmp = dest.with_name(".part-" + dest.name)
            tmp.write_bytes(r.content)
            tmp.replace(dest)
            return True
        return False

    ok_pages = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        for good in pool.map(dl_page, [(i + 1, u) for i, u in enumerate(pages)]):
            done_pages += 1
            ok_pages += 1 if good else 0
            if throttle.ready(done_pages == len(pages)):
                nexus_cli.emit("progress", item=item, chapter=index, chapters_total=total,
                               page=done_pages, pages_total=len(pages))
    if ok_pages < len(pages):
        nexus_cli.emit("error", message=f"{len(pages) - ok_pages} page(s) manquante(s)", item=item, fatal=False)
        return "failed"
    images = sorted((p for p in img_dir.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")
                     and not p.name.startswith(".part-")), key=lambda p: p.name)
    try:
        from PIL import Image as PILImage
        imgs = [PILImage.open(p).convert("RGB") for p in images]
        part = nexus_cli.part_path(pdf)
        imgs[0].save(part, format="PDF", save_all=True, append_images=imgs[1:])
        nexus_cli.finish(part, pdf)
        import shutil
        shutil.rmtree(img_dir, ignore_errors=True)
        nexus_cli.emit("item_done", name=item, path=str(pdf))
        return "ok"
    except ImportError:
        nexus_cli.emit("item_done", name=item, path=str(img_dir))   # images kept, like the menu
        return "ok"
    except Exception as e:
        nexus_cli.emit("error", message=f"PDF : {e}", item=item, fatal=False)
        return "failed"


def json_download(args):
    global ANIME_DL_DIR, DOWNLOAD_DIR
    kind, slug, scan_seg = _parse_id(args.download)
    title = _title_of(slug)
    if scan_seg:
        variant = next((v for v in _structure(slug)[2].get("scan_variants", []) if v["seg"] == scan_seg), None)
        if not variant:
            nexus_cli.fail("Ces scans n'existent plus sur le site")
        title = _variant_title(title, variant)
    base = f"https://anime-sama.to/catalogue/{slug}"
    lang = (args.lang or ("VOSTFR" if kind == "anime" else "VF")).upper()
    if not re.fullmatch(r"[A-Z0-9]{2,8}", lang):
        nexus_cli.fail("Langue invalide")
    stats = {"ok": 0, "failed": 0, "skipped": 0}
    if kind == "anime":
        if args.dest:
            ANIME_DL_DIR = Path(args.dest)
        seg = (args.season or "saison1").lower()
        if not ANIME_SEGMENT.match(seg):
            nexus_cli.fail("Saison invalide")
        eps = get_episodes(f"{base}/{seg}/{lang.lower()}/")
        if not eps:
            nexus_cli.fail("Aucun épisode trouvé pour cette saison")
        wanted = nexus_cli.parse_selection(args.episodes, list(range(1, len(eps) + 1)))
        for i, n in enumerate(wanted, 1):
            stats[_download_episode_json(eps[n - 1], n, len(wanted), title, seg, lang)] += 1
    else:
        if args.dest:
            DOWNLOAD_DIR = Path(args.dest)
        chapters = get_chapters(f"{base}/{scan_seg or 'scan'}/{lang.lower()}/")
        if not chapters:
            nexus_cli.fail("Aucun chapitre trouvé")
        by_num = {ch["num"]: ch for ch in chapters}
        wanted = nexus_cli.parse_selection(args.chapters, list(by_num))
        for i, n in enumerate(wanted, 1):
            stats[_download_chapter_json(by_num[n], title, lang, i, len(wanted))] += 1
    nexus_cli.emit("done", **stats)
    return 0 if stats["failed"] == 0 else 2


def json_main():
    args = nexus_cli.parser("anisama.py — mode Nexus").parse_args()
    try:
        if args.refresh_catalogue:
            json_refresh_catalogue()
            nexus_cli.emit("done")
        elif args.search is not None:
            json_search(args.search, args.limit)
            nexus_cli.emit("done")
        elif args.details:
            json_details(args.details)
            nexus_cli.emit("done")
        else:
            sys.exit(json_download(args))
    except ValueError as e:
        nexus_cli.fail(str(e))


if __name__ == "__main__":
    if JSON_MODE:
        json_main()
    else:
        try:
            main()
        except KeyboardInterrupt:
            print("\n\nAu revoir !")
