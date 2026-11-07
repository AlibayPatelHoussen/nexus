"""youtube.py leftovers of a stopped download (no network). Run: python3 -m unittest discover downloaders"""
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import nexus_cli  # noqa: E402

SRC = open(os.path.join(HERE, "youtube.py"), encoding="utf-8").read()
ns = {"re": re, "json": json, "Path": Path, "subprocess": subprocess, "nexus_cli": nexus_cli}
exec(SRC[SRC.index("# yt-dlp's intermediate files"):SRC.index("def json_download")], ns)

VID = "TS93delvy8U"
NAME = f"LE JEU DU BLUFF (Avec Anyme) [{VID}]"


class Leftovers(unittest.TestCase):
    """The owner's server: « déjà présent » for a video that was only streams + a half-merged file."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dest = Path(self.tmp.name)
        self.chan = self.dest / "Mastu"
        self.chan.mkdir()
        self.out, sys.stdout = sys.stdout, io.StringIO()

    def tearDown(self):
        sys.stdout = self.out
        self.tmp.cleanup()

    def touch(self, name, data=b"x"):
        (self.chan / name).write_bytes(data)
        return self.chan / name

    def test_streams_and_temp_are_not_the_video(self):
        for n in (f"{NAME}.f401.mp4", f"{NAME}.f251.webm", f"{NAME}.temp.mp4", f"{NAME}.f401.mp4.part", f"{NAME}.jpg"):
            self.touch(n)
        (self.dest / ".part-youtube" / "Mastu").mkdir(parents=True)
        (self.dest / ".part-youtube" / "Mastu" / f"{NAME}.mp4").write_bytes(b"x")
        self.assertIsNone(ns["_existing"](self.dest, VID))
        final = self.touch(f"{NAME}.mp4")
        self.assertEqual(ns["_existing"](self.dest, VID), final)

    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg missing")
    def test_complete_streams_are_merged_without_downloading_again(self):
        def make(args, path):
            subprocess.run(["ffmpeg", "-y", "-v", "error", *args, str(path)], check=True)
        video = self.chan / f"{NAME}.f401.mp4"
        audio = self.chan / f"{NAME}.f251.webm"
        make(["-f", "lavfi", "-i", "testsrc=size=64x48:rate=5:duration=1", "-c:v", "mpeg4"], video)
        make(["-f", "lavfi", "-i", "sine=duration=1", "-c:a", "libopus"], audio)
        self.touch(f"{NAME}.temp.mp4")
        (self.chan / f"{NAME}.info.json").write_text(json.dumps({"requested_formats": [
            {"format_id": "401", "filesize": video.stat().st_size}, {"format_id": "251", "filesize": audio.stat().st_size}]}))
        final = ns["_finish_leftovers"](self.dest, VID, VID)
        self.assertEqual(final, self.chan / f"{NAME}.mp4")
        self.assertTrue(final.exists())
        self.assertEqual(ns["_leftovers"](self.dest, VID), [])
        streams = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(final)],
                                 capture_output=True, text=True).stdout.split()
        self.assertEqual(sorted(streams), ["audio", "video"])

    def test_incomplete_streams_are_downloaded_again(self):
        video = self.touch(f"{NAME}.f401.mp4", b"x" * 10)
        self.touch(f"{NAME}.f251.webm", b"y" * 10)
        (self.chan / f"{NAME}.info.json").write_text(json.dumps({"requested_formats": [
            {"format_id": "401", "filesize": 999}, {"format_id": "251", "filesize": 10}]}))
        self.assertIsNone(ns["_finish_leftovers"](self.dest, VID, VID))
        self.assertTrue(video.exists())     # left for yt-dlp; removed once the new download succeeds


if __name__ == "__main__":
    unittest.main()
