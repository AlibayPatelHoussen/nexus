"""Free-TV/IPTV (https://github.com/Free-TV/IPTV) as a second source, merged into the catalogue.

Free-TV is a short hand-picked playlist (about 2 000 entries): free channels only, checked by
its maintainers, in each country's usual channel order. Its entries look like:

    #EXTINF:-1 tvg-name="TF1" tvg-logo="…" tvg-id="TF1.fr" tvg-country="FR" group-title="France",TF1 Ⓖ
    https://…/tf1.m3u8

Marks after the name: Ⓢ not HD, Ⓖ only in its country (GeoIP), Ⓨ a YouTube live, Ⓣ Twitch,
Ⓓ Dailymotion. A YouTube / Twitch / Dailymotion entry is the address of a web page, not of a
stream: it is kept as a « page » stream, looked up with yt-dlp when it is played.

How an entry joins the catalogue (nothing is made up: what Free-TV does not say stays empty):
- same channel id as an iptv-org channel (tvg-id), else same stream address, else the same name
  in the same country when only one channel has it: the stream is added to that channel;
- otherwise a new channel, with the name, country and logo of the playlist;
- left out: entries of channels on the iptv-org blocklist (withdrawn on the rights holder's
  request, or adult content), and DASH streams (.mpd), which the player cannot read.
Streams of a channel: Free-TV's first (hand-picked), then iptv-org's, web pages last.
`curated` keeps the place in the playlist: the channels people expect, in the order they expect.
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
import urllib.parse
from typing import Dict, List, Optional, Tuple

from .catalogue import _is_web_url, pick_logo
from .models import Channel, PlaylistEntry, Stream
from .playlist_parser import channel_id, group_titles
from .resolver import is_page

SOURCE = 'free-tv'
_MARKS = re.compile('[ⓈⒼⓎⓉⒹ]')
_ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._@+-]{0,119}$')      # the ids the server accepts
_NOISE = {'hd', 'fhd', 'uhd', 'sd', '4k'}
_COUNTRY_ALIAS = {'GB': 'UK'}                                    # iptv-org says UK
# Thematic groups (the other groups are country names): the only categories / languages Free-TV gives
_GROUP_CATEGORY = {'news': 'news', 'business': 'business', 'weather': 'weather', 'documentaries': 'documentary',
                   'music': 'music', 'vod movies': 'movies'}
_GROUP_LANGUAGE = {'en': 'eng', 'ar': 'ara', 'es': 'spa', 'fr': 'fra'}
_GROUP = re.compile(r'^(.*?)\s*(?:\(([A-Za-z]{2})\))?$')


def split_name(raw: str) -> Tuple[str, List[str], Optional[str]]:
    """'TF1 ⒼⓈ' -> ('TF1', ['Geo-blocked'], 'SD')"""
    name = ' '.join(_MARKS.sub(' ', raw or '').split())
    return name, (['Geo-blocked'] if 'Ⓖ' in (raw or '') else []), ('SD' if 'Ⓢ' in (raw or '') else None)


def url_kind(url: str) -> str:
    """'page' (a web page with a live player), 'dash' (not readable here) or 'hls' (a direct stream)."""
    if is_page(url):
        return 'page'
    if urllib.parse.urlsplit(url).path.lower().endswith('.mpd'):
        return 'dash'
    return 'hls'


def norm(name: str) -> str:
    """'France 2 HD' and 'FRANCE 2' compare equal; 'Canal+' and 'Canal' do not."""
    text = unicodedata.normalize('NFKD', (name or '').replace('+', ' plus ').replace('&', ' and '))
    text = ''.join(ch for ch in text if not unicodedata.combining(ch)).casefold()
    return ' '.join(t for t in re.findall(r'\w+', text) if t not in _NOISE)


def _blocked_ids(api: Dict[str, list]) -> set:
    out = {b.get('channel') for b in api.get('blocklist') or [] if b.get('channel')}
    for c in api.get('channels') or []:
        if c.get('is_nsfw') or 'xxx' in (c.get('categories') or []):
            out.add(c.get('id'))
    return out


def merge(channels: List[Channel], entries: List[PlaylistEntry], api: Dict[str, list]) -> Tuple[List[Channel], dict]:
    """Adds the Free-TV entries to `channels` (the catalogue built from iptv-org, possibly empty).
    -> (channels sorted by name, {entries, matched, added, blocked, dash, pages})"""
    stats = {'entries': 0, 'matched': 0, 'added': 0, 'blocked': 0, 'dash': 0, 'pages': 0}
    api_channels = {c['id']: c for c in api.get('channels') or [] if c.get('id')}
    blocked = _blocked_ids(api)
    country_codes = {c['code'] for c in api.get('countries') or [] if c.get('code')}
    country_by_name = {str(c.get('name', '')).casefold(): c['code'] for c in api.get('countries') or [] if c.get('code')}

    by_id: Dict[str, Channel] = {c.id: c for c in channels}
    by_url: Dict[str, Channel] = {}
    by_name: Dict[tuple, List[Channel]] = {}          # (name, country) -> channels
    by_name_only: Dict[str, List[Channel]] = {}

    def index_names(ch: Channel) -> None:
        for n in {norm(x) for x in [ch.name, *ch.alt_names]} - {''}:
            by_name.setdefault((n, ch.country), []).append(ch)
            by_name_only.setdefault(n, []).append(ch)

    for ch in channels:
        index_names(ch)
        for st in ch.streams:
            by_url.setdefault(st.url, ch)
    blocked_names = set()
    for cid in blocked:
        meta = api_channels.get(cid)
        if meta:
            for n in {norm(x) for x in [meta.get('name') or '', *(meta.get('alt_names') or [])]} - {''}:
                blocked_names.add((n, meta.get('country') or None))

    feeds_main: Dict[str, dict] = {}
    for f in api.get('feeds') or []:
        if f.get('channel') and f.get('is_main'):
            feeds_main.setdefault(f['channel'], f)
    logos: Dict[str, List[dict]] = {}

    def from_api(cid: str) -> Channel:
        """A channel iptv-org knows but has no stream for: its data, Free-TV's stream."""
        if not logos:
            for lg in api.get('logos') or []:
                if lg.get('channel'):
                    logos.setdefault(lg['channel'], []).append(lg)
        meta = api_channels[cid]
        main = feeds_main.get(cid) or {}
        return Channel(
            id=cid, name=meta.get('name') or cid, country=meta.get('country') or None,
            categories=[c for c in meta.get('categories') or [] if c != 'xxx'],
            languages=list(main.get('languages') or []), logo=pick_logo(logos.get(cid, []), main.get('id')),
            website=meta.get('website') or None, network=meta.get('network') or None,
            alt_names=list(meta.get('alt_names') or []),
        )

    touched: Dict[str, Channel] = {}
    for rank, e in enumerate(entries, start=1):
        if not _is_web_url(e.url):
            continue
        groups = group_titles(e)
        if any(g.lower() in ('xxx', 'adult') for g in groups):
            continue
        name, labels, quality = split_name(e.name)
        name = name or split_name(e.attrs.get('tvg-name') or '')[0] or e.url
        kind = url_kind(e.url)
        if kind == 'dash':
            stats['dash'] += 1
            continue

        country = (e.attrs.get('tvg-country') or '').strip().upper()
        country = _COUNTRY_ALIAS.get(country, country)
        if not re.fullmatch(r'[A-Z]{2}', country) or (country_codes and country not in country_codes):
            country = next((country_by_name[g.casefold()] for g in groups if g.casefold() in country_by_name), None)
        key = norm(name)
        tid = channel_id(e)
        if tid in blocked or (key and (key, country) in blocked_names):
            stats['blocked'] += 1
            continue
        stats['entries'] += 1
        if kind == 'page':
            stats['pages'] += 1

        ch = by_id.get(tid) if tid else None
        known = ch is not None
        if ch is None and tid in api_channels:
            ch = from_api(tid)
        if ch is None and e.url in by_url:
            ch, known = by_url[e.url], True
        if ch is None and key:
            same = by_name.get((key, country), []) if country else by_name_only.get(key, [])
            if len({c.id for c in same}) == 1:
                ch, known = same[0], True
        if ch is None:
            cid = tid if tid and _ID.match(tid) else 'freetv-' + hashlib.sha1(f'{key or name}|{country or ""}'.encode()).hexdigest()[:12]
            ch = by_id.get(cid)
            if ch is None:
                categories, languages = [], []
                for g in groups:
                    m = _GROUP.match(g)
                    cat = _GROUP_CATEGORY.get((m.group(1) if m else g).casefold())
                    if cat and cat not in categories:
                        categories.append(cat)
                        lang = _GROUP_LANGUAGE.get((m.group(2) or '').casefold()) if m else None
                        if lang and lang not in languages:
                            languages.append(lang)
                ch = Channel(id=cid, name=name, country=country, categories=categories, languages=languages)
        if ch.id not in by_id:
            by_id[ch.id] = ch
            index_names(ch)
            stats['added'] += 1
        elif known and ch.id not in touched:
            stats['matched'] += 1
        touched[ch.id] = ch

        mine = next((st for st in ch.streams if st.url == e.url), None)
        if mine is None:
            mine = Stream(url=e.url, title=name, quality=quality, referrer=e.referrer, user_agent=e.user_agent,
                          labels=labels, kind='page' if kind == 'page' else 'hls')
            ch.streams.append(mine)
            by_url.setdefault(e.url, ch)
        mine.source = SOURCE
        if ch.curated is None or rank < ch.curated:
            ch.curated = rank
        logo = e.attrs.get('tvg-logo')
        if not ch.logo and logo and _is_web_url(logo):
            ch.logo = logo

    for ch in touched.values():       # sorted() keeps the order inside each group
        ch.streams = sorted(ch.streams, key=lambda st: 2 if st.kind == 'page' else (0 if st.source == SOURCE else 1))
    return sorted(by_id.values(), key=lambda c: c.name.casefold()), stats
