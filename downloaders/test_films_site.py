"""films.py: the site's address follows it when it moves (no network: local HTTP servers).
Run with python3 -m unittest discover downloaders"""
import http.server
import json
import os
import re
import socket
import tempfile
import threading
import time
import unittest
from urllib.parse import urljoin, urlparse

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:          # the script itself needs them; nothing to test without them
    requests = None

SRC = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "films.py"), encoding="utf-8").read()
SITE = b'<html><a class="film-card" href="/c0de123/b/dune/42"><img alt="Dune"></a>' \
       b'<footer><a href="%s">Adresse de secours</a></footer></html>'


def free_port():
    """A port nothing listens on: an address that is gone"""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Site:
    """One local web site: routes {path: (status, body, headers)}"""

    def __init__(self, routes=None):
        self.routes = routes or {}
        site = self

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                status, body, headers = site.routes.get(self.path, (404, b"not found", {}))
                self.send_response(status)
                for k, v in headers.items():
                    self.send_header(k, v)
                self.send_header("Content-Type", "text/html")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@unittest.skipIf(requests is None, "requests / bs4 not installed")
class SiteAddressTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        i, j = SRC.index("def _decode_body"), SRC.index("def detect_site_config")
        self.ns = {"__file__": os.path.join(self.dir, "films.py"), "requests": requests, "SESSION": requests.Session(), "time": time, "os": os, "re": re,
                   "urljoin": urljoin, "urlparse": urlparse, "BeautifulSoup": BeautifulSoup, "info": lambda *_: None}
        exec(SRC[i:j], self.ns)
        self.ns["SITE_FILE"] = os.path.join(self.dir, "data", "films_site.json")
        self.ns["_ALLOW_PRIVATE"] = True    # the « sites » are local servers
        self.sites = []

    def tearDown(self):
        for s in self.sites:
            s.close()

    def site(self, routes=None):
        s = Site(routes)
        self.sites.append(s)
        return s

    def saved(self):
        with open(self.ns["SITE_FILE"], encoding="utf-8") as f:
            return json.load(f)

    def save(self, data):
        os.makedirs(os.path.dirname(self.ns["SITE_FILE"]), exist_ok=True)
        with open(self.ns["SITE_FILE"], "w", encoding="utf-8") as f:
            json.dump(data, f)

    def test_the_address_that_works_is_kept_with_the_others_the_site_shows(self):
        mirror = "https://autre.example/9f8e7d6/home/autre"
        new = self.site({"/c0de123/home/site": (200, SITE % mirror.encode(), {})})
        self.ns["DEFAULT_SITE_URL"] = new.base + "/c0de123/home/site"
        self.assertEqual(self.ns["site_url"](), new.base + "/c0de123/home/site")
        self.assertEqual(self.saved()["url"], new.base + "/c0de123/home/site")
        self.assertEqual(self.saved()["seen"], [mirror])

    def test_a_redirect_to_the_new_domain_is_followed_and_remembered(self):
        new = self.site({"/770fbb7/home/zotrof": (200, SITE % b"#", {})})
        old = self.site({"/fc3e940/home/tiprov": (301, b"", {"Location": new.base + "/770fbb7/home/zotrof"})})
        self.save({"url": old.base + "/fc3e940/home/tiprov"})
        self.ns["DEFAULT_SITE_URL"] = "http://127.0.0.1:%d/gone" % free_port()
        self.assertEqual(self.ns["site_url"](), new.base + "/770fbb7/home/zotrof")
        data = self.saved()
        self.assertEqual(data["url"], new.base + "/770fbb7/home/zotrof")
        self.assertEqual(data["previous"], old.base + "/fc3e940/home/tiprov")
        self.assertEqual(data["how"], "redirect")

    def test_a_page_that_says_where_the_site_went(self):
        new = self.site({"/770fbb7/home/zotrof": (200, SITE % b"#", {})})
        moved = ('<html><p>Nous avons déménagé ! Notre nouvelle adresse : '
                 f'<a href="{new.base}/770fbb7/home/zotrof">cliquez ici</a></p></html>').encode()
        old = self.site({"/fc3e940/home/tiprov": (200, moved, {})})
        self.save({"url": old.base + "/fc3e940/home/tiprov"})
        self.ns["DEFAULT_SITE_URL"] = old.base + "/fc3e940/home/tiprov"
        self.assertEqual(self.ns["site_url"](), new.base + "/770fbb7/home/zotrof")
        self.assertEqual(self.saved()["url"], new.base + "/770fbb7/home/zotrof")

    def test_the_old_domain_gone_an_address_seen_before_is_tried(self):
        new = self.site({"/770fbb7/home/zotrof": (200, SITE % b"#", {})})
        gone = "http://127.0.0.1:%d/fc3e940/home/tiprov" % free_port()
        self.save({"url": gone, "seen": [new.base + "/770fbb7/home/zotrof"]})
        self.ns["DEFAULT_SITE_URL"] = gone
        self.assertEqual(self.ns["site_url"](), new.base + "/770fbb7/home/zotrof")

    def test_nothing_answers_nothing_is_forgotten(self):
        gone = "http://127.0.0.1:%d/fc3e940/home/tiprov" % free_port()
        self.save({"url": gone, "seen": []})
        self.ns["DEFAULT_SITE_URL"] = gone
        self.assertIsNone(self.ns["site_url"]())
        self.assertEqual(self.saved()["url"], gone)

    def test_a_link_set_in_nexus_comes_first(self):
        mine = self.site({"/aaaa111/home/x": (200, SITE % b"#", {})})
        default = self.site({"/c0de123/home/site": (200, SITE % b"#", {})})
        self.save({"url": mine.base + "/aaaa111/home/x", "how": "manual"})
        self.ns["DEFAULT_SITE_URL"] = default.base + "/c0de123/home/site"
        self.assertEqual(self.ns["site_url"](), mine.base + "/aaaa111/home/x")

    def test_other_addresses_written_in_the_text(self):
        class R:
            url = "https://tiprov.com/fc3e940/home/tiprov"
            text = "<p>Le site a changé d'adresse. Nouvelle adresse : zotrof.com/770fbb7/home/zotrof (pensez à la noter)</p>"
        self.assertEqual(self.ns["_other_addresses"](R()), ["https://zotrof.com/770fbb7/home/zotrof"])

    def test_an_address_found_on_a_page_never_points_to_the_server_s_own_network(self):
        self.ns["_ALLOW_PRIVATE"] = False

        class R:
            url = "https://tiprov.com/fc3e940/home/tiprov"
            text = ('<p>Nouvelle adresse : <a href="http://127.0.0.1:3001/api">ici</a>, '
                    '<a href="http://192.168.1.10/x/home/y">là</a>, <a href="http://nas.local/a1b2c3d/home/z">nas</a>, '
                    '<a href="https://zotrof.com/770fbb7/home/zotrof">zotrof</a></p>')
        self.assertEqual(self.ns["_other_addresses"](R()), ["https://zotrof.com/770fbb7/home/zotrof"])

    def test_a_film_found_before_the_move_is_fetched_on_the_new_domain(self):
        self.ns["_SITE"]["url"] = "https://zotrof.com/770fbb7/home/zotrof"
        self.assertEqual(self.ns["on_current_site"]("https://tiprov.com/fc3e940/b/dune/42"),
                         "https://zotrof.com/770fbb7/b/dune/42")
        self.assertEqual(self.ns["on_current_site"]("https://zotrof.com/770fbb7/b/dune/42"),
                         "https://zotrof.com/770fbb7/b/dune/42")


if __name__ == "__main__":
    unittest.main()
