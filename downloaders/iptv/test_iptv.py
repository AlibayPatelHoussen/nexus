"""Tests of the IPTV module (no internet: a local HTTP server plays iptv-org).
Run: python3 -m unittest discover downloaders"""
import datetime as dt
import gzip
import http.server
import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from iptv import catalogue, epg, sources, stream_checker  # noqa: E402
from iptv.playlist_parser import channel_id, group_titles, parse_m3u  # noqa: E402

M3U = '''﻿#EXTM3U
#EXTINF:-1 tvg-id="TF1.fr@SD" tvg-logo="https://img.example/tf1.png" group-title="General;News",TF1, la une (1080p)
#EXTVLCOPT:http-user-agent=Agent/1.0
#EXTVLCOPT:http-referrer=https://ref.example/
https://tv.example/tf1/index.m3u8
#EXTINF:-1 tvg-id="" group-title="Undefined",Sans id
http://tv.example/noid.m3u8
this is not an url
#EXTINF:-1 tvg-id="Broken.fr@SD",Broken without url
#EXTINF:-1 tvg-id="Adult.us@SD" group-title="XXX",Adult
https://tv.example/adult.m3u8
https://tv.example/bare.m3u8
#EXTINF:-1 tvg-id="NoLogo.fr@HD" group-title="Kids",No logo\r
https://tv.example/nologo.m3u8
'''

API = {
    'channels': [
        {'id': 'TF1.fr', 'name': 'TF1', 'country': 'FR', 'categories': ['general'], 'is_nsfw': False, 'closed': None, 'alt_names': ['La Une'], 'website': 'https://tf1.fr', 'network': 'TF1'},
        {'id': 'Kids.fr', 'name': 'Kids TV', 'country': 'FR', 'categories': ['kids'], 'is_nsfw': False, 'closed': None},
        {'id': 'Adult.us', 'name': 'Adult', 'country': 'US', 'categories': ['xxx'], 'is_nsfw': True, 'closed': None},
        {'id': 'Pirate.us', 'name': 'Pirate', 'country': 'US', 'categories': ['movies'], 'is_nsfw': False, 'closed': None},
        {'id': 'Old.de', 'name': 'Old', 'country': 'DE', 'categories': ['news'], 'is_nsfw': False, 'closed': '2020-01-01'},
        {'id': 'Plain.it', 'name': 'Plain', 'country': 'IT', 'categories': [], 'is_nsfw': False, 'closed': None},
    ],
    'feeds': [
        {'channel': 'TF1.fr', 'id': 'SD', 'is_main': True, 'languages': ['fra']},
        {'channel': 'TF1.fr', 'id': 'Alsace', 'is_main': False, 'languages': ['fra', 'gsw']},
        {'channel': 'Kids.fr', 'id': 'SD', 'is_main': True, 'languages': ['fra', 'eng']},
    ],
    'streams': [
        {'channel': 'TF1.fr', 'feed': 'Alsace', 'title': 'TF1 Alsace (720p)', 'url': 'https://tv.example/tf1-alsace.m3u8', 'quality': '720p', 'labels': []},
        {'channel': 'TF1.fr', 'feed': 'SD', 'title': 'TF1 (480p)', 'url': 'http://tv.example/tf1-sd.m3u8', 'quality': '480p', 'labels': []},
        {'channel': 'TF1.fr', 'feed': 'SD', 'title': 'TF1 (1080p) [Geo-blocked]', 'url': 'https://tv.example/tf1-hd.m3u8', 'quality': '1080p', 'labels': ['Geo-blocked']},
        {'channel': 'TF1.fr', 'feed': 'SD', 'title': 'TF1 duplicate', 'url': 'http://tv.example/tf1-sd.m3u8', 'quality': '480p', 'labels': []},
        {'channel': 'Kids.fr', 'feed': None, 'title': 'Kids', 'url': 'https://tv.example/kids.m3u8', 'quality': None, 'labels': ['Not 24/7'], 'user_agent': 'UA/2', 'referrer': 'https://k.example/'},
        {'channel': 'Adult.us', 'feed': None, 'title': 'Adult', 'url': 'https://tv.example/adult.m3u8'},
        {'channel': 'Pirate.us', 'feed': None, 'title': 'Pirate', 'url': 'https://tv.example/pirate.m3u8'},
        {'channel': 'Old.de', 'feed': None, 'title': 'Old', 'url': 'https://tv.example/old.m3u8'},
        {'channel': None, 'feed': None, 'title': 'Unknown local TV (576p)', 'url': 'https://tv.example/unknown.m3u8'},
        {'channel': 'Ghost.xx', 'feed': None, 'title': 'Ghost', 'url': 'https://tv.example/ghost.m3u8'},
        {'channel': 'Plain.it', 'feed': None, 'title': 'Plain', 'url': 'rtmp://tv.example/plain'},
        {'channel': 'Plain.it', 'feed': None, 'title': 'Plain', 'url': 'https://tv.example/plain.m3u8'},
    ],
    'logos': [
        {'channel': 'TF1.fr', 'feed': 'Alsace', 'in_use': True, 'format': 'PNG', 'width': 500, 'url': 'https://img.example/tf1-alsace.png'},
        {'channel': 'TF1.fr', 'feed': None, 'in_use': False, 'format': 'PNG', 'width': 900, 'url': 'https://img.example/tf1-old.png'},
        {'channel': 'TF1.fr', 'feed': None, 'in_use': True, 'format': 'SVG', 'width': 0, 'url': 'https://img.example/tf1.svg'},
        {'channel': 'TF1.fr', 'feed': None, 'in_use': True, 'format': 'PNG', 'width': 400, 'url': 'https://img.example/tf1.png'},
    ],
    'blocklist': [{'channel': 'Pirate.us', 'reason': 'dmca'}],
    'categories': [{'id': 'general', 'name': 'General'}, {'id': 'kids', 'name': 'Kids'}],
    'countries': [{'code': 'FR', 'name': 'France', 'flag': '🇫🇷'}, {'code': 'IT', 'name': 'Italy', 'flag': '🇮🇹'}],
    'languages': [{'code': 'fra', 'name': 'French'}, {'code': 'eng', 'name': 'English'}, {'code': 'gsw', 'name': 'Swiss German'}],
}


