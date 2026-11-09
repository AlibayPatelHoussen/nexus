"""Tests of the IPTV module (no internet: a local HTTP server plays iptv-org and Free-TV,
a small script plays yt-dlp).
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

from iptv import catalogue, epg, freetv, resolver, sources, stream_checker  # noqa: E402
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


FREETV = '''#EXTM3U
#EXTINF:-1 tvg-name="TF1" tvg-logo="https://img.example/freetv-tf1.png" tvg-id="TF1.fr" tvg-country="FR" group-title="France",TF1 ⒼⓈ
https://free.example/tf1.m3u8
#EXTINF:-1 tvg-name="TF1" tvg-id="TF1.fr" tvg-country="FR" group-title="France",TF1 Ⓨ
https://www.youtube.com/@tf1/live
#EXTINF:-1 tvg-name="Kids" tvg-country="FR" group-title="France",Kids
https://tv.example/kids.m3u8
#EXTINF:-1 tvg-name="Plain HD" tvg-logo="https://img.example/plain.png" tvg-country="IT" group-title="Italy",PLAIN HD
https://free.example/plain.m3u8
#EXTINF:-1 tvg-name="Silent" tvg-id="Silent.fr" tvg-country="FR" group-title="France",Silent
https://free.example/silent.m3u8
#EXTINF:-1 tvg-name="Pirate" tvg-id="Pirate.us" tvg-country="US" group-title="USA",Pirate
https://free.example/pirate.m3u8
#EXTINF:-1 tvg-name="Pirate" tvg-country="US" group-title="USA",Pirate HD
https://free.example/pirate2.m3u8
#EXTINF:-1 tvg-name="Dash" tvg-id="Dash.ca" tvg-country="CA" group-title="Canada",Dash
https://free.example/live/manifest.mpd?token=1
#EXTINF:-1 tvg-name="BBC One" tvg-id="BBCOne.uk" tvg-country="GB" group-title="UK",BBC One Ⓖ
https://free.example/bbc1.m3u8
#EXTINF:-1 tvg-name="Rai Storia" group-title="Italy",Rai Storia
https://free.example/storia.m3u8
#EXTINF:-1 tvg-name="World News" tvg-logo="https://img.example/wn.png" group-title="News (AR)",World News Ⓨ
https://www.youtube.com/c/worldnews/live
#EXTINF:-1 tvg-name="Radio" group-title="France",Radio
rtmp://free.example/radio
'''


class FreeTv(unittest.TestCase):
    def setUp(self):
        self.api = {**API,
                    'channels': API['channels'] + [{'id': 'Silent.fr', 'name': 'Silent TV', 'country': 'FR', 'categories': ['culture'],
                                                    'is_nsfw': False, 'closed': None, 'website': 'https://silent.example'}],
                    'feeds': API['feeds'] + [{'channel': 'Silent.fr', 'id': 'SD', 'is_main': True, 'languages': ['fra']}],
                    'countries': API['countries'] + [{'code': 'UK', 'name': 'United Kingdom', 'flag': '🇬🇧'},
                                                     {'code': 'US', 'name': 'United States', 'flag': '🇺🇸'}]}
        merged, self.stats = freetv.merge(catalogue.build_from_api(self.api, parse_m3u(M3U)), parse_m3u(FREETV), self.api)
        self.channels = {c.id: c for c in merged}

    def test_marks_and_names(self):
        self.assertEqual(freetv.split_name('TF1 ⒼⓈ'), ('TF1', ['Geo-blocked'], 'SD'))
        self.assertEqual(freetv.split_name('franceinfo: Ⓨ'), ('franceinfo:', [], None))
        self.assertEqual(freetv.norm('France 2 HD'), freetv.norm('FRANCE 2'))
        self.assertEqual(freetv.norm('Télé Québec'), 'tele quebec')
        self.assertNotEqual(freetv.norm('Canal+'), freetv.norm('Canal'))
        self.assertEqual([freetv.url_kind(u) for u in ('https://youtu.be/x', 'https://www.dailymotion.com/video/x', 'https://a.example/x.mpd?t=1',
                                                       'https://a.example/x.m3u8', 'https://notyoutube.com.example/live')],
                         ['page', 'page', 'dash', 'hls', 'hls'])

    def test_same_id_adds_the_stream_first_and_keeps_the_database_data(self):
        tf1 = self.channels['TF1.fr']
        self.assertEqual([s.url for s in tf1.streams], [
            'https://free.example/tf1.m3u8',                                    # Free-TV first
            'http://tv.example/tf1-sd.m3u8', 'https://tv.example/tf1-hd.m3u8', 'https://tv.example/tf1-alsace.m3u8',
            'https://www.youtube.com/@tf1/live',                                 # the web page last
        ])
        first, page = tf1.streams[0], tf1.streams[-1]
        self.assertEqual((first.source, first.kind, first.quality, first.labels), ('free-tv', 'hls', 'SD', ['Geo-blocked']))
        self.assertEqual((page.source, page.kind), ('free-tv', 'page'))
        self.assertEqual((tf1.curated, tf1.logo, tf1.categories), (1, 'https://img.example/tf1.png', ['general']))
        as_json = tf1.to_json()
        self.assertEqual(as_json['streams'][-1]['kind'], 'page')
        self.assertNotIn('kind', as_json['streams'][0])                          # « hls » is the default: not written
        self.assertNotIn('source', as_json['streams'][1])                        # iptv-org streams are written as before

    def test_same_address_or_same_name_in_the_country(self):
        kids = self.channels['Kids.fr']                                          # same stream address
        self.assertEqual([(s.url, s.source, s.user_agent) for s in kids.streams], [('https://tv.example/kids.m3u8', 'free-tv', 'UA/2')])
        self.assertEqual(kids.curated, 3)
        plain = self.channels['Plain.it']                                        # « PLAIN HD » in Italy = « Plain »
        self.assertEqual([s.url for s in plain.streams], ['https://free.example/plain.m3u8', 'https://tv.example/plain.m3u8'])
        self.assertEqual(plain.logo, 'https://img.example/plain.png')            # it had none

    def test_channel_known_without_stream_and_new_channels(self):
        silent = self.channels['Silent.fr']                                      # in the database, no stream there
        self.assertEqual((silent.name, silent.country, silent.categories, silent.languages, silent.website),
                         ('Silent TV', 'FR', ['culture'], ['fra'], 'https://silent.example'))
        bbc = self.channels['BBCOne.uk']                                         # unknown: only what Free-TV says
        self.assertEqual((bbc.name, bbc.country, bbc.categories, bbc.languages, bbc.streams[0].labels), ('BBC One', 'UK', [], [], ['Geo-blocked']))
        storia = next(c for c in self.channels.values() if c.name == 'Rai Storia')
        self.assertTrue(storia.id.startswith('freetv-'))
        self.assertEqual(storia.country, 'IT')                                   # the group title is a country name
        news = next(c for c in self.channels.values() if c.name == 'World News')
        self.assertEqual((news.country, news.categories, news.languages, news.logo), (None, ['news'], ['ara'], 'https://img.example/wn.png'))
        self.assertEqual(news.streams[0].kind, 'page')

    def test_blocked_dash_and_other_protocols_are_left_out(self):
        urls = {s.url for c in self.channels.values() for s in c.streams}
        self.assertFalse({u for u in urls if 'pirate' in u or u.endswith('.mpd?token=1') or u.startswith('rtmp')})
        self.assertNotIn('Pirate.us', self.channels)
        self.assertNotIn('Dash.ca', self.channels)
        self.assertEqual(self.stats, {'entries': 8, 'matched': 3, 'added': 4, 'blocked': 2, 'dash': 1, 'pages': 2})

    def test_merge_is_stable_and_works_alone(self):
        again, _ = freetv.merge(catalogue.build_from_api(self.api, parse_m3u(M3U)), parse_m3u(FREETV), self.api)
        self.assertEqual([c.to_json() for c in again], [c.to_json() for c in sorted(self.channels.values(), key=lambda c: c.name.casefold())])
        alone, stats = freetv.merge([], parse_m3u(FREETV), {})                   # iptv-org down: nothing is filtered or enriched
        self.assertEqual(stats['added'], len(alone))
        self.assertEqual({c.id: c.country for c in alone if c.id in ('TF1.fr', 'BBCOne.uk')}, {'TF1.fr': 'FR', 'BBCOne.uk': 'UK'})


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


FAKE_YTDLP = '''import json, sys
url = sys.argv[-1]
assert sys.argv[-2] == '--' and '-J' in sys.argv, sys.argv
if 'offline' in url:
    sys.stderr.write('WARNING: something\\nERROR: [youtube] x: The channel is not currently live\\n'); sys.exit(1)
if 'robot' in url:
    sys.stderr.write('ERROR: [youtube] x: Sign in to confirm you\\u2019re not a bot\\n'); sys.exit(1)
if 'garbage' in url:
    print('not json'); sys.exit(0)
formats = [{'protocol': 'https', 'url': 'BASE/video.mp4', 'height': 1080}]
if 'novideo' not in url:
    formats += [
        {'protocol': 'm3u8_native', 'url': 'BASE/live/low/index.m3u8', 'height': 360},
        {'protocol': 'm3u8_native', 'url': 'BASE/live/hd/index.m3u8', 'manifest_url': 'BASE/live/master.m3u8?expire=1900000000&x=1',
         'height': 1080, 'http_headers': {'User-Agent': 'YT/1', 'Referer': 'https://www.youtube.com/'}},
    ]
print(json.dumps({'title': 'France 24 en direct', 'formats': formats}))
'''


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
        self.env = {'IPTV_DATA_DIR': self.tmp.name, 'IPTV_ALLOW_PRIVATE': '1', 'IPTV_FREETV_URL': 'off', 'IPTV_YTDLP': ''}
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

    def fake_ytdlp(self) -> None:
        """A stand-in for yt-dlp: answers like `yt-dlp -J <page>` for a few made-up pages."""
        script = Path(self.tmp.name) / 'fake_ytdlp.py'
        script.write_text(FAKE_YTDLP.replace('BASE', self.base))
        os.environ['IPTV_YTDLP'] = f'{sys.executable} {script}'


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
            '/video.mp4': (200, b'\x00\x00\x00\x18ftypmp42', {'Content-Type': 'video/mp4'}),
            '/radio': (200, b'\xff\xfb\x90\x00' * 64, {'Content-Type': 'audio/mpeg'}),
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
        self.assertEqual(stream_checker.check(f'{self.base}/video.mp4')['status'], 'online')
        self.assertEqual(stream_checker.check(f'{self.base}/radio')['status'], 'online')
        self.assertEqual(stream_checker.check(f'{self.base}/empty.ts')['status'], 'offline')
        self.assertEqual(stream_checker.check('ftp://x.example/a')['status'], 'offline')
        self.assertEqual(stream_checker.check('http://127.0.0.1:9/x.m3u8', timeout=2)['status'], 'offline')

    def test_answers_a_browser_cannot_play_are_offline_with_their_reason(self):
        ts = (b'\x47' + b'\x00' * 187) * 4
        _Handler.routes.update({
            '/direct.ts': (200, ts, {'Content-Type': 'video/mp2t'}),
            '/direct': (200, ts, {'Content-Type': 'application/octet-stream'}),       # MPEG-TS without saying so
            '/direct-page': (200, b'\n<!DOCTYPE html><html><body>Le direct</body></html>', {'Content-Type': 'text/html; charset=utf-8'}),
            '/live.mpd': (200, b'<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011"></MPD>', {'Content-Type': 'application/dash+xml'}),
            '/error': (200, b'{"error": "geo"}', {'Content-Type': 'application/json'}),
        })
        reasons = {path: stream_checker.check(f'{self.base}{path}') for path in ('/direct.ts', '/direct', '/direct-page', '/live.mpd', '/error')}
        self.assertEqual({r['status'] for r in reasons.values()}, {'offline'})
        self.assertIn('MPEG-TS', reasons['/direct.ts']['reason'])
        self.assertIn('MPEG-TS', reasons['/direct']['reason'])
        self.assertIn('page web', reasons['/direct-page']['reason'])
        self.assertIn('DASH', reasons['/live.mpd']['reason'])
        self.assertIn('inattendue', reasons['/error']['reason'])

    def test_page_streams_are_looked_up_then_checked(self):
        _Handler.routes.update({
            '/live/master.m3u8': (200, b'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow/index.m3u8\n', {}),
            '/live/low/index.m3u8': (200, b'#EXTM3U\n#EXTINF:6,\nseg1.ts\n', {}),
        })
        page = {'id': 'p', 'url': 'https://www.youtube.com/c/FRANCE24/live', 'kind': 'page'}
        os.environ['IPTV_YTDLP'] = str(Path(self.tmp.name) / 'no-such-yt-dlp')
        missing = stream_checker.check_item(page)                 # yt-dlp not installed: nothing known, not « offline »
        self.assertEqual((missing['status'], 'yt-dlp' in missing['reason']), ('unknown', True))
        self.fake_ytdlp()
        self.assertEqual(stream_checker.check_item(page)['status'], 'online')
        self.assertEqual(_Handler.hits[0][:2], ('/live/master.m3u8?expire=1900000000&x=1', 'YT/1'))   # the stream found, with its headers
        off = stream_checker.check_item({**page, 'url': 'https://www.youtube.com/c/offline/live'})
        self.assertEqual((off['status'], off['reason']), ('offline', 'pas de direct en cours'))
        res = {r['id']: r['status'] for r in stream_checker.check_many([page, {'id': 'h', 'url': f'{self.base}/live/master.m3u8'}])}
        self.assertEqual(res, {'p': 'online', 'h': 'online'})

    def test_local_addresses_refused_outside_tests(self):
        os.environ.pop('IPTV_ALLOW_PRIVATE')
        res = stream_checker.check(f'{self.base}/video.ts')
        self.assertEqual((res['status'], res['reason']), ('offline', 'adresse locale refusée'))

    def test_many_at_once_keeps_ids(self):
        _Handler.routes['/video.ts'] = (200, b'x', {})
        res = list(stream_checker.check_many([{'id': 'a', 'url': f'{self.base}/video.ts'}, {'id': 'b', 'url': f'{self.base}/nope'}]))
        self.assertEqual(sorted((r['id'], r['status']) for r in res), [('a', 'online'), ('b', 'offline')])


class Resolver(LocalServer):
    def test_only_known_video_sites(self):
        self.assertTrue(resolver.is_page('https://www.youtube.com/c/FRANCE24/live'))
        self.assertTrue(resolver.is_page('https://www.twitch.tv/somebody'))
        self.assertTrue(resolver.is_page('http://dai.ly/x3b68jn'))
        for url in ('https://lcp.fr/le-live-lcp-tnt-5433', 'https://youtube.com.evil.example/live', 'ftp://youtube.com/x', '', 'youtube.com'):
            self.assertFalse(resolver.is_page(url), url)
        self.fake_ytdlp()
        self.assertEqual(resolver.resolve('https://lcp.fr/le-live-lcp-tnt-5433'), {'ok': False, 'reason': 'failed', 'message': 'page non prise en charge'})

    def test_finds_the_hls_stream_with_its_headers_and_expiry(self):
        self.fake_ytdlp()
        found = resolver.resolve('https://www.youtube.com/c/FRANCE24/live')
        self.assertEqual(found, {'ok': True, 'url': f'{self.base}/live/master.m3u8?expire=1900000000&x=1', 'user_agent': 'YT/1',
                                 'referrer': 'https://www.youtube.com/', 'expires': 1900000000, 'title': 'France 24 en direct'})

    def test_failures_say_why(self):
        self.fake_ytdlp()
        for page, message in (('offline', 'pas de direct en cours'), ('robot', 'le site demande une connexion depuis ce serveur'),
                              ('novideo', 'pas de direct en cours'), ('garbage', 'réponse de yt-dlp illisible')):
            res = resolver.resolve(f'https://www.youtube.com/c/{page}/live')
            self.assertEqual((res['ok'], res['reason'], res['message']), (False, 'failed', message))
        os.environ['IPTV_YTDLP'] = str(Path(self.tmp.name) / 'no-such-yt-dlp')
        self.assertEqual(resolver.resolve('https://youtu.be/abc')['reason'], 'missing')


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

    def test_refresh_merges_free_tv_and_works_with_free_tv_alone(self):
        for name, data in API.items():
            _Handler.routes[f'/api/{name}.json'] = (200, json.dumps(data).encode(), {})
        _Handler.routes['/index.m3u'] = (200, M3U.encode(), {})
        _Handler.routes['/freetv.m3u8'] = (200, FREETV.encode(), {})
        env = {**os.environ, 'IPTV_API_BASE': f'{self.base}/api', 'IPTV_PLAYLIST_URL': f'{self.base}/index.m3u',
               'IPTV_FREETV_URL': f'{self.base}/freetv.m3u8'}
        out = Path(self.tmp.name) / 'cat.json'
        cmd = [sys.executable, str(HERE.parent / 'iptv_cli.py'), '--json', 'refresh', '--out', str(out)]
        res = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=60)
        last = json.loads(res.stdout.strip().splitlines()[-1])
        self.assertEqual((last['type'], last['source'], last['sources']), ('done', 'api', ['iptv-org', 'free-tv']), res.stderr)
        self.assertEqual((last['stats']['freetv_matched'], last['stats']['freetv_blocked'], last['stats']['freetv_dash'], last['stats']['freetv_pages']), (3, 1, 1, 2))
        tf1 = next(c for c in json.loads(out.read_text())['channels'] if c['id'] == 'TF1.fr')
        self.assertEqual((tf1['curated'], tf1['streams'][0]['url'], tf1['streams'][0]['source']), (1, 'https://free.example/tf1.m3u8', 'free-tv'))
        # iptv-org down, nothing cached: the catalogue is Free-TV alone, and says so
        env.update({'IPTV_API_BASE': f'{self.base}/nothing', 'IPTV_PLAYLIST_URL': f'{self.base}/none.m3u', 'IPTV_DATA_DIR': tempfile.mkdtemp()})
        res = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=60)
        last = json.loads(res.stdout.strip().splitlines()[-1])
        self.assertEqual((last['type'], last['source'], last['sources']), ('done', 'free-tv', ['free-tv']), res.stderr)
        self.assertTrue(any('Free-TV seul' in n for n in last['notes']))
        # Free-TV down: the iptv-org catalogue is kept, with a note
        env.update({'IPTV_API_BASE': f'{self.base}/api', 'IPTV_PLAYLIST_URL': f'{self.base}/index.m3u', 'IPTV_FREETV_URL': f'{self.base}/gone.m3u8'})
        res = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=60)
        last = json.loads(res.stdout.strip().splitlines()[-1])
        self.assertEqual((last['type'], last['sources']), ('done', ['iptv-org']), res.stderr)
        self.assertTrue(any(n.startswith('Free-TV : liste indisponible') for n in last['notes']))

    def test_resolve_command(self):
        self.fake_ytdlp()
        cmd = [sys.executable, str(HERE.parent / 'iptv_cli.py'), '--json', 'resolve', '--url']
        res = subprocess.run([*cmd, 'https://www.youtube.com/c/FRANCE24/live'], capture_output=True, text=True, env=os.environ.copy(), timeout=60)
        lines = [json.loads(line) for line in res.stdout.splitlines()]
        self.assertEqual((lines[0]['type'], lines[0]['url'], lines[0]['expires'], lines[-1]['type']),
                         ('resolved', f'{self.base}/live/master.m3u8?expire=1900000000&x=1', 1900000000, 'done'))
        res = subprocess.run([*cmd, 'https://www.youtube.com/c/offline/live'], capture_output=True, text=True, env=os.environ.copy(), timeout=60)
        last = json.loads(res.stdout.strip().splitlines()[-1])
        self.assertEqual((res.returncode, last['type'], last['reason'], last['message']), (1, 'error', 'failed', 'pas de direct en cours'))

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
