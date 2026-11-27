"""anime-sama: the home page's latest additions (no network). Run with python3 -m unittest discover downloaders"""
import os
import re
import unittest

try:
    from bs4 import BeautifulSoup
except ImportError:          # the script itself needs it
    BeautifulSoup = None

SRC = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "anisama.py"), encoding="utf-8").read()

# The markup of anime-sama.to's home page (November 2026), trimmed: two cards per list
CARD = ('<div class="as-carte as-carte-{cls}" data-url="/catalogue/{slug}/" data-cat="oeuvre" data-nom="{name}">'
        '<a class="as-carte-lien" href="{href}" draggable="false"><div class="as-carte-image"><img src="x.webp" alt=""></div>'
        '<span class="as-carte-survol"><svg><path d="M10 16"/></svg></span>'
        '<div class="as-carte-badges"><span class="as-badge">Webtoon</span><span class="as-drapeau"><img alt="VF"></span></div>'
        '<div class="as-carte-texte"><h3 class="as-carte-titre" title="{name}">{name}</h3>'
        '<div class="as-carte-info"><svg><path d="M6 2"/></svg><span>{info}</span>'
        '<span class="as-carte-temps">Aujourd&#039;hui · {when}</span></div></div></a>'
        '<button class="pf-carte-btn" type="button" aria-label="Actions"></button></div>')
HOME = (
    '<h2>Derniers épisodes ajoutés</h2><div id="containerAjoutsAnimes" class="scrollBarStyled">'
    + CARD.format(cls="anime", slug="psyren", name="Psyren", href="/catalogue/psyren/saison1/va/", info="S1 · Épisode 4", when="02:32")
    + CARD.format(cls="anime", slug="one-piece", name="One Piece", href="https://anime-sama.to/catalogue/one-piece/saison11/vostfr/", info="S11 · Épisode 1150", when="01:10")
    + '</div><h2>Derniers scans ajoutés</h2><div id="containerAjoutsScans" class="scrollBarStyled">'
    + CARD.format(cls="scan", slug="infinite-titles", name="Infinite Titles", href="/catalogue/infinite-titles/scan/vf/", info="Chapitre 13 à 15", when="02:04")
    + CARD.format(cls="scan", slug="one-piece", name="One Piece", href="/catalogue/one-piece/scan/vf/", info="Chapitre 1170", when="00:45")
    + '</div><h2>Derniers contenus sortis</h2><div id="containerSorties">'
    + CARD.format(cls="anime", slug="autre", name="Autre", href="/catalogue/autre/saison1/vostfr/", info="Nouveau", when="00:01")
    + '</div>')


@unittest.skipIf(BeautifulSoup is None, "bs4 not installed")
class LatestTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        i = SRC.index("def latest_cards")
        j = SRC.index("\ndef json_latest", i)
        ns = {"re": re, "BeautifulSoup": BeautifulSoup}
        exec(SRC[i:j], ns)
        cls.cards = staticmethod(ns["latest_cards"])

    def test_the_latest_scans_and_episodes_of_the_home_page(self):
        cards = self.cards(HOME)
        self.assertEqual([(c["id"], c["info"]) for c in cards], [
            ("anisama:manga:infinite-titles", "Chapitre 13 à 15"),
            ("anisama:manga:one-piece", "Chapitre 1170"),
            ("anisama:anime:psyren", "S1 · Épisode 4"),
            ("anisama:anime:one-piece", "S11 · Épisode 1150"),
        ])
        self.assertEqual(cards[0]["path"], "/catalogue/infinite-titles/scan/vf/")
        self.assertEqual(cards[3]["path"], "/catalogue/one-piece/saison11/vostfr/")   # the domain left out
        self.assertEqual(cards[0]["when"], "Aujourd'hui · 02:04")

    def test_the_other_lists_and_a_page_without_them_give_nothing(self):
        self.assertNotIn("anisama:anime:autre", [c["id"] for c in self.cards(HOME)])
        self.assertEqual(self.cards("<html><body>Maintenance</body></html>"), [])


if __name__ == "__main__":
    unittest.main()
