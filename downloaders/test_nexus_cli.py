"""Tests of the shared --json helpers (no network). Run: python3 -m unittest discover downloaders"""
import io
import json
import os
import sys
import tempfile
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

    def test_norm_title(self):
        self.assertEqual(nexus_cli.norm_title(self.OX), nexus_cli.norm_title(self.MOVIX))
        self.assertEqual(nexus_cli.norm_title("Élite"), nexus_cli.norm_title("elite"))


if __name__ == "__main__":
    unittest.main()
