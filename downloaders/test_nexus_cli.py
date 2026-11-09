"""Tests of the shared --json helpers (no network). Run: python3 -m unittest discover downloaders"""
import io
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import nexus_cli  # noqa: E402


class Selection(unittest.TestCase):
    def test_ranges_and_lists(self):
        self.assertEqual(nexus_cli.parse_selection("1-3"), [1, 2, 3])
        self.assertEqual(nexus_cli.parse_selection("3,5-6"), [3, 5, 6])
        self.assertEqual(nexus_cli.parse_selection("5-3"), [3, 4, 5])

    def test_limited_to_available(self):
        self.assertEqual(nexus_cli.parse_selection("2-4", [1, 2, 3, 10]), [2, 3])
        self.assertEqual(nexus_cli.parse_selection("all", [3, 1, 2]), [1, 2, 3])
        self.assertEqual(nexus_cli.parse_selection(None, [1, 2]), [1, 2])

    def test_rejects_anything_else(self):
        for bad in ("1;rm -rf /", "$(id)", "1-", "abc"):
            with self.assertRaises(ValueError):
                nexus_cli.parse_selection(bad)


class Files(unittest.TestCase):
    def test_part_name_is_hidden_and_not_matched_by_episode_glob(self):
        with tempfile.TemporaryDirectory() as d:
            final = Path(d) / "ep001.mp4"
            part = nexus_cli.part_path(final)
            self.assertEqual(part.name, ".part-ep001.mp4")
            part.write_bytes(b"x")
            self.assertEqual(list(Path(d).glob("ep001.*")), [])
            self.assertTrue(nexus_cli.finish(part, final))
            self.assertTrue(final.exists() and not part.exists())

    def test_empty_part_is_not_kept(self):
        with tempfile.TemporaryDirectory() as d:
            final = Path(d) / "a.mp4"
            part = nexus_cli.part_path(final)
            part.write_bytes(b"")
            self.assertFalse(nexus_cli.finish(part, final))
            self.assertFalse(final.exists() or part.exists())


class Output(unittest.TestCase):
    def test_emit_writes_one_json_object_per_line(self):
        buf = io.StringIO()
        old = nexus_cli._OUT
        nexus_cli._OUT = buf
        try:
            nexus_cli.emit("progress", percent=42, speed="3.1 MB/s")
            nexus_cli.emit("done")
        finally:
            nexus_cli._OUT = old
        lines = [json.loads(line) for line in buf.getvalue().splitlines()]
        self.assertEqual(lines, [{"type": "progress", "percent": 42, "speed": "3.1 MB/s"}, {"type": "done"}])

    def test_human_units(self):
        self.assertEqual(nexus_cli.human_speed(3.1 * 1048576), "3.1 MB/s")
        self.assertEqual(nexus_cli.human_eta(125), "2m")
        self.assertEqual(nexus_cli.human_eta(3700), "1h01")


