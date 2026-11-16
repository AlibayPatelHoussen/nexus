"""Playlists added in Nexus (IPTV › Paramètres): the owner's own M3U lists (a subscription, a
list of free channels…), given by address or as a file.

Each one's live channels become channels of their own, never merged into iptv-org's: id
« pl-<playlist>-<hash> », in the playlist's order (`rank`), source « playlist ». The same name
twice (« TF1 HD », « TF1 FHD ») is one channel with two streams.

Left out: video on demand (Xtream /movie/ and /series/ addresses, video files), adult groups,
separators (« --- FRANCE TV --- » with a dummy address such as http://0.1.5.0:1224) and DASH.
Names lose Kodi's tags ([COLOR …], [B]); a « FR - », « FR: » or « |FR| » prefix gives the country
when tvg-country does not.
"""
from __future__ import annotations

import hashlib
import re
import urllib.parse
from typing import Dict, List, Optional, Set, Tuple

from .freetv import norm, url_kind
from .models import Channel, Stream
from .playlist_parser import group_titles, parse_m3u

SOURCE = 'playlist'
MAX_CHANNELS = 5000
_KODI = re.compile(r'\[/?(?:COLOR[^\]]*|B|I|U|UPPERCASE|LOWERCASE|CAPITALIZE|LIGHT|CR)\]', re.I)
_PREFIX = re.compile(r'^\|?\s*([A-Z]{2})\s*(?:\||-|:|»|►)\s*')
_VOD_PATH = re.compile(r'/(?:movie|movies|series|vod)/', re.I)
_VOD_FILE = re.compile(r'\.(?:mp4|mkv|avi|mov|wmv|flv|m4v|webm)$', re.I)
_ADULT = re.compile(r'(?:^|\W)(?:xxx|adults?|18\+|porn\w*)(?:\W|$)', re.I)
_COUNTRY_ALIAS = {'GB': 'UK'}
_ID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')


def clean_name(raw: str) -> str:
    """'[COLOR yellow]TF1[/COLOR] HD' -> 'TF1 HD'"""
    return ' '.join(_KODI.sub('', raw or '').split())


def split_country(name: str, known: Set[str]) -> Tuple[str, Optional[str]]:
    """'FR - TF1 HD' -> ('TF1 HD', 'FR'); a prefix that is not a country stays in the name."""
    m = _PREFIX.match(name)
    if not m:
        return name, None
    code = _COUNTRY_ALIAS.get(m.group(1), m.group(1))
    if known and code not in known:
        return name, None
    rest = name[m.end():].strip()
    return (rest or name), code


def is_dummy(url: str) -> bool:
    """A separator's address (http://0.1.5.0:1224): no real server."""
    host = urllib.parse.urlsplit(url).hostname or ''
    return not host or bool(re.match(r'^0\.\d+\.\d+\.\d+$', host))


def is_vod(url: str) -> bool:
    """A film or an episode on demand (Xtream /movie/ and /series/, a video file), not a live."""
    path = urllib.parse.urlsplit(url).path
    return bool(_VOD_PATH.search(path) or _VOD_FILE.search(path))


def channels_from(playlist_id: str, text: str, known_countries: Set[str]) -> Tuple[List[Channel], Dict[str, int]]:
    """The live channels of one playlist -> (channels in the playlist's order, stats)."""
    if not _ID.match(playlist_id):
        raise ValueError('playlist id')
    stats = {'entries': 0, 'vod': 0, 'skipped': 0}
    by_key: Dict[str, Channel] = {}
    out: List[Channel] = []
    for e in parse_m3u(text):
        if not (e.url.startswith('http://') or e.url.startswith('https://')):
            stats['skipped'] += 1
            continue
        if is_dummy(e.url):
            stats['skipped'] += 1
            continue
        if is_vod(e.url):
            stats['vod'] += 1
            continue
        if url_kind(e.url) == 'dash':
            stats['skipped'] += 1
            continue
        groups = group_titles(e)
        raw = clean_name(e.name) or clean_name(e.attrs.get('tvg-name') or '')
        if any(_ADULT.search(g) for g in groups) or _ADULT.search(raw):
            stats['skipped'] += 1
            continue
        name, prefixed = split_country(raw, known_countries)
        country = (e.attrs.get('tvg-country') or '').strip().upper()[:2]
        country = _COUNTRY_ALIAS.get(country, country)
        if not re.fullmatch(r'[A-Z]{2}', country) or (known_countries and country not in known_countries):
            country = prefixed
        if not name or name == e.url:
            stats['skipped'] += 1
            continue
        stats['entries'] += 1
        key = f'{norm(name) or name.casefold()}|{country or ""}'
        ch = by_key.get(key)
        if ch is None:
            if len(out) >= MAX_CHANNELS:
                stats['skipped'] += 1
                continue
            digest = hashlib.sha1(key.encode()).hexdigest()[:12]
            ch = Channel(id=f'pl-{playlist_id[:8]}-{digest}', name=name, country=country,
                         playlist=playlist_id, rank=len(out) + 1)
            logo = e.attrs.get('tvg-logo') or ''
            if logo.startswith('http://') or logo.startswith('https://'):
                ch.logo = logo
            by_key[key] = ch
            out.append(ch)
        if not any(st.url == e.url for st in ch.streams):
            ch.streams.append(Stream(url=e.url, title=name, referrer=e.referrer, user_agent=e.user_agent, source=SOURCE))
    return out, stats
