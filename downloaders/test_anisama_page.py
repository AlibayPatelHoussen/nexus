"""anime-sama page parsing (no network): run with python3 -m unittest discover downloaders"""
import os
import re
import unittest

SRC = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "anisama.py"), encoding="utf-8").read()


def _load(name):
    i = SRC.index(f"def {name}")
    j = SRC.index("\ndef ", i + 5)
    ns = {"re": re}
    exec(SRC[i:j], ns)
    return ns[name]


active_scripts = _load("_active_scripts")
LINK = re.compile(r"panneau\w*\(\s*[\"']([^\"']*)[\"']\s*,\s*[\"']([a-z0-9_-]+)/([a-z0-9]+)/?[\"']", re.I)

PAGE = """<div><script>
/*panneauAnime("nom", "url"); -> on en met autant qu'on veut*/
panneauAnime("Saison 1", "saison1/vostfr");
/*panneauAnime("Saison 2", "saison2/vostfr");
panneauAnime("OAV", "oav/vostfr");*/
// panneauAnime("Kai", "kai/vostfr");
</script></div>
<!-- <h2>Manga</h2><script>
panneauScan("Scans", "scan/vf");
</script></div> -->
<script>var u = "https://site/a"; panneauScan("Scans", "scan/vf");</script>
<script>panneauScan("Naruto Gaiden", "scan_one_shot/vf");</script>"""


class Page(unittest.TestCase):
    def test_only_what_the_browser_runs(self):
        links = LINK.findall(active_scripts(PAGE))
        self.assertEqual(links, [("Saison 1", "saison1", "vostfr"), ("Scans", "scan", "vf"),
                                 ("Naruto Gaiden", "scan_one_shot", "vf")])

    def test_season_segments(self):
        seg = re.search(r'ANIME_SEGMENT = re\.compile\(r"(.+?)"\)', SRC).group(1)
        ok = re.compile(seg)
        for s in ("saison1", "saison12", "saison1hs", "kai", "kaihs", "kai2", "film", "film3", "oav", "speciaux"):
            self.assertTrue(ok.match(s), s)
        for s in ("url", "scan", "scan_one_shot", "nom"):
            self.assertFalse(ok.match(s), s)


if __name__ == "__main__":
    unittest.main()