class SeriesFolder(unittest.TestCase):
    """One folder per series, whatever downloaded it (movix, OxTorrent, automatic downloads)."""
    OX = "Georgie & Mandy's First Marriage"
    MOVIX = "Georgie_&_Mandy's_First_Marriage"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def put(self, *parts, hint=None):
        f = self.root.joinpath(*parts)
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"x")
        if hint is not None:
            (self.root / parts[0] / ".nexus.json").write_text(json.dumps({"tmdb_id": hint}))
        return f

    def folder(self, title=OX, default=MOVIX, tmdb=258854):
        return nexus_cli.series_folder(self.root, title, default, tmdb)

    def test_new_series(self):
        self.assertEqual(self.folder(), self.root / self.MOVIX)

    def test_same_name_other_spelling(self):
        self.put(self.OX, "Season 1", "S01E01.mkv")
        self.assertEqual(self.folder(), self.root / self.OX)

    def test_second_folder_is_merged(self):
        self.put(self.OX, "S01", "S01E01.mkv", hint=258854)
        self.put(self.OX, "S01", "S01E02.mkv")
        self.put(self.MOVIX, "VF", "Saison_1", "Episode_3.mp4", hint=258854)
        self.assertEqual(self.folder(), self.root / self.OX)
        self.assertTrue((self.root / self.OX / "VF" / "Saison_1" / "Episode_3.mp4").exists())
        self.assertFalse((self.root / self.MOVIX).exists())
        self.assertEqual(self.folder(), self.root / self.OX)       # nothing left to merge

    def test_french_title_changed(self):
        self.put("Georgie & Mandy : leur premier mariage", "VF", "Saison_1", "e1.mp4", hint=258854)
        self.assertEqual(self.folder(), self.root / "Georgie & Mandy : leur premier mariage")

    def test_other_series_with_the_same_name(self):
        self.put(self.OX, "S01E01.mkv", hint=1)
        self.assertEqual(self.folder(), self.root / self.MOVIX)

    def test_file_being_written_is_left_alone(self):
        self.put(self.OX, "S01E01.mkv", hint=258854)
        self.put(self.OX, "S01E02.mkv")
        part = self.put(self.MOVIX, "VF", "Saison_1", ".part-e3.mp4")
        self.assertEqual(self.folder(), self.root / self.OX)
        self.assertTrue(part.exists())

    def test_torrent_release_folder(self):
        # The owner's server: a torrent folder at the root of /media/series, no .nexus.json
        rel = "Georgie.and.Mandys.First.Marriage.S02.MULTI.1080p.WEB.x264"
        for n in (1, 2, 3):
            self.put(rel, f"Georgie.and.Mandys.First.Marriage.S02E0{n}.mkv")
        self.put(self.MOVIX, "VF", "Saison_2", "Episode_22.mp4", hint=258854)
        self.assertEqual(self.folder(), self.root / self.MOVIX)          # named after the series: kept
        self.assertTrue((self.root / self.MOVIX / "Georgie.and.Mandys.First.Marriage.S02E01.mkv").exists())
        self.assertFalse((self.root / rel).exists())

    def test_release_title(self):
        rt = nexus_cli.release_title
        self.assertEqual(rt("Georgie.and.Mandys.First.Marriage.S02.MULTI.1080p"), "Georgie and Mandys First Marriage")
        self.assertEqual(rt("The.Office.US.Saison.3.FRENCH"), "The Office US")
        self.assertEqual(rt("Severance (2022)"), "Severance")
        self.assertEqual(rt("Georgie_&_Mandy's_First_Marriage"), "Georgie & Mandy's First Marriage")
        self.assertEqual(rt("1923"), "1923")

    def test_norm_title(self):
        self.assertEqual(nexus_cli.norm_title(self.OX), nexus_cli.norm_title(self.MOVIX))
        self.assertEqual(nexus_cli.norm_title("Élite"), nexus_cli.norm_title("elite"))


class YtdlpErrors(unittest.TestCase):
    """The owner sees why a YouTube download failed, not just « impossible »."""

    def test_reasons(self):
        r = nexus_cli.ytdlp_reason
        self.assertIn("robot", r("ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you’re not a bot. Use --cookies-from-browser"))
        self.assertIn("robot", r("ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you're not a bot"))
        self.assertEqual(r("ERROR: [youtube] dQw4w9WgXcQ: Private video. Sign in if you've been granted access"), "Vidéo privée")
        self.assertIn("mettre à jour", r("ERROR: [youtube] abc: nsig extraction failed: Some formats may be missing"))
        self.assertIn("trop ancien", r("ERROR: [youtube] abc: Requested format is not available"))
        self.assertEqual(r("ERROR: [youtube] dQw4w9WgXcQ: Something new"), "Something new")
        self.assertIsNone(r(None))

    def test_last_error_is_kept(self):
        with tempfile.TemporaryDirectory() as d:
            fake = Path(d) / "yt-dlp"
            fake.write_text("#!/bin/sh\necho 'WARNING: x' >&2\necho 'ERROR: [youtube] dQw4w9WgXcQ: Video unavailable' >&2\nexit 1\n")
            fake.chmod(0o755)
            old = os.environ["PATH"]
            os.environ["PATH"] = f"{d}:{old}"
            err = sys.stderr
            sys.stderr = io.StringIO()
            try:
                code, _ = nexus_cli.ytdlp_run(["https://youtu.be/dQw4w9WgXcQ"], "x")
            finally:
                os.environ["PATH"] = old
                logged, sys.stderr = sys.stderr.getvalue(), err
        self.assertEqual(code, 1)
        self.assertEqual(nexus_cli.ytdlp_reason(nexus_cli.last_ytdlp_error), "Vidéo indisponible ou supprimée")
        self.assertIn("WARNING: x", logged)   # still in the log

    def test_failure_without_error_line(self):
        with tempfile.TemporaryDirectory() as d:
            fake = Path(d) / "yt-dlp"
            fake.write_text("#!/bin/sh\ncase \"$*\" in *--help*) exit 0;; esac\n"
                            "echo 'Usage: yt-dlp [OPTIONS] URL' >&2\necho 'yt-dlp: error: no such option: --foo' >&2\nexit 2\n")
            fake.chmod(0o755)
            old = os.environ["PATH"]
            os.environ["PATH"] = f"{d}:/usr/bin:/bin"
            nexus_cli._js_args = None
            err, sys.stderr = sys.stderr, io.StringIO()
            try:
                code, _ = nexus_cli.ytdlp_run(["x"], "x")
            finally:
                os.environ["PATH"] = old
                nexus_cli._js_args = None
                sys.stderr = err
        self.assertEqual(code, 2)
        self.assertEqual(nexus_cli.ytdlp_reason(nexus_cli.last_ytdlp_error), "yt-dlp: error: no such option: --foo")


