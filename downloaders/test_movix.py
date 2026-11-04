"""movix.py helpers (no network): run with python3 -m unittest discover downloaders"""
import os
import re
import time
import unittest

SRC = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "movix.py"), encoding="utf-8").read()
ns = {"re": re, "time": time}
i = SRC.index("def _aired")
exec(SRC[i:SRC.index("\ndef ", i + 5)], ns)
aired = ns["_aired"]


class Aired(unittest.TestCase):
    def test_announced_episodes_are_not_out(self):
        self.assertTrue(aired({"title": "E01 - Décision qui fâche", "air_date": "2025-10-16"}))
        self.assertFalse(aired({"title": "E01 - Épisode 1", "air_date": "2099-01-01"}))
        self.assertFalse(aired({"title": "E03 - Épisode 3", "air_date": ""}))   # TMDB placeholder, no date
        self.assertTrue(aired({"title": "E03 - Le retour", "air_date": ""}))


if __name__ == "__main__":
    unittest.main()
