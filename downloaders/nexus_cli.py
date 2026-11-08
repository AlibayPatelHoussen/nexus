"""
nexus_cli.py — shared helpers for the non-interactive mode (--json) of the
download scripts, used by Nexus.

In --json mode:
- every line written on stdout is one JSON object (JSON Lines);
- everything the scripts print for humans goes to stderr (Nexus keeps it as
  a log), so the existing print() calls never break the JSON stream;
- files are written under a hidden ".part-" name and renamed at the end, so a
  download cut in the middle is never taken for a finished file.

Without --json the scripts do not touch any of this and behave as before.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent

_OUT = None   # real stdout, kept for the JSON lines


def json_requested(argv=None) -> bool:
    return "--json" in (sys.argv[1:] if argv is None else argv)


def early_json() -> bool:
    """Call at the very top of a script: in --json mode, send prints to stderr."""
    global _OUT
    if not json_requested():
        return False
    if _OUT is None:
        _OUT = sys.stdout
        sys.stdout = sys.stderr
        _stop_with_nexus()
    return True


import signal
import threading

# yt-dlp runs in its own process group (so a stall stops it with its ffmpeg): a signal sent
# to this script's group does not reach it. Keep them to stop them with the script.
_CHILD_GROUPS = set()


def stop_children() -> None:
    for pgid in list(_CHILD_GROUPS):
        try:
            os.killpg(pgid, signal.SIGKILL)
        except OSError:
            pass
        _CHILD_GROUPS.discard(pgid)


def _stop_with_nexus() -> None:
    """--json mode (run by Nexus): a pause / cancel (SIGTERM) or Nexus going away (restart,
    deployment) stops everything this script started. Before, yt-dlp went on alone and the
    next try worked on the same files at the same time (« Conversion failed », broken .mp4)."""
    def on_term(signum, _frame):
        stop_children()
        os._exit(128 + signum)
    for sig in (signal.SIGTERM, signal.SIGHUP):
        try:
            signal.signal(sig, on_term)
        except (ValueError, OSError):      # not the main thread
            pass
    parent = os.getppid()

    def watch_parent():
        while True:
            time.sleep(2)
            if os.getppid() != parent:     # Nexus stopped without stopping us: we are orphans
                stop_children()
                if os.getpgrp() == os.getpid():    # our own group (Nexus starts us detached): ffmpeg…
                    os.killpg(os.getpid(), signal.SIGKILL)
                os._exit(1)
    threading.Thread(target=watch_parent, daemon=True).start()


_EMIT_LOCK = threading.Lock()


def emit(obj_type: str, **fields) -> None:
    out = _OUT or sys.stdout
    line = json.dumps({"type": obj_type, **fields}, ensure_ascii=False) + "\n"
    with _EMIT_LOCK:      # yt-dlp's stderr reader emits from another thread
        out.write(line)
        out.flush()


def fail(message: str, code: int = 1):
    emit("error", message=message, fatal=True)
    emit("done", ok=0, failed=1, skipped=0)
    sys.exit(code)


def parser(description: str) -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=description)
    p.add_argument("--json", action="store_true", help="JSON Lines output, no menu")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--search", metavar="REQUÊTE")
    g.add_argument("--details", metavar="ID")
    g.add_argument("--download", metavar="ID")
    g.add_argument("--refresh-catalogue", action="store_true", help="anisama: rebuild catalogue.json")
    p.add_argument("--episodes", metavar="1-12")
    p.add_argument("--chapters", metavar="1-50")
    p.add_argument("--season")
    p.add_argument("--lang", type=lambda s: s.upper())
    p.add_argument("--dest", metavar="DOSSIER")
    p.add_argument("--limit", type=int, default=0)
    return p


def parse_selection(text, available=None):
    """'1-12', '1,3,5', '2-4,8', 'all' -> sorted list of ints (limited to `available`)."""
    if text is None:
        return list(available or [])
    text = str(text).strip().lower()
    if text in ("all", "tout", "*", ""):
        return sorted(available) if available is not None else []
    out = set()
    for part in re.split(r"[,\s]+", text):
        if not part:
            continue
        m = re.fullmatch(r"(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)", part)
        if m:
            a, b = float(m.group(1)), float(m.group(2))
            if a > b:
                a, b = b, a
            if available is not None:
                out.update(x for x in available if a <= x <= b)
            else:
                out.update(range(int(a), int(b) + 1))
        elif re.fullmatch(r"\d+(?:\.\d+)?", part):
            v = float(part)
            out.add(int(v) if v.is_integer() else v)
        else:
            raise ValueError(f"sélection invalide : {part}")
    if available is not None:
        out = {x for x in out if x in set(available)}
    return sorted(out)


def env_value(name: str):
    """A setting from the environment, else from Nexus' backend/.env (interactive use)."""
    if os.environ.get(name):
        return os.environ[name]
    for f in (HERE.parent / "backend" / ".env", Path("/opt/nexus/backend/.env")):
        try:
            for line in f.read_text(encoding="utf-8").splitlines():
                m = re.match(r"\s*%s\s*=\s*(.*)$" % re.escape(name), line)
                if m:
                    return m.group(1).strip().strip('"').strip("'")
        except OSError:
            continue
    return None


