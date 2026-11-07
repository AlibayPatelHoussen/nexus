#!/usr/bin/env python3
"""
youtube.py — Téléchargeur YouTube via yt-dlp
Télécharge dans /media/youtube
"""

import subprocess
import os
import sys
import re

# Nexus: --json mode (no menu, JSON Lines on stdout)
import nexus_cli
JSON_MODE = nexus_cli.early_json()

# ── Couleurs ANSI ─────────────────────────────────────────────────────────────
R   = "\033[0m"
B   = "\033[1m"
DIM = "\033[2m"
CY  = "\033[96m"
GR  = "\033[92m"
RE  = "\033[91m"

def c(text, *styles):  return "".join(styles) + str(text) + R
def sep():             return c("─" * 54, DIM)
def ok(text):          print(c("  ✅ " + text, GR))
def err(text):         print(c("  ✗  " + text, RE))
def dl(text):          print(c("  ⬇  " + text, CY))
def step(text):        print(c("  →  " + text, DIM))

# ── Dossier serveur ───────────────────────────────────────────────────────────
YOUTUBE_DIR = "/media/youtube"
os.makedirs(YOUTUBE_DIR, exist_ok=True)

def slugify(text):
    text = re.sub(r'[<>:"/\\|?*]', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text.replace(' ', '_') or "video"

def download_youtube(url):
    step("Récupération du titre...")
    result = subprocess.run(["yt-dlp", "--get-title", url], capture_output=True, text=True)
    titre = result.stdout.strip() if result.returncode == 0 else "video_youtube"
    output_file = os.path.join(YOUTUBE_DIR, f"{slugify(titre)}.mp4")
    dl(f"Titre   : {titre}")
    dl(f"Dossier : {output_file}")
    print(sep())
    subprocess.run([
        "yt-dlp",
        "-f", "bestvideo+bestaudio/best",
        "--merge-output-format", "mp4",
        "-o", output_file,
        url
    ])
    ok(f"Sauvegardé : {output_file}")

def main():
    print()
    print(c("  ╔══════════════════════════════════════════════════╗", CY))
    print(c("  ║  🎬  YOUTUBE DOWNLOADER  →  /media/youtube", B, CY))
    print(c("  ╚══════════════════════════════════════════════════╝", CY))
    print()

    while True:
        try:
            url = input(c("  Lien YouTube (0=quitter) : ", B)).strip()
        except (KeyboardInterrupt, EOFError):
            break
        if url in ("0", "q", "quitter"):
            break
        if not url:
            continue
        if "youtube.com" not in url and "youtu.be" not in url:
            err("Ce lien ne semble pas être un lien YouTube.")
            continue
        print(sep())
        download_youtube(url)
        print()

    print()
    ok("Au revoir !")

# ── Mode Nexus (--json) ───────────────────────────────────────────────────────
# Everything below is only used with --json; the menu above is unchanged.

import json
from pathlib import Path

VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


def _video_url(vid):
    return f"https://www.youtube.com/watch?v={vid}"


def _thumb(info):
    vid = info.get("id")
    thumbs = [t for t in (info.get("thumbnails") or []) if t.get("url")]
    if thumbs:
        best = max(thumbs, key=lambda t: (t.get("width") or 0) * (t.get("height") or 0))
        if best.get("width"):
            return best["url"]
    return info.get("thumbnail") or (f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg" if vid else None)


def _result(info):
    up = info.get("upload_date") or ""
    return {
        "id": f"youtube:{info['id']}", "source": "youtube", "kind": "youtube",
        "title": info.get("title") or info["id"],
        "thumbnail_url": _thumb(info), "poster_url": _thumb(info),
        "duration": int(info["duration"]) if info.get("duration") else None,
        "channel": info.get("channel") or info.get("uploader"),
        "year": int(up[:4]) if up[:4].isdigit() else None,
        "description": (info.get("description") or "")[:280] or None,
        "url": _video_url(info["id"]),
    }


def json_search(query, limit):
    query = query.strip()
    single = re.search(r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|live/)|youtu\.be/)([A-Za-z0-9_-]{11})", query)
    if single:
        args = ["--dump-json", "--no-playlist", "--skip-download", "--no-warnings", _video_url(single.group(1))]
    else:
        args = ["--dump-json", "--flat-playlist", "--no-warnings", f"ytsearch{limit or 15}:{query}"]
    try:
        r = subprocess.run([*nexus_cli.ytdlp_cmd(), *args], capture_output=True, text=True, timeout=60)
    except FileNotFoundError:
        nexus_cli.fail("yt-dlp n'est pas installé")
    except subprocess.TimeoutExpired:
        nexus_cli.fail("YouTube ne répond pas")
    for line in r.stdout.splitlines():
        try:
            info = json.loads(line)
        except ValueError:
            continue
        if info.get("id") and VIDEO_ID.match(info["id"]) and info.get("ie_key", "Youtube") in ("Youtube", None):
            nexus_cli.emit("result", **_result(info))
    if r.returncode != 0 and not r.stdout.strip():
        print(r.stderr)
        nexus_cli.fail("Recherche YouTube impossible")


def _existing(dest, vid):
    for p in Path(dest).rglob(f"*[[]{vid}[]].*"):
        if p.suffix.lower() in (".mp4", ".mkv", ".webm") and not p.name.startswith(".part-"):
            return p
    return None


def json_download(args):
    m = re.fullmatch(r"youtube:([A-Za-z0-9_-]{11})", args.download or "")
    if not m:
        nexus_cli.fail("Identifiant invalide")
    vid = m.group(1)
    dest = args.dest or YOUTUBE_DIR
    os.makedirs(dest, exist_ok=True)
    item = vid
    found = _existing(dest, vid)
    if found:
        nexus_cli.emit("item_skipped", name=found.stem, reason="exists", path=str(found))
        nexus_cli.emit("done", ok=0, failed=0, skipped=1)
        return 0
    nexus_cli.emit("item_start", name=item, index=1, total=1)
    final = {}
    def on_line(line):
        if line.startswith("NXFILE|"):
            final["path"] = line[len("NXFILE|"):]
    # /media/youtube/{Chaîne}/{Titre} [id].mp4 + .jpg (same name) + .info.json
    code, _ = nexus_cli.ytdlp_run([
        "-f", "bestvideo+bestaudio/best", "--merge-output-format", "mp4",
        "-o", os.path.join(dest, "%(channel,uploader|Inconnu)s", "%(title)s [%(id)s].%(ext)s"),
        "--write-thumbnail", "--convert-thumbnails", "jpg", "--embed-thumbnail",
        "--embed-metadata", "--write-info-json", "--no-playlist", "--no-warnings",
        "--print", "after_move:NXFILE|%(filepath)s",
        _video_url(vid),
    ], item, on_line)
    path = final.get("path")
    if code == 0 and path and os.path.exists(path):
        nexus_cli.emit("item_done", name=Path(path).stem, path=path)
        nexus_cli.emit("done", ok=1, failed=0, skipped=0)
        return 0
    reason = nexus_cli.ytdlp_reason(nexus_cli.last_ytdlp_error)
    nexus_cli.emit("error", message=f"Téléchargement YouTube impossible : {reason}" if reason else "Téléchargement YouTube impossible",
                   item=item, fatal=False)
    nexus_cli.emit("done", ok=0, failed=1, skipped=0)
    return 2


def json_main():
    args = nexus_cli.parser("youtube.py — mode Nexus").parse_args()
    if args.search is not None:
        json_search(args.search, args.limit)
        nexus_cli.emit("done")
    elif args.details:
        m = re.fullmatch(r"youtube:([A-Za-z0-9_-]{11})", args.details)
        if not m:
            nexus_cli.fail("Identifiant invalide")
        r = subprocess.run([*nexus_cli.ytdlp_cmd(), "--dump-json", "--no-playlist", "--skip-download", "--no-warnings",
                            _video_url(m.group(1))], capture_output=True, text=True, timeout=60)
        try:
            nexus_cli.emit("details", **_result(json.loads(r.stdout.splitlines()[0])))
        except Exception:
            nexus_cli.fail("Vidéo introuvable")
        nexus_cli.emit("done")
    else:
        sys.exit(json_download(args))


if __name__ == "__main__" and JSON_MODE:
    json_main()
elif __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nAu revoir !")
    except Exception as e:
        print()
        print("\033[91m  ✗  Erreur fatale :\033[0m", e)
        import traceback
        traceback.print_exc()
