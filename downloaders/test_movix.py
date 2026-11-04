"""movix.py helpers (no network): run with python3 -m unittest discover downloaders"""
import os
import re
import time
import unittest

SRC = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "movix.py"), encoding="utf-8").read()
ns = {"re": re, "time": time}
for name in ("_aired", "_lang_links", "_ep_langs"):
    i = SRC.index(f"def {name}")
    exec(SRC[i:SRC.index("\ndef ", i + 5)], ns)
ns["LANG_KEYS"] = eval(re.search(r"LANG_KEYS = (\{.*?\})\n", SRC).group(1))
aired, lang_links, ep_langs = ns["_aired"], ns["_lang_links"], ns["_ep_langs"]


class Aired(unittest.TestCase):
    def test_announced_episodes_are_not_out(self):
        self.assertTrue(aired({"title": "E01 - Décision qui fâche", "air_date": "2025-10-16"}))
        self.assertFalse(aired({"title": "E01 - Épisode 1", "air_date": "2099-01-01"}))
        self.assertFalse(aired({"title": "E03 - Épisode 3", "air_date": ""}))   # TMDB placeholder, no date
        self.assertTrue(aired({"title": "E03 - Le retour", "air_date": ""}))



class Languages(unittest.TestCase):
    def test_fstream_episode(self):
        ep = {"number": 1, "title": "x", "languages": {
            "VF": [], "VOSTFR": [{"url": "https://fsvid.lol/e/a", "player": "Premium"}, {"url": "https://uqload.vc/b"}],
            "VOENG": [{"url": "https://x/c"}], "Default": [{"url": "https://x/d"}]}}
        self.assertEqual(lang_links(ep), {"VF": [], "VOSTFR": ["https://fsvid.lol/e/a", "https://uqload.vc/b"]})
        self.assertEqual(ep_langs(lang_links(ep)), ["VOSTFR"])

    def test_wiflix_film_and_unknown(self):
        self.assertEqual(lang_links({"players": {"vf": ["https://a/1", "https://a/1"], "vostfr": []}}),
                         {"VF": ["https://a/1"], "VOSTFR": []})
        self.assertIsNone(ep_langs({"VF": [], "VOSTFR": []}))     # no source knows: both offered
        self.assertIsNone(ep_langs(None))


if __name__ == "__main__":
    unittest.main()
