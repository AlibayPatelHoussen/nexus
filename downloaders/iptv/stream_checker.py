"""Careful stream availability checks.

A check is one GET of the stream (with its Referer / User-Agent when the catalogue gives
them), reading at most a few KB:
- an HLS playlist (.m3u8) must answer #EXTM3U; a master playlist is followed one level, to
  its first variant, which must list segments (#EXTINF);
- any other stream must answer 200/206 with bytes that can be played: a web page or a DASH
  manifest answer, but nothing plays them here — they are reported offline with the reason,
  instead of « available » on a channel that never starts. A bare MPEG-TS stream is fine: no
  browser plays it as it is, the Nexus server converts it when it is watched;
- a « page » stream (YouTube, Twitch, Dailymotion live) is first looked up with yt-dlp, then
  the stream found is checked like the others. Without yt-dlp the answer is « unknown ».
Few checks run at a time (4 by default) with short timeouts: the iptv-org servers are not
hammered and the Nexus server stays responsive. Local / private addresses are refused (a
catalogue entry must never make the server probe its own network), except for tests.
"""
from __future__ import annotations

import ipaddress
import os
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Iterable, Iterator, Optional, Tuple

from . import resolver

READ_BYTES = 64 * 1024
_PAGES = threading.Semaphore(2)      # yt-dlp is heavy: two look-ups at a time, whatever the workers
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'


def _private_host(host: str) -> bool:
    if os.environ.get('IPTV_ALLOW_PRIVATE') == '1':
        return False
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False          # the request will fail on its own
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split('%')[0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            return True
    return False


def _get(url: str, ua: Optional[str], referrer: Optional[str], timeout: float):
    headers = {'User-Agent': ua or UA, 'Accept': '*/*'}
    if referrer:
        headers['Referer'] = referrer
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.status, res.geturl(), res.headers.get('Content-Type', ''), res.read(READ_BYTES)


def _readable(ctype: str, body: bytes, path: str) -> Tuple[str, str]:
    """A stream that is not an HLS playlist: can the browser player read these bytes?"""
    ctype = ctype.lower()
    head = body[:2048].lstrip(b'\xef\xbb\xbf \t\r\n').lower()
    if 'dash+xml' in ctype or path.endswith('.mpd') or head.startswith(b'<mpd') or (head.startswith(b'<?xml') and b'<mpd' in head):
        return 'offline', 'format DASH, non pris en charge par le lecteur'
    if 'text/html' in ctype or head.startswith((b'<!doctype html', b'<html')) or (head.startswith(b'<') and b'<html' in head):
        return 'offline', 'page web, pas un flux vidéo'
    if head.startswith((b'<', b'{', b'[')):
        return 'offline', 'réponse inattendue, pas un flux vidéo'
    return 'online', ''


def check(url: str, user_agent: Optional[str] = None, referrer: Optional[str] = None, timeout: float = 8) -> dict:
    started = time.monotonic()

    def result(status: str, reason: str = '', code: Optional[int] = None) -> dict:
        return {'status': status, 'reason': reason, 'code': code, 'ms': int((time.monotonic() - started) * 1000)}

    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ('http', 'https') or not parts.hostname:
        return result('offline', 'adresse non prise en charge')
    if _private_host(parts.hostname):
        return result('offline', 'adresse locale refusée')
    try:
        code, final, ctype, body = _get(url, user_agent, referrer, timeout)
        if not body:
            return result('offline', 'réponse vide', code)
        playlist = '.m3u8' in parts.path.lower() or 'mpegurl' in ctype.lower() or body.lstrip().startswith(b'#EXTM3U')
        if not playlist:
            return result(*_readable(ctype, body, urllib.parse.urlsplit(final).path.lower()), code)
        if not body.lstrip().startswith(b'#EXTM3U'):
            return result('offline', 'pas une playlist HLS', code)
        if b'#EXTINF' in body:
            return result('online', '', code)
        # Master playlist: one level down, to the first variant
        for line in body.decode('utf-8', 'replace').splitlines():
            line = line.strip()
            if line and not line.startswith('#'):
                variant = urllib.parse.urljoin(final, line)
                vparts = urllib.parse.urlsplit(variant)
                if vparts.hostname and _private_host(vparts.hostname):
                    return result('offline', 'adresse locale refusée', code)
                vcode, _, _, vbody = _get(variant, user_agent, referrer, timeout)
                ok = vbody.lstrip().startswith(b'#EXTM3U') and (b'#EXTINF' in vbody or b'#EXT-X-STREAM-INF' in vbody)
                return result('online' if ok else 'offline', '' if ok else 'variante sans segments', vcode)
        return result('offline', 'playlist sans flux', code)
    except urllib.error.HTTPError as err:
        reason = 'accès refusé (souvent géo-bloqué)' if err.code in (401, 403, 451) else f'HTTP {err.code}'
        return result('offline', reason, err.code)
    except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError, OSError, ValueError) as err:
        why = getattr(err, 'reason', err)
        return result('offline', 'délai dépassé' if 'timed out' in str(why) else f'injoignable ({why})')


def check_item(item: dict, timeout: float = 8) -> dict:
    """One catalogue stream: {url, kind?, user_agent?, referrer?}."""
    if item.get('kind') != 'page':
        return check(item['url'], item.get('user_agent'), item.get('referrer'), timeout)
    started = time.monotonic()
    with _PAGES:
        found = resolver.resolve(item['url'])
    if not found['ok']:
        # yt-dlp missing: nothing is known about the channel, it is not reported offline
        return {'status': 'unknown' if found['reason'] == 'missing' else 'offline', 'reason': found['message'],
                'code': None, 'ms': int((time.monotonic() - started) * 1000)}
    res = check(found['url'], found.get('user_agent'), found.get('referrer'), timeout)
    res['ms'] = int((time.monotonic() - started) * 1000)
    return res


def check_many(items: Iterable[dict], workers: int = 4, timeout: float = 8) -> Iterator[dict]:
    """items: {id, url, kind?, user_agent?, referrer?}. Yields {id, url, status, …} as they finish."""
    with ThreadPoolExecutor(max_workers=max(1, min(workers, 8))) as pool:
        futures = {pool.submit(check_item, it, timeout): it for it in items}
        for fut in as_completed(futures):
            it = futures[fut]
            try:
                res = fut.result()
            except Exception as err:      # never let one check stop the others
                res = {'status': 'offline', 'reason': str(err), 'code': None, 'ms': 0}
            yield {'id': it.get('id'), 'url': it['url'], **res}