class Playlist(unittest.TestCase):
    def test_entries_attributes_and_vlc_options(self):
        entries = parse_m3u(M3U)
        tf1 = entries[0]
        self.assertEqual(tf1.name, 'la une (1080p)')         # name after the last comma outside quotes
        self.assertEqual(channel_id(tf1), 'TF1.fr')
        self.assertEqual(tf1.attrs['tvg-logo'], 'https://img.example/tf1.png')
        self.assertEqual(group_titles(tf1), ['General', 'News'])
        self.assertEqual((tf1.user_agent, tf1.referrer), ('Agent/1.0', 'https://ref.example/'))

    def test_malformed_lines_are_skipped(self):
        urls = [e.url for e in parse_m3u(M3U)]
        # « Broken without url » is dropped, a bare URL is kept, CRLF and BOM do not matter
        self.assertEqual(urls, ['https://tv.example/tf1/index.m3u8', 'http://tv.example/noid.m3u8',
                                'https://tv.example/adult.m3u8', 'https://tv.example/bare.m3u8', 'https://tv.example/nologo.m3u8'])
        self.assertEqual(group_titles(parse_m3u(M3U)[1]), [])          # « Undefined » is no category
        self.assertEqual(parse_m3u(''), [])
        self.assertEqual(parse_m3u('garbage\n#EXTINF:-1,x\n'), [])