class YtdlpJsRuntime(unittest.TestCase):
    """No deno on the owner's server: yt-dlp is told to use Node.js (YouTube needs a JS runtime)."""

    def run_with(self, files, help_text):
        with tempfile.TemporaryDirectory() as d:
            for name in files:
                p = Path(d) / name
                p.write_text("#!/bin/sh\nexit 0\n")
                p.chmod(0o755)
            fake = Path(d) / "yt-dlp"
            fake.write_text(f"#!/bin/sh\necho '{help_text}'\n")
            fake.chmod(0o755)
            old = os.environ["PATH"]
            os.environ["PATH"] = d
            nexus_cli._js_args = None
            try:
                return nexus_cli.ytdlp_cmd()
            finally:
                os.environ["PATH"] = old
                nexus_cli._js_args = None

    def test_node_when_no_deno(self):
        self.assertEqual(self.run_with(["node"], "--js-runtimes RUNTIME"), ["yt-dlp", "--js-runtimes", "node"])

    def test_deno_is_the_default(self):
        self.assertEqual(self.run_with(["node", "deno"], "--js-runtimes RUNTIME"), ["yt-dlp"])

    def test_old_ytdlp_without_the_option(self):
        self.assertEqual(self.run_with(["node"], "--format FORMAT"), ["yt-dlp"])


