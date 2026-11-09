"""M3U playlist reader (the iptv-org format, and the usual IPTV variants).

    #EXTM3U
    #EXTINF:-1 tvg-id="TF1.fr@SD" tvg-logo="https://…/tf1.png" group-title="General;News",TF1 (1080p)
    #EXTVLCOPT:http-user-agent=Mozilla/5.0 …
    #EXTVLCOPT:http-referrer=https://example.com/
    https://example.com/tf1/index.m3u8

Malformed lines are skipped, never fatal: an entry without URL, a URL without #EXTINF
(kept with its URL as name), unknown tags, Windows line ends, a missing #EXTM3U header.
"""
from __future__ import annotations

import re
from typing import Iterable, List

from .models import PlaylistEntry

# key="value" pairs of an #EXTINF line (values may contain spaces and commas)
_ATTR = re.compile(r'([A-Za-z0-9_-]+)="([^"]*)"')
_URL = re.compile(r'^(https?|rtmps?|rtsp|udp|rtp)://', re.I)


def _split_extinf(line: str):
    """'#EXTINF:-1 a="b" c="d",Name' -> ({a: b, c: d}, 'Name'). The name follows the last comma
    outside quotes."""
    body = line[len('#EXTINF:'):]
    in_quotes = False
    cut = -1
    for i, ch in enumerate(body):
        if ch == '"':
            in_quotes = not in_quotes
        elif ch == ',' and not in_quotes:
            cut = i
    head, name = (body[:cut], body[cut + 1:]) if cut >= 0 else (body, '')
    attrs = {k.lower(): v.strip() for k, v in _ATTR.findall(head)}
    return attrs, name.strip()


def parse_m3u(text: str) -> List[PlaylistEntry]:
    entries: List[PlaylistEntry] = []
    pending = None            # (attrs, name) of the last #EXTINF
    ua = ref = None
    for raw in text.splitlines():
        line = raw.strip().lstrip('﻿')
        if not line:
            continue
        if line.startswith('#EXTINF'):
            pending = _split_extinf(line)
            ua = pending[0].get('http-user-agent') or pending[0].get('user-agent')
            ref = pending[0].get('http-referrer') or pending[0].get('referrer')
            continue
        if line.startswith('#EXTVLCOPT:'):
            opt = line[len('#EXTVLCOPT:'):]
            key, _, value = opt.partition('=')
            if key.strip().lower() == 'http-user-agent' and value.strip():
                ua = value.strip()
            elif key.strip().lower() in ('http-referrer', 'http-referer') and value.strip():
                ref = value.strip()
            continue
        if line.startswith('#'):
            continue          # #EXTM3U, #EXTGRP and other tags
        if not _URL.match(line):
            pending, ua, ref = None, None, None      # garbage line: forget the half entry
            continue
        attrs, name = pending if pending else ({}, '')
        entries.append(PlaylistEntry(name=name or line, url=line, attrs=attrs, user_agent=ua, referrer=ref))
        pending, ua, ref = None, None, None
    return entries


def group_titles(entry: PlaylistEntry) -> List[str]:
    """group-title="News;General" -> ['News', 'General'] (iptv-org separates categories with ';')."""
    raw = entry.attrs.get('group-title') or ''
    return [g.strip() for g in raw.split(';') if g.strip() and g.strip().lower() != 'undefined']


def channel_id(entry: PlaylistEntry) -> str:
    """tvg-id="TF1.fr@SD" -> 'TF1.fr' (the feed after @ is not part of the channel id)."""
    return (entry.attrs.get('tvg-id') or '').split('@')[0].strip()


def iter_urls(entries: Iterable[PlaylistEntry]):
    for e in entries:
        yield e.url
