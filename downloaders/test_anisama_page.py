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

    def test_episode_links_without_closing_quotes(self):
        ns = {"re": re, "json": __import__("json")}
        for name in ("_is_embed_url", "_parse_episodes_js"):
            i = SRC.index(f"def {name}")
            exec(SRC[i:SRC.index("\ndef ", i + 5)], ns)
        ns["EMBED_DOMAINS"] = eval("(" + re.search(r"EMBED_DOMAINS = \((.*?)\)\n", SRC, re.S).group(1) + ")")
        js = ("var eps1 = [\n 'https://ansembed.net/embed-7no7mzi6fpyl.html,\n"
              " 'https://ansembed.net/embed-fpohgbitel2s.html,\n"
              " 'https://ansembed.net/embed-c9ckj48zs3lj.html'\n];")
        self.assertEqual(len(ns["_parse_episodes_js"](js)), 3)
        self.assertEqual(len(ns["_parse_episodes_js"]("var eps1 = [];")), 0)


    def test_site_search_answers(self):
        try:
            from bs4 import BeautifulSoup
        except ImportError:
            self.skipTest("bs4 missing")
        ns = {"re": re, "BeautifulSoup": BeautifulSoup, "BASE_URL": "https://anime-sama.to"}
        for name in ("_slug_of", "_parse_site_results", "_parse_catalogue_cards", "_variant_title", "_norm", "_relevant"):
            i = SRC.index(f"def {name}")
            exec(SRC[i:SRC.index("\ndef ", i + 5)], ns)
        fetch = ('<a href="https://anime-sama.to/catalogue/frieren" class="asn-search-result"><img src="x">'
                 '<h3 class="asn-search-result-title"><mark>Frieren</mark></h3>'
                 '<p class="asn-search-meta">Anime · Scans · 2023</p></a>')
        self.assertEqual(ns["_parse_site_results"](fetch),
                         [{"title": "Frieren", "url": "https://anime-sama.to/catalogue/frieren", "alt": ""}])
        rel = ns["_relevant"]
        hit = lambda t, slug, alt="": {"title": t, "url": f"https://anime-sama.to/catalogue/{slug}", "alt": alt}
        self.assertTrue(rel(hit("Kaiju N°8", "kaiju-n8"), "kaiju"))
        self.assertFalse(rel(hit("Kaiji", "kaiji"), "kaiju"))
        self.assertFalse(rel(hit("Les Enfants de la Mer", "les-enfants-de-la-mer"), "kaiju"))
        self.assertTrue(rel(hit("Frieren", "frieren", "Sousou no Frieren"), "sousou frieren"))
        self.assertTrue(rel(hit("Pokémon", "pokemon"), "pokemon"))
        cards = ('<a class="as-carte-lien" href="https://anime-sama.to/catalogue/naruto/"><span>Anime</span>'
                 '<span>Scans</span><img alt="Naruto" src="x"></a>'
                 '<a class="as-carte-lien" href="/catalogue/bleach/"><img alt="Bleach"></a>'
                 '<a href="/catalogue/naruto/saison1/vostfr/">ep</a>')
        self.assertEqual(ns["_parse_catalogue_cards"](cards, "naruto"),
                         [{"title": "Naruto", "url": "https://anime-sama.to/catalogue/naruto"}])
        vt = ns["_variant_title"]
        self.assertEqual(vt("One Piece", {"name": "Scans (noir et blanc)", "seg": "scan_noir-et-blanc"}),
                         "One Piece — Scans (noir et blanc)")
        self.assertEqual(vt("Naruto", {"name": "Naruto Gaiden", "seg": "scan_one_shot"}), "Naruto Gaiden")
        self.assertEqual(vt("Naruto", {"name": "Scans", "seg": "scan_one_shot"}), "Naruto — one shot")