class YtdlpStall(unittest.TestCase):
    """A download that stops receiving data is restarted by itself (like a pause / resume)."""

    def test_restarted_after_a_stall(self):
        with tempfile.TemporaryDirectory() as d:
            count = Path(d) / "runs"
            fake = Path(d) / "yt-dlp"
            # 1st run: some progress then silence (stalled); 2nd run: finishes
            fake.write_text(
                "#!/bin/sh\n"
                f"n=$(cat {count} 2>/dev/null || echo 0); n=$((n+1)); echo $n > {count}\n"
                "case \"$*\" in *--help*) exit 0;; esac\n"
                "echo 'NXP|100|1000|1000|10|5'\n"
                f"if [ $n -le 2 ]; then sleep 30; fi\n"
                "echo 'NXP|1000|1000|1000|10|0'\necho 'NXFILE|/x.mp4'\nexit 0\n")
            fake.chmod(0o755)
            old = os.environ["PATH"]
            os.environ["PATH"] = f"{d}:/usr/bin:/bin"
            nexus_cli._js_args = None
            out, err = sys.stdout, sys.stderr
            sys.stdout, sys.stderr = io.StringIO(), io.StringIO()
            try:
                started = time.monotonic()
                code, lines = nexus_cli.ytdlp_run(["x"], "x", stall_seconds=2)
                took = time.monotonic() - started
            finally:
                os.environ["PATH"] = old
                nexus_cli._js_args = None
                sys.stdout, sys.stderr = out, err
            runs = int(count.read_text())
        self.assertEqual(code, 0)
        self.assertIn("NXFILE|/x.mp4", lines)
        self.assertLess(took, 20)          # did not wait for the 30 s sleep
        self.assertGreaterEqual(runs, 2)   # restarted

    def run_fake(self, script, stall):
        with tempfile.TemporaryDirectory() as d:
            count = Path(d) / "runs"
            fake = Path(d) / "yt-dlp"
            fake.write_text("#!/bin/sh\ncase \"$*\" in *--help*) exit 0;; esac\n"
                            f"n=$(cat {count} 2>/dev/null || echo 0); echo $((n+1)) > {count}\n" + script)
            fake.chmod(0o755)
            old = os.environ["PATH"]
            os.environ["PATH"] = f"{d}:/usr/bin:/bin"
            nexus_cli._js_args = None
            out, err = sys.stdout, sys.stderr
            sys.stdout, sys.stderr = io.StringIO(), io.StringIO()
            try:
                code, lines = nexus_cli.ytdlp_run(["x"], "x", stall_seconds=stall)
                emitted = sys.stdout.getvalue()
            finally:
                os.environ["PATH"] = old
                nexus_cli._js_args = None
                sys.stdout, sys.stderr = out, err
            return code, lines, int(count.read_text()), emitted

    def test_the_silent_merge_is_not_a_stall(self):
        # The owner's server: --print makes yt-dlp quiet, the merge of a big video prints nothing for
        # minutes on stdout; the post-processing progress goes to stderr (checked there)
        code, lines, runs, emitted = self.run_fake(
            # On a restart the streams are already there: progress without a total (as on the server)
            "echo 'NXP|500|NA|NA|10|5'\n"
            "echo 'NXPP|started|Merger' >&2\nsleep 4\necho 'NXPP|finished|Merger' >&2\necho 'NXFILE|/x.mp4'\n", stall=2)
        self.assertEqual((code, runs), (0, 1))          # never restarted
        self.assertIn("NXFILE|/x.mp4", lines)
        self.assertIn("Assemblage", emitted)

    def test_merge_read_before_the_last_progress_line(self):
        # The CI runner: stderr (merge started) was read before the last stdout progress line
        code, _, runs, _ = self.run_fake(
            "echo 'NXPP|started|Merger' >&2\nsleep 0.3\necho 'NXP|500|NA|NA|10|5'\nsleep 4\n"
            "echo 'NXPP|finished|Merger' >&2\necho 'NXFILE|/x.mp4'\n", stall=2)
        self.assertEqual((code, runs), (0, 1))

    def test_a_finished_file_waiting_is_not_a_stall(self):
        code, _, runs, _ = self.run_fake("echo 'NXP|1000|1000|1000|10|0'\nsleep 4\necho 'NXFILE|/x.mp4'\n", stall=2)
        self.assertEqual((code, runs), (0, 1))

    def test_gives_up_with_a_reason(self):
        old = nexus_cli.STALL_RESTARTS
        nexus_cli.STALL_RESTARTS = 1
        try:
            code, _, runs, _ = self.run_fake("echo 'NXP|10|1000|1000|10|5'\nsleep 30\n", stall=1)
        finally:
            nexus_cli.STALL_RESTARTS = old
        self.assertEqual(runs, 2)
        self.assertIn("n'envoie plus rien", nexus_cli.ytdlp_reason(nexus_cli.last_ytdlp_error))


def _alive(pid):
    try:
        with open(f"/proc/{pid}/stat") as f:
            return f.read().rsplit(")", 1)[1].split()[0] != "Z"
    except OSError:
        return False