def part_path(final: Path) -> Path:
    """Hidden temporary name next to the final file (not matched by 'ep001.*')."""
    final = Path(final)
    return final.with_name(".part-" + final.name)


def finish(part: Path, final: Path) -> bool:
    part, final = Path(part), Path(final)
    if part.exists() and part.stat().st_size > 0:
        os.replace(part, final)
        return True
    try:
        part.unlink()
    except OSError:
        pass
    return False


# ── Progress ──────────────────────────────────────────────────────────────────

def human_speed(bps) -> str:
    if not bps or bps <= 0:
        return ""
    for unit in ("B/s", "KB/s", "MB/s", "GB/s"):
        if bps < 1024 or unit == "GB/s":
            return f"{bps:.1f} {unit}" if unit != "B/s" else f"{int(bps)} B/s"
        bps /= 1024
    return ""


def human_eta(seconds) -> str:
    if seconds is None or seconds < 0 or seconds != seconds:
        return ""
    seconds = int(seconds)
    if seconds >= 3600:
        return f"{seconds // 3600}h{(seconds % 3600) // 60:02d}"
    if seconds >= 60:
        return f"{seconds // 60}m"
    return f"{seconds}s"


class Throttle:
    """Emit progress at most every `every` seconds (and always the last one)."""
    def __init__(self, every=0.7):
        self.every, self.last = every, 0.0

    def ready(self, force=False) -> bool:
        now = time.monotonic()
        if force or now - self.last >= self.every:
            self.last = now
            return True
        return False


def video_progress(item, done_bytes, total_bytes=None, speed=None, percent=None, eta=None, throttle=None, force=False):
    if throttle and not throttle.ready(force):
        return
    if percent is None and total_bytes:
        percent = done_bytes * 100 / total_bytes
    if eta is None and speed and total_bytes:
        eta = (total_bytes - done_bytes) / speed if speed > 0 else None
    emit("progress", item=item,
         percent=round(percent, 1) if percent is not None else None,
         downloaded_mb=round(done_bytes / 1048576, 1),
         total_mb=round(total_bytes / 1048576, 1) if total_bytes else None,
         speed=human_speed(speed), eta=human_eta(eta))


def probe_duration(url, headers_arg=None):
    """Duration (s) of a stream with ffprobe, or None."""
    cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1"]
    if headers_arg:
        cmd += ["-headers", headers_arg]
    cmd.append(url)
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=45)
        return float(r.stdout.strip().splitlines()[0])
    except Exception:
        return None


def ffmpeg_download(input_url, output, item, headers_arg=None, extra_before_input=()):
    """ffmpeg -i <m3u8> -c copy <output>, with progress lines. True when the file is written."""
    duration = probe_duration(input_url, headers_arg)
    cmd = ["ffmpeg", "-hide_banner", "-nostats", "-loglevel", "error", "-y"]
    if headers_arg:
        cmd += ["-headers", headers_arg]
    cmd += list(extra_before_input)
    cmd += ["-i", input_url, "-c", "copy", "-progress", "pipe:1", "-f", "mp4", str(output)]
    t0 = time.monotonic()
    throttle = Throttle()
    out_time = 0.0
    size = 0
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=sys.stderr, text=True)
    except FileNotFoundError:
        emit("error", message="ffmpeg n'est pas installé", item=item, fatal=False)
        return False
    for line in proc.stdout:
        key, _, val = line.strip().partition("=")
        if key in ("out_time_us", "out_time_ms"):
            try:
                out_time = int(val) / 1_000_000
            except ValueError:
                pass
        elif key == "total_size":
            try:
                size = int(val)
            except ValueError:
                pass
        elif key == "progress":
            elapsed = max(time.monotonic() - t0, 0.001)
            speed = size / elapsed
            pct = out_time * 100 / duration if duration else None
            total = size * duration / out_time if duration and out_time > 1 else None
            eta = (duration - out_time) * elapsed / out_time if duration and out_time > 1 else None
            video_progress(item, size, total, speed, pct, eta, throttle, force=(val == "end"))
    proc.wait()
    return proc.returncode == 0 and Path(output).exists() and Path(output).stat().st_size > 0