class Catalogue(unittest.TestCase):
    def setUp(self):
        self.channels = {c.id: c for c in catalogue.build_from_api(API, parse_m3u(M3U))}

    def test_blocked_adult_and_closed_channels_are_left_out(self):
        for cid in ('Adult.us', 'Pirate.us', 'Old.de'):
            self.assertNotIn(cid, self.channels)
        urls = {s.url for c in self.channels.values() for s in c.streams}
        self.assertFalse({'https://tv.example/adult.m3u8', 'https://tv.example/pirate.m3u8', 'https://tv.example/old.m3u8'} & urls)

    def test_metadata_only_from_the_database(self):
        tf1 = self.channels['TF1.fr']
        self.assertEqual((tf1.country, tf1.categories, tf1.network), ('FR', ['general'], 'TF1'))
        self.assertEqual(tf1.languages, ['fra', 'gsw'])        # languages of the feeds that have streams
        self.assertEqual(self.channels['Kids.fr'].languages, ['fra', 'eng'])   # stream without feed: main feed
        plain = self.channels['Plain.it']
        self.assertEqual((plain.categories, plain.languages, plain.logo), ([], [], None))   # nothing made up

    def test_streams_deduplicated_and_ordered(self):
        tf1 = self.channels['TF1.fr']
        urls = [s.url for s in tf1.streams]
        self.assertEqual(len(urls), len(set(urls)))
        # main feed first, geo-blocked after, the Alsace feed last
        self.assertEqual(urls, ['http://tv.example/tf1-sd.m3u8', 'https://tv.example/tf1-hd.m3u8', 'https://tv.example/tf1-alsace.m3u8'])
        self.assertEqual(self.channels['Kids.fr'].streams[0].user_agent, 'UA/2')
        self.assertEqual([s.url for s in self.channels['Plain.it'].streams], ['https://tv.example/plain.m3u8'])   # rtmp left out

    def test_logo_in_use_png_first_and_channels_without_logo(self):
        self.assertEqual(self.channels['TF1.fr'].logo, 'https://img.example/tf1.png')
        self.assertIsNone(self.channels['Kids.fr'].logo)

    def test_streams_without_known_channel_keep_their_title_only(self):
        unknown = [c for c in self.channels.values() if c.id.startswith('stream-')]
        self.assertEqual(sorted(c.name for c in unknown), ['Ghost', 'Unknown local TV'])
        self.assertTrue(all(not c.country and not c.categories for c in unknown))

    def test_facets_count_real_channels(self):
        f = catalogue.facets(list(self.channels.values()), API)
        self.assertEqual(f['countries'][0], {'code': 'FR', 'name': 'France', 'flag': '🇫🇷', 'count': 2})
        self.assertEqual({c['id']: c['count'] for c in f['categories']}, {'general': 1, 'kids': 1})
        self.assertIn({'code': 'gsw', 'name': 'Swiss German', 'count': 1}, f['languages'])

    def test_playlist_fallback(self):
        chans = {c.id: c for c in catalogue.build_from_playlist(parse_m3u(M3U))}
        self.assertNotIn('Adult.us', chans)                       # group-title XXX
        self.assertEqual(chans['TF1.fr'].categories, ['general', 'news'])
        self.assertIsNone(chans['TF1.fr'].country)
        self.assertIsNone(chans['NoLogo.fr'].logo)
        self.assertEqual(chans['TF1.fr'].streams[0].quality, '1080p')


class _Handler(http.server.BaseHTTPRequestHandler):
    routes = {}
    hits = []

    def do_GET(self):
        _Handler.hits.append((self.path, self.headers.get('User-Agent'), self.headers.get('Referer'), self.headers.get('If-None-Match')))
        route = _Handler.routes.get(self.path.split('?')[0])
        if route is None:
            self.send_response(404); self.end_headers(); return
        status, body, headers = route
        if self.headers.get('If-None-Match') and self.headers.get('If-None-Match') == headers.get('ETag'):
            self.send_response(304); self.end_headers(); return
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


class LocalServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), _Handler)
        cls.base = f'http://127.0.0.1:{cls.server.server_address[1]}'
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = {'IPTV_DATA_DIR': self.tmp.name, 'IPTV_ALLOW_PRIVATE': '1'}
        self.old = {k: os.environ.get(k) for k in self.env}
        os.environ.update(self.env)
        _Handler.routes, _Handler.hits = {}, []

    def tearDown(self):
        for k, v in self.old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self.tmp.cleanup()


