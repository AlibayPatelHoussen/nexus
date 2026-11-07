"""Tests of the shared --json helpers (no network). Run: python3 -m unittest discover downloaders"""
import io
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
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
        # The owner's server: --print makes yt-dlp quiet, the merge of a big video prints nothing for minutes
        code, lines, runs, emitted = self.run_fake(
            "echo 'NXP|500|1000|1000|10|5'\necho 'NXP|1000|1000|1000|10|0'\n"
            "echo 'NXPP|started|Merger'\nsleep 4\necho 'NXPP|finished|Merger'\necho 'NXFILE|/x.mp4'\n", stall=2)
        self.assertEqual((code, runs), (0, 1))          # never restarted
        self.assertIn("NXFILE|/x.mp4", lines)
        self.assertIn("Assemblage", emitted)

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


if __name__ == "__main__":
    unittest.main()