def http_download(session, url, output, item, headers=None, timeout=30):
    """Plain HTTP download with progress. True when complete."""
    throttle = Throttle()
    try:
        r = session.get(url, headers=headers, stream=True, timeout=timeout)
        if r.status_code >= 400:
            return False
        total = int(r.headers.get("content-length", 0)) or None
        done, t0 = 0, time.monotonic()
        with open(output, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 256):
                if chunk:
                    f.write(chunk)
                    done += len(chunk)
                    speed = done / max(time.monotonic() - t0, 0.001)
                    video_progress(item, done, total, speed, throttle=throttle)
        video_progress(item, done, total or done, None, percent=100, force=True)
        return done > 0 and (total is None or done >= total)
    except Exception as e:
        print(f"http_download: {e}")
        return False


NXP = "NXP|"   # marker of yt-dlp progress lines

NXPP = "NXPP|"  # marker of yt-dlp post-processing lines (merge, thumbnail, metadata…)

YTDLP_PROGRESS = [
    "--newline", "--progress",
    "--progress-template",
    "download:" + NXP + "%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s",
    # Printed even when --print makes yt-dlp quiet (no « [Merger] » line then): tells when
    # the download is over and the long, silent merge of image and sound runs
    "--progress-template", "postprocess:" + NXPP + "%(progress.status)s|%(progress.postprocessor)s",
]


_js_args = None


def ytdlp_cmd():
    """yt-dlp with a JavaScript runtime it can use: YouTube's protections need one (else
    « HTTP Error 403 » / missing formats). deno is yt-dlp's default; when it is not
    installed, Node.js (usually there) is enabled. Only with a yt-dlp that knows the option."""
    global _js_args
    if _js_args is None:
        _js_args = []
        import shutil
        if not shutil.which("deno") and shutil.which("node"):
            try:
                help_text = subprocess.run(["yt-dlp", "--help"], capture_output=True, text=True, timeout=30).stdout
                if "--js-runtimes" in help_text:
                    _js_args = ["--js-runtimes", "node"]
            except (OSError, subprocess.SubprocessError):
                pass
    return ["yt-dlp", *_js_args]


# Last « ERROR: … » line of the last yt-dlp run (shown to the owner instead of a bare failure)
last_ytdlp_error = None

# yt-dlp's usual errors, in plain French
_YTDLP_ERRORS = [
    (r"sign in to confirm (you.re not a bot|your age)", "YouTube demande de prouver qu'on n'est pas un robot (le serveur est bloqué par YouTube)"),
    (r"private video", "Vidéo privée"),
    (r"video unavailable|this video is not available|has been removed", "Vidéo indisponible ou supprimée"),
    (r"members.only|join this channel", "Vidéo réservée aux membres de la chaîne"),
    (r"premieres in|live event will begin|this live event", "La vidéo n'est pas encore sortie (première ou direct à venir)"),
    (r"requested format is not available|no video formats found", "Aucun format téléchargeable (yt-dlp est sans doute trop ancien)"),
    (r"http error 403|forbidden", "YouTube refuse le téléchargement (403) — yt-dlp est sans doute trop ancien"),
    (r"nsig|signature extraction failed|unable to extract|javascript runtime|js runtime", "yt-dlp ne sait plus lire YouTube — il faut le mettre à jour"),
    (r"ffmpeg|ffprobe", "ffmpeg manque ou a échoué (assemblage de la vidéo)"),
    (r"no space left", "Plus de place sur le disque"),
]


def ytdlp_reason(line):
    """« ERROR: [youtube] abc: Sign in to confirm you're not a bot… » → a short French reason."""
    if not line:
        return None
    text = re.sub(r"^ERROR:\s*(\[[^\]]+\]\s*)?([A-Za-z0-9_-]{11}:\s*)?", "", line.strip())
    for pattern, reason in _YTDLP_ERRORS:
        if re.search(pattern, text, re.I):
            return reason
    return text[:200]