class Sources(LocalServer):
    def test_cache_conditional_request_and_mirror_fallback(self):
        _Handler.routes['/a.json'] = (200, b'[1]', {'ETag': '"v1"'})
        self.assertEqual(sources.fetch(f'{self.base}/a.json'), b'[1]')
        self.assertEqual(sources.fetch(f'{self.base}/a.json'), b'[1]')       # 304 -> cached copy
        self.assertEqual(_Handler.hits[-1][3], '"v1"')
        # First mirror down, second one answers
        body, url, stale = sources.fetch_first([f'{self.base}/missing.json', f'{self.base}/a.json'])
        self.assertEqual((body, url.endswith('/a.json'), stale), (b'[1]', True, False))

    def test_network_errors_use_the_cache_or_fail_cleanly(self):
        _Handler.routes['/b.json'] = (200, b'[2]', {})
        sources.fetch(f'{self.base}/b.json')
        _Handler.routes['/b.json'] = (500, b'boom', {})
        body, _, stale = sources.fetch_first([f'{self.base}/b.json'])
        self.assertEqual((body, stale), (b'[2]', True))
        with self.assertRaises(sources.FetchError):
            sources.fetch_first(['http://127.0.0.1:9/none.json'], timeout=2)   # refused, nothing cached

    def test_gzip_answers(self):
        _Handler.routes['/g.json'] = (200, gzip.compress(b'[3]'), {'Content-Encoding': 'gzip'})
        self.assertEqual(sources.fetch(f'{self.base}/g.json'), b'[3]')


class Checker(LocalServer):
    def test_hls_master_variant_and_errors(self):
        _Handler.routes.update({
            '/live/master.m3u8': (200, b'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow/index.m3u8\n', {'Content-Type': 'application/vnd.apple.mpegurl'}),
            '/live/low/index.m3u8': (200, b'#EXTM3U\n#EXTINF:6,\nseg1.ts\n', {}),
            '/dead/master.m3u8': (200, b'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nmissing.m3u8\n', {}),
            '/geo.m3u8': (403, b'no', {}),
            '/html.m3u8': (200, b'<html>blocked</html>', {}),
            '/video.ts': (200, b'\x47' * 188, {'Content-Type': 'video/mp2t'}),
            '/empty.ts': (200, b'', {}),
        })
        ok = stream_checker.check(f'{self.base}/live/master.m3u8', 'UA/9', 'https://r.example/')
        self.assertEqual(ok['status'], 'online')
        self.assertEqual(_Handler.hits[0][1:3], ('UA/9', 'https://r.example/'))      # headers of the catalogue sent
        self.assertEqual(stream_checker.check(f'{self.base}/dead/master.m3u8')['status'], 'offline')
        geo = stream_checker.check(f'{self.base}/geo.m3u8')
        self.assertEqual((geo['status'], geo['code']), ('offline', 403))
        self.assertIn('géo', geo['reason'])
        self.assertEqual(stream_checker.check(f'{self.base}/html.m3u8')['reason'], 'pas une playlist HLS')
        self.assertEqual(stream_checker.check(f'{self.base}/video.ts')['status'], 'online')
        self.assertEqual(stream_checker.check(f'{self.base}/empty.ts')['status'], 'offline')
        self.assertEqual(stream_checker.check('ftp://x.example/a')['status'], 'offline')
        self.assertEqual(stream_checker.check('http://127.0.0.1:9/x.m3u8', timeout=2)['status'], 'offline')

    def test_local_addresses_refused_outside_tests(self):
        os.environ.pop('IPTV_ALLOW_PRIVATE')
        res = stream_checker.check(f'{self.base}/video.ts')
        self.assertEqual((res['status'], res['reason']), ('offline', 'adresse locale refusée'))

    def test_many_at_once_keeps_ids(self):
        _Handler.routes['/video.ts'] = (200, b'x', {})
        res = list(stream_checker.check_many([{'id': 'a', 'url': f'{self.base}/video.ts'}, {'id': 'b', 'url': f'{self.base}/nope'}]))
        self.assertEqual(sorted((r['id'], r['status']) for r in res), [('a', 'online'), ('b', 'offline')])