@unittest.skipUnless(os.path.isdir("/proc"), "Linux only")
class StopWithNexus(unittest.TestCase):
    """The owner's server: after a deployment, the old download went on (yt-dlp in its own
    process group) while the queue started it again: two ffmpeg on the same file."""

    def start(self, d, via_parent=False):
        pidfile = Path(d) / "ytdlp.pid"
        fake = Path(d) / "yt-dlp"
        fake.write_text("#!/bin/sh\ncase \"$*\" in *--help*) exit 0;; esac\n"
                        f"echo $$ > {pidfile}\nexec sleep 60\n")
        fake.chmod(0o755)
        runner = Path(d) / "runner.py"
        runner.write_text(f"import sys\nsys.path.insert(0, {HERE!r})\nimport nexus_cli\nnexus_cli.early_json()\n"
                          "nexus_cli.ytdlp_run(['x'], 'x')\n")
        env = {**os.environ, "PATH": f"{d}:/usr/bin:/bin"}
        if via_parent:
            # A stand-in for Nexus that dies without stopping anything (SIGKILL, crash)
            parent = Path(d) / "parent.py"
            parent.write_text("import subprocess, sys, time\n"
                              f"p = subprocess.Popen([sys.executable, {str(runner)!r}, '--json'], start_new_session=True, "
                              "stdout=subprocess.DEVNULL)\nprint(p.pid, flush=True)\ntime.sleep(60)\n")
            proc = subprocess.Popen([sys.executable, str(parent)], env=env, stdout=subprocess.PIPE, text=True)
        else:
            proc = subprocess.Popen([sys.executable, str(runner), "--json"], env=env, start_new_session=True,
                                    stdout=subprocess.DEVNULL)
        for _ in range(100):
            if pidfile.exists() and pidfile.read_text().strip():
                break
            time.sleep(0.1)
        return proc, int(pidfile.read_text())

    def gone(self, pid, seconds):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if not _alive(pid):
                return True
            time.sleep(0.2)
        return False

    def test_pause_stops_yt_dlp_too(self):
        with tempfile.TemporaryDirectory() as d:
            proc, ytdlp = self.start(d)
            try:
                os.killpg(proc.pid, signal.SIGTERM)       # what Nexus does for a pause / cancel
                proc.wait(timeout=10)
                self.assertTrue(self.gone(ytdlp, 5))
            finally:
                if _alive(ytdlp):
                    try:
                        os.kill(ytdlp, signal.SIGKILL)
                    except ProcessLookupError:      # it ended in between: the assertion above tells why
                        pass

    def test_stops_when_nexus_is_gone(self):
        with tempfile.TemporaryDirectory() as d:
            parent, ytdlp = self.start(d, via_parent=True)
            script = int(parent.stdout.readline())
            try:
                parent.kill()
                parent.wait()
                self.assertTrue(self.gone(ytdlp, 10))
                self.assertTrue(self.gone(script, 5))
            finally:
                for pid in (ytdlp, script):
                    if _alive(pid):
                        os.kill(pid, signal.SIGKILL)


