"""oxtorrent.py parsing (no network): run with python3 -m unittest discover downloaders"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import oxtorrent as ox
except ImportError as e:      # bs4 / requests missing on this machine
    ox = None
    MISSING = str(e)

ROW = """<table class="table table-hover"><tr><th>Type</th></tr>
<tr><td class="type liste-accueil-type" title="Films"><a href="/category/films"><i class="Films"></i></a></td>
<td class="liste-accueil-nom"><div class="maxi"><a href="/detail/82140" title="Inception.2010.MULTi.VFF.2160p.BluRay.HDR10.HE.AAC.5.1.x265-QTZ">Inception…</a></div></td>
<td class="liste-accueil-taille" title="Taille">4.36 GB</td><td class="sources liste-accueil-sources" title="Sources">82</td>
<td class="clients liste-accueil-clients" title="Clients">38</td><td class="compl liste-accueil-compl" title="Complétés"> 610</td>
<td class="date liste-accueil-date" title="Date"><i class="fa-regular fa-clock"></i> 8 mois</td></tr>
<tr><td class="type liste-accueil-type" title="Musiques"></td><td class="liste-accueil-nom"><a href="/detail/5" title="Album">Album</a></td></tr>
</table>"""

DETAIL = """<div id="collapseOne"><table class="table">
<tr><td>Titre:</td><td>Inception MULTI TRUEFRENCH ULTRA HD 4KLight x265 2010</td></tr>
<tr><td>Catégories:</td><td>Films</td></tr><tr><td>Poids du fichier:</td><td>4.36 GB</td></tr>
<tr><td>Seeders:</td><td>82</td></tr><tr><td>Leechers:</td><td>38</td></tr>
<tr><td>Télécharger:</td><td><a href="/get_torrents/ca7c2e"><button>Télécharger le torrent</button></a>
<a href="magnet:?xt=urn:btih:abc&tr=udp://tracker.opentrackr.org:1337/announce">Magnet Link</a></td></tr>
</table></div>
<div id="torrentsimage"><img class="img-rounded" src="https://zimage.cc/inception.jpg"></div>
<div id="torrentsdesc"><div class="maximum">Inception.2010.MULTi.VFF.2160p.BluRay.x265-QTZ</div>Dom Cobb est un voleur expérimenté.</div>"""


@unittest.skipIf(ox is None, "bs4 / requests missing")
class OxTorrent(unittest.TestCase):
    def test_results(self):
        rows = ox.parse_results(ROW)
        self.assertEqual(rows[0], {"detail": "82140", "name": "Inception.2010.MULTi.VFF.2160p.BluRay.HDR10.HE.AAC.5.1.x265-QTZ",
                                   "category": "Films", "size": "4.36 GB", "seeds": 82, "leech": 38})
        self.assertEqual([ox.kind_of(r["category"]) for r in rows], ["film", None])   # music is left out

    def test_release_names(self):
        r = ox.parse_release("Inception.2010.MULTi.VFF.2160p.BluRay.HDR10.HE.AAC.5.1.x265-QTZ")
        self.assertEqual((r["title"], r["year"], r["langs"], r["quality"], r["season"]), ("Inception", 2010, ["MULTI"], "2160p", None))
        r = ox.parse_release("The.Bear.S03.FRENCH.WEBRIP.1080p.x264")
        self.assertEqual((r["title"], r["year"], r["season"], r["langs"]), ("The Bear", None, 3, ["VF"]))
        r = ox.parse_release("[ OxTorrent.com ] Hacksaw.Ridge.2016.TRUEFRENCH.720p.BluRay.DTS.x264-EXTREME")
        self.assertEqual((r["title"], r["year"]), ("Hacksaw Ridge", 2016))
        r = ox.parse_release("1917.2019.VOSTFR.1080p.WEB")          # a year as the title
        self.assertEqual((r["title"], r["year"], r["langs"]), ("1917", 2019, ["VOSTFR"]))
        self.assertEqual(ox.kind_of("Séries"), "serie")
        r = ox.parse_release("Dune : Deuxième Partie FRENCH DVDRIP 2024")       # year after the tags
        self.assertEqual((r["title"], r["year"], r["quality"]), ("Dune : Deuxième Partie", 2024, "DVDRip"))
        r = ox.parse_release("One Piece E1180 VOSTFR 720P")
        self.assertEqual((r["title"], r["episode"], r["quality"]), ("One Piece", 1180, "720p"))
        r = ox.parse_release("One.Piece.2023.S02.MULTi.1080p.WEB")
        self.assertEqual((r["title"], r["year"], r["season"], r["episode"]), ("One Piece", 2023, 2, None))
        r = ox.parse_release("Dune.Prophecy.S01E01.FRENCH.WEBRip")
        self.assertEqual((r["season"], r["episode"], r["quality"]), (1, 1, "WEBRip"))

    def test_detail_page(self):
        d = ox.parse_detail(DETAIL)
        self.assertEqual((d["size"], d["seeds"], d["torrent"], d["poster_url"]),
                         ("4.36 GB", 82, "/get_torrents/ca7c2e", "https://zimage.cc/inception.jpg"))
        self.assertTrue(d["magnet"].startswith("magnet:?xt=urn:btih:abc"))
        self.assertEqual(d["release"], "Inception.2010.MULTi.VFF.2160p.BluRay.x265-QTZ")
        self.assertEqual(d["description"], "Dom Cobb est un voleur expérimenté.")
        self.assertEqual(ox.size_bytes("4.36 GB"), int(4.36 * 1024 ** 3))

    def test_aria2_progress(self):
        p = ox.parse_progress("[#2089b0 1.2GiB/4.3GiB(28%) CN:44 SD:12 DL:6.1MiB ETA:8m33s]")
        self.assertEqual((p["percent"], p["eta"]), (28, 513))
        self.assertAlmostEqual(p["speed"], 6.1 * 1024 ** 2)
        self.assertIsNone(ox.parse_progress("*** Download Progress Summary as of Mon ***"))

    def test_placing_a_film(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            work = Path(d) / ".part-oxtorrent-1"
            (work / "Inception.2010.MULTi").mkdir(parents=True)
            (work / "Inception.2010.MULTi" / "inception.mkv").write_bytes(b"x")
            (work / "Inception.2010.MULTi" / "sample.mkv").write_bytes(b"x")
            (work / "Inception.2010.MULTi" / "release.nfo").write_bytes(b"x")
            folder, videos = ox.place(work, "film", "Inception", 2010, d)
            self.assertEqual(folder.name, "Inception (2010)")
            self.assertEqual([v.name for v in videos], ["inception.mkv"])
            self.assertEqual(sorted(p.name for p in folder.iterdir()), ["inception.mkv"])


    def test_grouping_real_releases(self):
        import json
        rows = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "testdata_oxtorrent_rows.json")))
        groups = {(g["kind"], g["title"], g["year"]): g for g in ox.group_rows(rows)}
        self.assertEqual(ox.group_key("Georgie & Mandy's First Marriage"), ox.group_key("Georgie.and.Mandys.First.Marriage".replace(".", " ")))
        gm = groups[("serie", "Georgie & Mandy's First Marriage", None)]
        s2 = next(s for s in gm["seasons"] if s["number"] == 2)
        numbers = [e["number"] for e in s2["episodes"]]
        self.assertEqual(numbers, list(range(1, 23)))                 # every episode once…
        self.assertEqual(len(next(e for e in s2["episodes"] if e["number"] == 3)["versions"]), 2)   # …with its versions
        self.assertEqual([p["label"] for p in s2["packs"]], ["Épisodes 12–22"])
        s1 = next(s for s in gm["seasons"] if s["number"] == 1)
        self.assertEqual([p["label"] for p in s1["packs"]], ["Saison complète"])
        # A film in several qualities: one card; the same release listed twice is kept once
        dune = groups[("film", "Dune", 2021)]
        self.assertEqual(len(dune["versions"]), 6)
        self.assertEqual(sorted(v["resolution"] or "" for v in dune["versions"]), ["", "", "1080p", "1080p", "2160p", "720p"])
        self.assertEqual(len(groups[("film", "Dune : Deuxième Partie", 2024)]["versions"]), 7)
        v = next(v for v in groups[("film", "Inception", 2010)]["versions"] if v["id"] == "oxtorrent:film:82140")
        self.assertEqual((v["resolution"], v["source"], v["codec"], v["language"], v["seeders"]), ("2160p", "BluRay", "x265", "MULTI", 82))
        bear = groups[("serie", "The Bear", None)]
        self.assertEqual([(s["number"], len(s["packs"][0]["versions"])) for s in bear["seasons"]], [(1, 1), (2, 2), (3, 2), (4, 2)])
        self.assertFalse(any(g["kind"] not in ("film", "serie", "anime") for g in groups.values()))   # « Vidéos » left out

    def test_language_labels(self):
        self.assertEqual(ox.analyse("Georgie.and.Mandys.First.Marriage.S02E17.FASTSUB.VOSTFR.WEBRip.x264")["language"], "VOSTFR")
        self.assertEqual(ox.analyse("Georgie.and.Mandys.First.Marriage.S02E01.SUBFRENCH.WEBRip.x264.mp4")["language_family"], "VOSTFR")
        a = ox.analyse("Georgie.And.Mandys.First.Marriage.S02e22.Final.Vostfr.Web.H264-Fw (Georgie & Mandy's First Marriage)")
        self.assertEqual((a["season"], a["episode"], a["plain_title"], a["codec"]), (2, 22, "Georgie & Mandy's First Marriage", "x264"))
        self.assertEqual(ox.analyse("Oppenheimer.2023.VFQ.720p.BluRay.x264-Slay3R")["language"], "VFQ")


if __name__ == "__main__":
    unittest.main()
