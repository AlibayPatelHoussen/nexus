"""Builds the Nexus IPTV catalogue from the iptv-org data.

Rules (what is shown is what the data says, nothing is made up):
- one channel per iptv-org channel id, with every stream it has (duplicates by URL removed),
  the main feed's stream first, then by quality;
- country, categories and languages only come from the database (channels.json, feeds.json);
  a stream without channel (iptv-org lists some) is kept with its title only;
- left out: channels of the blocklist (withdrawn on the rights holder's request — DMCA — or
  adult content), channels marked is_nsfw or in the « xxx » category, closed channels;
- logo: the channel's logo in use (feed-specific last), PNG/JPEG/WebP first;
- when the API cannot be had at all but the M3U playlist can, the catalogue is built from the
  playlist alone (names, logos, categories of group-title; no country, no language).
"""
from __future__ import annotations

import hashlib
import re
from typing import Dict, Iterable, List, Optional

from .models import Channel, PlaylistEntry, Stream
from .playlist_parser import channel_id, group_titles

_QUALITY = re.compile(r'(\d{3,4})p')
_TITLE_SUFFIX = re.compile(r'\s*[\[(](\d{3,4}p|geo-blocked|not 24/7)[\])]\s*', re.I)
_LOGO_RANK = {'PNG': 0, 'JPEG': 0, 'WEBP': 0, 'AVIF': 1, 'SVG': 1, 'GIF': 2, 'APNG': 2}


def _quality(q: Optional[str]) -> int:
    m = _QUALITY.search(q or '')
    return int(m.group(1)) if m else 0


def _clean_title(title: str) -> str:
    return _TITLE_SUFFIX.sub(' ', title or '').strip()


def _unlisted_id(url: str) -> str:
    return 'stream-' + hashlib.sha1(url.encode()).hexdigest()[:12]


def _is_web_url(url: str) -> bool:
    return url.startswith('http://') or url.startswith('https://')


def excluded_ids(channels: List[dict], blocklist: List[dict]) -> set:
    out = {b.get('channel') for b in blocklist if b.get('channel')}
    for c in channels:
        if c.get('is_nsfw') or 'xxx' in (c.get('categories') or []) or c.get('closed'):
            out.add(c['id'])
    return out


def pick_logo(entries: Iterable[dict], main_feed: Optional[str]) -> Optional[str]:
    best, best_key = None, None
    for lg in entries:
        url = lg.get('url')
        if not url or not _is_web_url(url):
            continue
        feed = lg.get('feed')
        key = (
            0 if lg.get('in_use', True) else 1,
            0 if feed is None else (1 if feed == main_feed else 2),
            _LOGO_RANK.get(str(lg.get('format') or '').upper(), 1),
            -min(int(lg.get('width') or 0), 1000),
        )
        if best_key is None or key < best_key:
            best, best_key = url, key
    return best