class EditionsTest(unittest.TestCase):
    """One Piece: colour and black & white scans are versions of ONE manga, like VF / VOSTFR."""

    def setUp(self):
        import tempfile
        from pathlib import Path
        self.tmp = tempfile.TemporaryDirectory()
        self.ns = {"re": re, "Path": Path, "DOWNLOAD_DIR": Path(self.tmp.name)}
        i = SRC.index('EDITIONS = {')
        exec(SRC[i:SRC.index("\ndef _title_of", i)], self.ns)
        for name in ("_variant_title", "slugify"):
            i = SRC.index(f"def {name}")
            exec(SRC[i:SRC.index("\ndef ", i + 5)], self.ns)

    def tearDown(self):
        self.tmp.cleanup()

    NB = {"seg": "scan_noir-et-blanc", "name": "Scans (noir et blanc)", "langs": ["VF"], "edition": "NB"}

    def test_edition_of(self):
        ed = self.ns["_edition_of"]
        self.assertEqual(ed({"name": "Scans (noir et blanc)", "seg": "scan_noir-et-blanc"}), "NB")
        self.assertEqual(ed({"name": "Scans", "seg": "scan_couleur"}), "CO")
        self.assertEqual(ed({"name": "Version colorisée", "seg": "scan2"}), "CO")
        self.assertIsNone(ed({"name": "Naruto Gaiden", "seg": "scan_one_shot"}))

    def test_split_lang(self):
        sp = self.ns["_split_lang"]
        self.assertEqual(sp("VFNB"), ("VF", "NB"))
        self.assertEqual(sp("VOSTFRCO"), ("VOSTFR", "CO"))
        self.assertEqual(sp("VF"), ("VF", None))
        self.assertEqual(sp("VOSTFR"), ("VOSTFR", None))

    def test_options_one_language(self):
        opts = self.ns["_scan_options"](["VF"], [self.NB, {"seg": "scan_one_shot", "name": "Gaiden", "langs": ["VF"], "edition": None}])
        # Real One Piece page: « Scans (couleur) » = scan/vf, « Scans (noir et blanc) » = scan_noir-et-blanc/vf;
        # black & white (the weekly one) comes first, so it is the default
        self.assertEqual([(o["lang"], o["seg"], o["folder"], o["label"]) for o in opts], [
            ("VFNB", "scan_noir-et-blanc", "VF Noir et blanc", "Noir et blanc"),
            ("VF", "scan", "VF", "Couleur"),
        ])

    def test_options_two_languages(self):
        nb = {**self.NB, "langs": ["VF", "VOSTFR"]}
        labels = [o["label"] for o in self.ns["_scan_options"](["VF"], [nb])]
        self.assertEqual(labels, ["Noir et blanc · VF", "Noir et blanc · VOSTFR", "Couleur · VF"])

    def test_options_without_editions(self):
        opts = self.ns["_scan_options"](["VF", "VOSTFR"], [])
        self.assertEqual([(o["lang"], o["label"]) for o in opts], [("VF", "VF"), ("VOSTFR", "VOSTFR")])

    def test_old_id_keeps_plain_code(self):
        opts = self.ns["_scan_options"](["VF"], [self.NB], only="scan_noir-et-blanc")
        self.assertEqual([(o["lang"], o["folder"]) for o in opts], [("VF", "VF Noir et blanc")])

    def test_old_edition_folder_moves_into_the_manga(self):
        root = self.ns["DOWNLOAD_DIR"]
        old = root / "One Piece — Scans (noir et blanc)" / "VF"
        old.mkdir(parents=True)
        (old / "Chapitre 1.pdf").write_bytes(b"%PDF")
        (root / "One Piece" / "VF").mkdir(parents=True)
        self.ns["_move_old_editions"]("One Piece", [self.NB])
        self.assertTrue((root / "One Piece" / "VF Noir et blanc" / "Chapitre 1.pdf").exists())
        self.assertFalse((root / "One Piece — Scans (noir et blanc)").exists())
        self.ns["_move_old_editions"]("One Piece", [self.NB])     # nothing left to move: no error


if __name__ == "__main__":
    unittest.main()
