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


if __name__ == "__main__":
    unittest.main()
