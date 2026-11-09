"""Programme guide (EPG) from an XMLTV file.

iptv-org does not publish ready guide files (guides.json lists the sites a guide can be
grabbed from with iptv-org/epg, without files). So the guide is only shown when the owner
sets the address of an XMLTV file in Nexus (for example one made with iptv-org/epg): no
programme or time is ever made up.

The file is read as a stream (it can be big, gzip or not); only the wanted channels and the
programmes between `start` and `end` are kept. XMLTV channel ids « TF1.fr@SD » match the
catalogue's « TF1.fr ».
"""
from __future__ import annotations

import datetime as dt
import gzip
import io
import xml.etree.ElementTree as ET
from typing import Dict, IO, List, Optional, Set


def parse_time(value: str) -> Optional[dt.datetime]:
    """'20251109203000 +0100' -> aware datetime (UTC when no offset)."""
    value = (value or '').strip()
    if len(value) < 12:
        return None
    try:
        base = dt.datetime.strptime(value[:14].ljust(14, '0'), '%Y%m%d%H%M%S')
    except ValueError:
        return None
    tz = dt.timezone.utc
    rest = value[14:].strip()
    if len(rest) == 5 and rest[0] in '+-' and rest[1:].isdigit():
        sign = 1 if rest[0] == '+' else -1
        tz = dt.timezone(sign * dt.timedelta(hours=int(rest[1:3]), minutes=int(rest[3:5])))
    return base.replace(tzinfo=tz)


def open_maybe_gzip(raw: bytes) -> IO[bytes]:
    return gzip.GzipFile(fileobj=io.BytesIO(raw)) if raw[:2] == b'\x1f\x8b' else io.BytesIO(raw)


def parse_xmltv(source: IO[bytes], wanted: Set[str], start: dt.datetime, end: dt.datetime) -> Dict[str, List[dict]]:
    out: Dict[str, List[dict]] = {}
    for _, el in ET.iterparse(source, events=('end',)):
        if el.tag != 'programme':
            if el.tag == 'channel':
                el.clear()
            continue
        cid = (el.get('channel') or '').split('@')[0]
        if cid in wanted:
            s, e = parse_time(el.get('start') or ''), parse_time(el.get('stop') or '')
            if s and e and e > start and s < end:
                title = (el.findtext('title') or '').strip()
                if title:
                    out.setdefault(cid, []).append({
                        'start': s.isoformat(), 'stop': e.isoformat(), 'title': title[:300],
                        'description': (el.findtext('desc') or '').strip()[:1000] or None,
                    })
        el.clear()
    for items in out.values():
        items.sort(key=lambda p: p['start'])
    return out