class HlsPlaylists(unittest.TestCase):
    def test_master_takes_the_best_variant(self):
        text = ("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nlow/index.m3u8\n"
                "#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080\nhigh/index.m3u8\n")
        self.assertEqual(nexus_cli.hls_parse_master(text, "https://cdn.x/v/master.m3u8"),
                         ("https://cdn.x/v/high/index.m3u8", None))

    def test_master_with_separate_audio_says_so(self):
        text = ('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="fr",URI="fr.m3u8"\n'
                '#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO="aud"\nv.m3u8\n')
        self.assertEqual(nexus_cli.hls_parse_master(text, "https://h/m.m3u8"), ("https://h/v.m3u8", "aud"))

    def test_media_playlist_is_rewritten_to_local_files(self):
        text = ('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-KEY:METHOD=AES-128,URI="/k/key",IV=0x1\n'
                '#EXTINF:6.0,\nseg-1.ts?t=a\n#EXTINF:6.0,\nhttps://other/seg-2.png\n#EXT-X-ENDLIST\n')
        entries, reason = nexus_cli.hls_parse_media(text, "https://cdn.x/v/index.m3u8")
        self.assertIsNone(reason)
        self.assertEqual(nexus_cli._hls_files(entries), [
            ("key1.bin", "https://cdn.x/k/key"), ("seg00001.ts", "https://cdn.x/v/seg-1.ts?t=a"),
            ("seg00002.ts", "https://other/seg-2.png")])
        local = nexus_cli.hls_local_playlist(entries)
        self.assertIn('#EXT-X-KEY:METHOD=AES-128,URI="key1.bin",IV=0x1', local)
        self.assertIn("seg00001.ts\n#EXTINF:6.0,\nseg00002.ts", local)
        self.assertNotIn("cdn.x", local)

    def test_what_is_left_to_ffmpeg(self):
        self.assertEqual(nexus_cli.hls_parse_media("#EXTM3U\n#EXTINF:6,\na.ts\n", "https://h/")[1], "live")
        self.assertEqual(nexus_cli.hls_parse_media(
            "#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"k\"\n#EXTINF:6,\na.ts\n#EXT-X-ENDLIST\n", "https://h/")[1],
            "chiffrement SAMPLE-AES")
        self.assertEqual(nexus_cli.hls_parse_media(
            "#EXTM3U\n#EXT-X-BYTERANGE:100@0\n#EXTINF:6,\na.ts\n#EXT-X-ENDLIST\n", "https://h/")[1], "byterange")


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg needed")
class HlsDownload(unittest.TestCase):
    """A real HLS stream made by ffmpeg, served by a local HTTP server that checks the Referer."""

    @classmethod
    def setUpClass(cls):
        import functools
        import http.server
        import threading
        cls.root = tempfile.mkdtemp()
        cls.hits = []
        root = cls.root
        for name, extra in (("plain", []), ("crypt", ["-hls_key_info_file", "keyinfo"])):
            d = Path(root, name)
            d.mkdir()
            if extra:
                (d / "enc.key").write_bytes(bytes(range(16)))
                (d / "keyinfo").write_text("/crypt/enc.key\nenc.key\n")
            subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=10",
                            "-f", "lavfi", "-i", "sine=frequency=440", "-t", "12", "-c:v", "libx264", "-g", "10",
                            "-c:a", "aac", "-f", "hls", "-hls_time", "1", "-hls_playlist_type", "vod", *extra,
                            "-hls_segment_filename", "s%03d.ts", "index.m3u8"], cwd=d, check=True)
            (d / "master.m3u8").write_text("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nindex.m3u8\n")

        class Handler(http.server.SimpleHTTPRequestHandler):
            def do_GET(self):
                cls.hits.append(self.path)
                if self.headers.get("Referer") != "https://player.example/":
                    self.send_error(403)
                    return
                super().do_GET()

            def log_message(self, *a):
                pass
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=root))
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        shutil.rmtree(cls.root, ignore_errors=True)

    def download(self, path, headers={"Referer": "https://player.example/"}, out=None):
        out = out or Path(tempfile.mkdtemp(dir=self.root), ".part-film.mp4")
        buf = io.StringIO()
        old, nexus_cli._OUT = nexus_cli._OUT, buf
        try:
            res = nexus_cli.hls_download(self.base + path, out, "Film", headers, workers=4)
        finally:
            nexus_cli._OUT = old
        return res, out, [json.loads(l) for l in buf.getvalue().splitlines()]

    def duration(self, f):
        return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(f)],
                                    capture_output=True, text=True).stdout)

    def test_plain_stream_through_master(self):
        res, out, lines = self.download("/plain/master.m3u8")
        self.assertTrue(res)
        self.assertAlmostEqual(self.duration(out), 12, delta=0.6)
        self.assertEqual([p for p in out.parent.iterdir()], [out])   # segments folder removed
        progress = [l for l in lines if l["type"] == "progress" and l["item"] == "Film"]
        self.assertEqual(progress[-1]["percent"], 100.0)

    def test_aes128_stream(self):
        res, out, _ = self.download("/crypt/index.m3u8")
        self.assertTrue(res)
        self.assertAlmostEqual(self.duration(out), 12, delta=0.6)

    def test_refused_stream_and_direct_file_are_left_to_ffmpeg(self):
        self.assertIsNone(self.download("/plain/master.m3u8", headers={})[0])
        self.assertIsNone(self.download("/plain/s000.ts")[0])

    def test_failed_segment_is_a_failure_and_the_rest_is_kept_for_next_time(self):
        d = Path(self.root, "plain")
        (d / "s005.ts").rename(d / "s005.bak")
        orig, nexus_cli.HLS_RETRIES = nexus_cli.HLS_RETRIES, 1
        try:
            res, out, _ = self.download("/plain/index.m3u8")
            self.assertFalse(res)
            kept = {p.name for p in out.with_name(".hls-part-film.mp4").iterdir()}
            self.assertIn("seg00001.ts", kept)
            self.assertNotIn("seg00006.ts", kept)
        finally:
            nexus_cli.HLS_RETRIES = orig
            (d / "s005.bak").rename(d / "s005.ts")
        # Next try (after a pause, or the next source): only the missing segments are fetched
        before = len(self.hits)
        res, _, _ = self.download("/plain/index.m3u8", out=out)
        self.assertTrue(res)
        fetched = [h for h in self.hits[before:] if h.endswith(".ts")]
        self.assertEqual(len(fetched), 12 - (len([k for k in kept if k.startswith("seg")])))
        self.assertIn("/plain/s005.ts", fetched)
        self.assertAlmostEqual(self.duration(out), 12, delta=0.6)


if __name__ == "__main__":
    unittest.main()