def build_from_api(api: Dict[str, list], playlist: Optional[List[PlaylistEntry]] = None) -> List[Channel]:
    channels = {c['id']: c for c in api.get('channels') or [] if c.get('id')}
    skip = excluded_ids(list(channels.values()), api.get('blocklist') or [])

    feeds_by_channel: Dict[str, Dict[str, dict]] = {}
    for f in api.get('feeds') or []:
        if f.get('channel'):
            feeds_by_channel.setdefault(f['channel'], {})[f.get('id')] = f
    logos_by_channel: Dict[str, List[dict]] = {}
    for lg in api.get('logos') or []:
        if lg.get('channel'):
            logos_by_channel.setdefault(lg['channel'], []).append(lg)
    # The playlist's logos (tvg-logo) for channels the API has none for
    playlist_logo = {}
    for e in playlist or []:
        cid, logo = channel_id(e), e.attrs.get('tvg-logo')
        if cid and logo and _is_web_url(logo):
            playlist_logo.setdefault(cid, logo)

    out: Dict[str, Channel] = {}
    seen_urls = set()
    for s in api.get('streams') or []:
        url = (s.get('url') or '').strip()
        if not url or not _is_web_url(url) or url in seen_urls:
            continue
        cid = s.get('channel')
        if cid and (cid in skip or cid not in channels):
            if cid in skip:
                continue
            cid = None            # unknown id: keep the stream, without metadata
        seen_urls.add(url)
        stream = Stream(url=url, title=_clean_title(s.get('title') or ''), feed=s.get('feed'),
                        quality=s.get('quality'), referrer=s.get('referrer') or None,
                        user_agent=s.get('user_agent') or None, labels=list(s.get('labels') or []))
        if not cid:
            name = stream.title or url
            out[_unlisted_id(url)] = Channel(id=_unlisted_id(url), name=name, streams=[stream])
            continue
        ch = out.get(cid)
        if ch is None:
            meta = channels[cid]
            ch = out[cid] = Channel(
                id=cid, name=meta.get('name') or cid, country=meta.get('country') or None,
                categories=[c for c in meta.get('categories') or [] if c != 'xxx'],
                website=meta.get('website') or None, network=meta.get('network') or None,
                alt_names=list(meta.get('alt_names') or []),
            )
        ch.streams.append(stream)

    for cid, ch in out.items():
        feeds = feeds_by_channel.get(cid, {})
        main = next((fid for fid, f in feeds.items() if f.get('is_main')), None)
        langs: List[str] = []
        for st in ch.streams:
            feed = feeds.get(st.feed or main) or feeds.get(main)
            for lang in (feed or {}).get('languages') or []:
                if lang not in langs:
                    langs.append(lang)
        ch.languages = langs
        # Best stream first: main feed, no « Geo-blocked », https, then the highest quality
        ch.streams.sort(key=lambda st: (
            0 if (st.feed or main) == main else 1,
            1 if 'Geo-blocked' in st.labels else 0,
            0 if st.url.startswith('https://') else 1,
            -_quality(st.quality),
        ))
        ch.logo = pick_logo(logos_by_channel.get(cid, []), main) or playlist_logo.get(cid)
    return sorted(out.values(), key=lambda c: c.name.casefold())


def build_from_playlist(entries: List[PlaylistEntry]) -> List[Channel]:
    """Fallback without the API: only what the playlist itself says."""
    out: Dict[str, Channel] = {}
    seen = set()
    for e in entries:
        if not _is_web_url(e.url) or e.url in seen:
            continue
        seen.add(e.url)
        groups = group_titles(e)
        if any(g.lower() in ('xxx', 'adult') for g in groups):
            continue
        cid = channel_id(e) or _unlisted_id(e.url)
        stream = Stream(url=e.url, title=_clean_title(e.name), referrer=e.referrer, user_agent=e.user_agent,
                        quality=(_QUALITY.search(e.name).group(0) if _QUALITY.search(e.name) else None))
        ch = out.get(cid)
        if ch is None:
            logo = e.attrs.get('tvg-logo')
            ch = out[cid] = Channel(id=cid, name=_clean_title(e.name) or e.url,
                                    categories=[g.lower() for g in groups],
                                    logo=logo if logo and _is_web_url(logo) else None)
        ch.streams.append(stream)
    return sorted(out.values(), key=lambda c: c.name.casefold())


def facets(channels: List[Channel], api: Dict[str, list]) -> dict:
    """Countries, categories and languages that have at least one channel, with their counts
    and names from the API."""
    def count(values):
        counts: Dict[str, int] = {}
        for v in values:
            counts[v] = counts.get(v, 0) + 1
        return counts
    c_country = count(c.country for c in channels if c.country)
    c_cat = count(cat for c in channels for cat in c.categories)
    c_lang = count(lang for c in channels for lang in c.languages)
    countries = {x['code']: x for x in api.get('countries') or [] if x.get('code')}
    cats = {x['id']: x for x in api.get('categories') or [] if x.get('id')}
    langs = {x['code']: x for x in api.get('languages') or [] if x.get('code')}
    return {
        'countries': sorted(({'code': k, 'name': countries.get(k, {}).get('name', k), 'flag': countries.get(k, {}).get('flag'),
                              'count': n} for k, n in c_country.items()), key=lambda x: -x['count']),
        'categories': sorted(({'id': k, 'name': cats.get(k, {}).get('name', k.capitalize()), 'count': n}
                              for k, n in c_cat.items()), key=lambda x: -x['count']),
        'languages': sorted(({'code': k, 'name': langs.get(k, {}).get('name', k), 'count': n}
                             for k, n in c_lang.items()), key=lambda x: -x['count']),
    }