# A dead connection makes yt-dlp give up (and retry) instead of waiting forever
YTDLP_NETWORK = ["--socket-timeout", "15", "--retries", "10", "--fragment-retries", "10"]
STALL_SECONDS = 15     # no data for this long while downloading: yt-dlp is restarted (it resumes)
STALL_RESTARTS = 10


def ytdlp_run(args, item, on_line=None, stall_seconds=None):
    """Runs yt-dlp with progress lines. Returns (returncode, other stdout lines).
    Its error output still goes to the log; the last ERROR line is kept in last_ytdlp_error.
    A download that stops receiving data (YouTube sometimes just stops sending) is
    restarted, like a pause / resume by hand: yt-dlp continues the partial file."""
    stall = STALL_SECONDS if stall_seconds is None else stall_seconds
    global last_ytdlp_error
    for attempt in range(STALL_RESTARTS + 1):
        code, others, stalled = _ytdlp_once(args, item, on_line, stall)
        if not stalled:
            return code, others
        if attempt < STALL_RESTARTS:
            print(f"yt-dlp: no data for {stall} s, restart {attempt + 1}/{STALL_RESTARTS}")
    last_ytdlp_error = f"YouTube n'envoie plus rien ({STALL_RESTARTS} relances)"
    return code, others


def _ytdlp_once(args, item, on_line, stall):
    global last_ytdlp_error
    last_ytdlp_error = None
    cmd = [*ytdlp_cmd(), *YTDLP_PROGRESS, *YTDLP_NETWORK, *args]
    try:
        # Own process group: a stalled yt-dlp is stopped with its children (ffmpeg…)
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
    except FileNotFoundError:
        emit("error", message="yt-dlp n'est pas installé", item=item, fatal=False)
        return 127, [], False
    _CHILD_GROUPS.add(proc.pid)
    try:
        return _ytdlp_follow(proc, item, on_line, stall)
    finally:
        _CHILD_GROUPS.discard(proc.pid)


def _ytdlp_follow(proc, item, on_line, stall):
    global last_ytdlp_error
    throttle = Throttle()
    others = []
    # Watchdog: only while data is being downloaded (merging / embedding prints nothing for a while)
    state = {"last": time.monotonic(), "downloading": False, "stalled": False, "merging": False}

    def watchdog():
        while proc.poll() is None:
            time.sleep(1)
            if state["downloading"] and time.monotonic() - state["last"] > stall:
                state["stalled"] = True
                try:
                    os.killpg(proc.pid, 9)
                except OSError:
                    proc.kill()
                return
    threading.Thread(target=watchdog, daemon=True).start()

    tail = {"line": None}

    def post_processing(line):
        # Post-processing (merge, thumbnail…): nothing is downloaded any more, the long
        # silent merge of a big video must not be taken for a stall
        state["last"] = time.monotonic()
        state["downloading"] = False
        status, _, pp = line[len(NXPP):].strip().partition("|")
        if pp == "Merger":
            # stdout and stderr are read by two threads: a progress line read after this one
            # must not turn the watchdog back on while the (silent) merge runs
            state["merging"] = status == "started"
            if status == "started":
                emit("progress", item="Assemblage de l'image et du son…", percent=100)

    def read_errors():
        global last_ytdlp_error
        for err in proc.stderr:
            if err.startswith(NXPP):       # yt-dlp writes post-processing progress on stderr
                post_processing(err)
                continue
            sys.stderr.write(err)
            if err.startswith("ERROR"):
                last_ytdlp_error = err.strip()
            elif err.strip() and not err.startswith("WARNING"):
                tail["line"] = err.strip()      # « yt-dlp: error: … », a Python traceback's last line…
    reader = threading.Thread(target=read_errors, daemon=True)
    reader.start()
    num = lambda v: float(v) if v not in (None, "", "NA", "None") else None
    for line in proc.stdout:
        line = line.rstrip("\n")
        state["last"] = time.monotonic()
        if line.startswith(NXPP):        # (yt-dlp prints them on stderr; handled there too)
            post_processing(line)
            continue
        state["downloading"] = line.startswith(NXP) and not state["merging"]
        if line.startswith(NXP):
            parts = line[len(NXP):].split("|")
            if len(parts) >= 5:
                done, total, estimate, speed, eta = (num(x) for x in parts[:5])
                if total and done is not None and done >= total:
                    state["downloading"] = False      # this file is complete: what follows is not a stall
                video_progress(item, done or 0, total or estimate, speed, eta=eta, throttle=throttle)
        elif line:
            if line.startswith("[Merger]"):
                # Merging a big video takes a while with no progress: say so (do not pause it!)
                emit("progress", item="Assemblage de l'image et du son…", percent=100)
            others.append(line)
            if on_line:
                on_line(line)
            print(line)
    proc.wait()
    reader.join(timeout=5)
    if proc.returncode and not last_ytdlp_error:
        # Failed without an « ERROR: » line: keep what it said last, else its exit code
        last_ytdlp_error = tail["line"] or f"yt-dlp s'est arrêté (code {proc.returncode})"
    return proc.returncode, others, state["stalled"]