class Guide(unittest.TestCase):
    XML = b'''<?xml version="1.0"?><tv>
      <channel id="TF1.fr@SD"><display-name>TF1</display-name></channel>
      <programme start="20251109200000 +0100" stop="20251109210000 +0100" channel="TF1.fr@SD"><title>Journal</title><desc>Infos</desc></programme>
      <programme start="20251109210000 +0100" stop="20251109230000 +0100" channel="TF1.fr@SD"><title>Film</title></programme>
      <programme start="20251101000000 +0000" stop="20251101010000 +0000" channel="TF1.fr@SD"><title>Old</title></programme>
      <programme start="20251109200000 +0000" stop="20251109210000 +0000" channel="Other.fr"><title>Skip</title></programme>
      <programme start="bad" stop="20251109210000 +0000" channel="TF1.fr"><title>Bad time</title></programme>
    </tv>'''

    def test_times_with_offsets(self):
        self.assertEqual(epg.parse_time('20251109200000 +0100').astimezone(dt.timezone.utc).hour, 19)
        self.assertEqual(epg.parse_time('20251109200000').tzinfo, dt.timezone.utc)
        self.assertIsNone(epg.parse_time('nope'))

    def test_only_wanted_channels_in_the_window(self):
        start = dt.datetime(2025, 11, 9, 12, tzinfo=dt.timezone.utc)
        for raw in (self.XML, gzip.compress(self.XML)):
            progs = epg.parse_xmltv(epg.open_maybe_gzip(raw), {'TF1.fr'}, start, start + dt.timedelta(days=1))
            self.assertEqual([p['title'] for p in progs['TF1.fr']], ['Journal', 'Film'])
            self.assertEqual(progs['TF1.fr'][0]['description'], 'Infos')
            self.assertNotIn('Other.fr', progs)


class CommandLine(LocalServer):
    def test_refresh_builds_the_catalogue_from_the_api(self):
        for name, data in API.items():
            _Handler.routes[f'/api/{name}.json'] = (200, json.dumps(data).encode(), {})
        _Handler.routes['/index.m3u'] = (200, M3U.encode(), {})
        env = {**os.environ, 'IPTV_API_BASE': f'{self.base}/api', 'IPTV_PLAYLIST_URL': f'{self.base}/index.m3u'}
        out = Path(self.tmp.name) / 'cat.json'
        res = subprocess.run([sys.executable, str(HERE.parent / 'iptv_cli.py'), '--json', 'refresh', '--out', str(out)],
                             capture_output=True, text=True, env=env, timeout=60)
        last = json.loads(res.stdout.strip().splitlines()[-1])
        self.assertEqual(last['type'], 'done', res.stderr)
        self.assertEqual(last['source'], 'api')
        data = json.loads(out.read_text())
        self.assertIn('TF1.fr', {c['id'] for c in data['channels']})
        self.assertEqual(data['countries'][0]['code'], 'FR')

    def test_refresh_falls_back_to_the_playlist_then_fails_cleanly(self):
        _Handler.routes['/index.m3u'] = (200, M3U.encode(), {})
        env = {**os.environ, 'IPTV_API_BASE': f'{self.base}/nothing', 'IPTV_PLAYLIST_URL': f'{self.base}/index.m3u'}
        res = subprocess.run([sys.executable, str(HERE.parent / 'iptv_cli.py'), '--json', 'refresh'], capture_output=True, text=True, env=env, timeout=60)
        self.assertEqual(json.loads(res.stdout.strip().splitlines()[-1])['source'], 'playlist')
        env['IPTV_PLAYLIST_URL'] = f'{self.base}/none.m3u'
        os.environ['IPTV_DATA_DIR'] = env['IPTV_DATA_DIR'] = tempfile.mkdtemp()   # nothing cached
        res = subprocess.run([sys.executable, str(HERE.parent / 'iptv_cli.py'), '--json', 'refresh'], capture_output=True, text=True, env=env, timeout=60)
        last = json.loads(res.stdout.strip().splitlines()[-1])
        self.assertEqual((last['type'], res.returncode), ('error', 1))

    def test_check_command(self):
        _Handler.routes['/video.ts'] = (200, b'x', {})
        items = json.dumps([{'id': 'a', 'url': f'{self.base}/video.ts'}, {'bad': 1}])
        res = subprocess.run([sys.executable, str(HERE.parent / 'iptv_cli.py'), '--json', 'check'], input=items,
                             capture_output=True, text=True, env=os.environ.copy(), timeout=60)
        lines = [json.loads(line) for line in res.stdout.splitlines()]
        self.assertEqual(lines[0]['status'], 'online')
        self.assertEqual(lines[-1], {'type': 'done', 'checked': 1})


if __name__ == '__main__':
    unittest.main()
