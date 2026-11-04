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


if __name__ == "__main__":
    unittest.main()