# ── Series folders ────────────────────────────────────────────────────────────

def norm_title(text: str) -> str:
    """« Georgie_&_Mandy's_First_Marriage » == « Georgie & Mandy's First Marriage »:
    no accents, case, spaces, underscores or punctuation."""
    import unicodedata
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", "", text)


# Where a torrent's name stops being the title: « Georgie.and.Mandys.First.Marriage.S02.1080p… »
_RELEASE_TAIL = re.compile(
    r"(?i)(?:^|[\s._\-\[(])(?:s\d{1,2}(?:e\d{1,3})?|saisons?[\s._]*\d+|seasons?[\s._]*\d+|(?:19|20)\d{2}|\d{3,4}p|"
    r"complete|integrale|intégrale|multi|truefrench|french|vff|vostfr|webrip|web-?dl|bluray|hdtv)(?=$|[\s._\-\])])")


def release_title(name: str) -> str:
    """Title part of a folder name: « Georgie.and.Mandys.First.Marriage.S02.1080p » → « Georgie and Mandys First Marriage »."""
    m = _RELEASE_TAIL.search(name or "")
    head = name[:m.start()] if m and m.start() > 0 else (name or "")
    return re.sub(r"[._]+", " ", head).strip(" -")


def _hint_tmdb(folder: Path):
    try:
        hint = json.loads((folder / ".nexus.json").read_text(encoding="utf-8"))
        return int(hint["tmdb_id"]) if hint.get("tmdb_id") is not None else None
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _files(folder: Path):
    """Files of a series folder that can be moved (not the ones still being written)."""
    return [p for p in folder.rglob("*") if p.is_file() and p.name != ".nexus.json"
            and not p.name.startswith(".part-") and not any(s.startswith(".part-") for s in p.relative_to(folder).parts[:-1])]


def series_folder(dest, title: str, default_name: str, tmdb_id=None) -> Path:
    """The folder of this series in `dest`, whatever downloaded it first.

    Each script names folders its own way (movix « Titre_avec_underscores »,
    OxTorrent « Titre avec espaces »), and TMDB's French title can change between
    two downloads: an automatic download then made a second folder, so the library
    showed the series twice. The folder already there for this series — same TMDB
    id in its .nexus.json, or same name once spaces / punctuation are ignored (and
    no other TMDB id) — is used; when there are several, the others are merged
    into the one with the most files."""
    dest = Path(dest)
    default = dest / default_name
    names = {norm_title(title), norm_title(default_name)} - {""}
    matches = []
    try:
        entries = sorted(dest.iterdir())
    except OSError:
        entries = []
    for d in entries:
        if not d.is_dir() or d.name.startswith("."):
            continue
        tid = _hint_tmdb(d)
        same_name = norm_title(d.name) in names or norm_title(release_title(d.name)) in names
        if (tmdb_id and tid == int(tmdb_id)) or (same_name and (not tmdb_id or tid in (None, int(tmdb_id)))):
            matches.append(d)
    if not matches:
        return default
    # Keep a folder named after the series (not a torrent's release name), then the fullest one
    target = max(matches, key=lambda d: (release_title(d.name) == d.name.replace("_", " ").strip(), len(_files(d)), d == default))
    for other in matches:
        if other == target:
            continue
        for f in _files(other):
            to = target / f.relative_to(other)
            if to.exists():
                continue
            try:
                to.parent.mkdir(parents=True, exist_ok=True)
                f.replace(to)
            except OSError as e:
                print(f"series merge: {e}")
        if not _files(other):
            (other / ".nexus.json").unlink(missing_ok=True)
            for sub in sorted((p for p in other.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
                try:
                    sub.rmdir()
                except OSError:
                    pass
            try:
                other.rmdir()
            except OSError:
                pass
    return target
