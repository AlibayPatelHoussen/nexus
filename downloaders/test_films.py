"""films.py: pages whose announced compression is wrong (no network: a local HTTP server).
Run with python3 -m unittest discover downloaders"""
import gzip
import http.server
import os
import threading
import time
import unittest

try:
    import requests
except ImportError:          # the script itself needs it; nothing to test without it
    requests = None

SRC = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "films.py"), encoding="utf-8").read()
HTML = b'<html><form action="/s"><input type="text" name="q"></form>films</html>'


class _Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        plain = "identity" in (self.headers.get("Accept-Encoding") or "")
        body, encoding = HTML, None
        if self.path == "/lying":          # « gzip » on plain HTML, whatever the client accepts
            encoding = "gzip"
        elif self.path == "/fixable":      # wrong label only when compression is accepted
            encoding = None if plain else "gzip"
        elif self.path == "/gzip":         # honest compression
            body, encoding = gzip.compress(HTML), "gzip"
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        if encoding:
            self.send_header("Content-Encoding", encoding)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@unittest.skipIf(requests is None, "requests not installed")
class WrongCompressionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        i, j = SRC.index("def _decode_body"), SRC.index("\ndef slugify")
        cls.ns = {"requests": requests, "SESSION": requests.Session(), "time": time}
        exec(SRC[i:j], cls.ns)
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_a_page_labelled_gzip_but_plain_is_read(self):
        with self.assertRaises(requests.exceptions.ContentDecodingError):
            requests.get(self.base + "/lying", timeout=5)      # what the owner saw
        for path in ("/lying", "/fixable", "/gzip", "/ok"):
            r = self.ns["get_page"](self.base + path)
            self.assertIsNotNone(r, path)
            self.assertEqual(r.content, HTML, path)

    def test_decode_body_tries_each_compression_then_keeps_the_bytes(self):
        decode = self.ns["_decode_body"]
        self.assertEqual(decode(gzip.compress(HTML), "gzip"), HTML)
        self.assertEqual(decode(HTML, "gzip"), HTML)
