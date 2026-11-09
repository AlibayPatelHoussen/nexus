"""Finds the live stream behind a web page (YouTube, Twitch, Dailymotion) with yt-dlp.

Free-TV lists some channels by the page of their live (https://www.youtube.com/c/FRANCE24/live).
The address of the stream itself changes every few hours: it is looked up when the channel is
played or checked, never kept in the catalogue. yt-dlp is the tool the download scripts already
use; when it is not installed these channels say so, the rest of the catalogue is unaffected.

Only the known video sites are looked up (never an arbitrary address), and only an HLS stream is
taken: that is what the player reads.
"""
from __future__ import annotations

import json
import logging
import os
import re
import shlex
import shutil
import subprocess
import urllib.parse
from typing import List, Optional

log = logging.getLogger('iptv')

PAGE_HOSTS = ('youtube.com', 'youtu.be', 'twitch.tv', 'dailymotion.com', 'dai.ly')
_EXPIRE = re.compile(r'(?:/expire/|[?&]expire=)(\d{9,11})(?:[/&]|$)')

# What yt-dlp says (lower case) -> what the viewer reads
_REASONS = [
    (('not currently live', 'is offline', 'will begin in', 'premieres in', 'live event has ended', 'no video formats',
      'this live stream recording is not available'), 'pas de direct en cours'),
    (('sign in to confirm', 'not a bot', 'login required', 'use --cookies', 'private video'),
     'le site demande une connexion depuis ce serveur'),
    (('not available in your country', 'not made this video available in your country', 'geo-restricted', 'geo restricted'),
     'réservé à certains pays'),
    (('timed out', 'timeout'), 'délai dépassé'),
    (('unable to download', 'name or service not known', 'temporary failure in name resolution', 'network is unreachable',
      'connection refused'), 'site injoignable depuis le serveur'),
    (('video unavailable', 'does not exist', 'http error 404'), 'direct introuvable'),
]


def is_page(url: str) -> bool:
    parts = urllib.parse.urlsplit(url or '')
    host = (parts.hostname or '').lower()
    return parts.scheme in ('http', 'https') and any(host == h or host.endswith('.' + h) for h in PAGE_HOSTS)


def _command() -> Optional[List[str]]:
    override = os.environ.get('IPTV_YTDLP', '').strip()       # tests, or a yt-dlp outside the PATH
    if override:
        return shlex.split(override)
    if not shutil.which('yt-dlp'):
        return None
    try:
        from nexus_cli import ytdlp_cmd     # the JavaScript runtime choice of the download scripts
        return list(ytdlp_cmd())
    except Exception:                        # run outside the downloaders folder
        return ['yt-dlp']


def _fail(reason: str, message: str) -> dict:
    return {'ok': False, 'reason': reason, 'message': message}


def _why(stderr: str) -> str:
    text = (stderr or '').lower()
    for needles, message in _REASONS:
        if any(n in text for n in needles):
            return message
    return 'direct introuvable'


def _pick(info: dict) -> Optional[dict]:
    """The HLS stream of what yt-dlp found: the full playlist (every quality) when it is given,
    else the best single quality."""
    formats = [f for f in info.get('formats') or []
               if isinstance(f, dict) and str(f.get('protocol') or '').startswith('m3u8') and f.get('url')]
    if not formats and str(info.get('protocol') or '').startswith('m3u8') and info.get('url'):
        formats = [info]
    if not formats:
        return None
    chosen = next((f for f in formats if f.get('manifest_url')), None) or \
        max(formats, key=lambda f: (f.get('height') or 0, f.get('tbr') or 0))
    url = chosen.get('manifest_url') or chosen['url']
    if urllib.parse.urlsplit(url).scheme not in ('http', 'https'):
        return None
    headers = chosen.get('http_headers') or info.get('http_headers') or {}
    expire = _EXPIRE.search(url)
    return {
        'url': url, 'user_agent': headers.get('User-Agent') or None, 'referrer': headers.get('Referer') or None,
        'expires': int(expire.group(1)) if expire else None, 'title': info.get('title') or None,
    }


def resolve(url: str, timeout: float = 45) -> dict:
    """-> {'ok': True, 'url', 'user_agent', 'referrer', 'expires', 'title'}
       or {'ok': False, 'reason': 'missing' | 'failed', 'message'} (message in French, for the viewer)"""
    if not is_page(url):
        return _fail('failed', 'page non prise en charge')
    cmd = _command()
    if cmd is None:
        return _fail('missing', 'yt-dlp n’est pas installé sur le serveur')
    try:
        proc = subprocess.run(
            [*cmd, '-J', '--no-playlist', '--playlist-items', '1', '--no-warnings', '--socket-timeout', '15', '--', url],
            capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
    except FileNotFoundError:
        return _fail('missing', 'yt-dlp n’est pas installé sur le serveur')
    except subprocess.TimeoutExpired:
        return _fail('failed', 'délai dépassé')
    except OSError as err:
        return _fail('failed', f'yt-dlp ne démarre pas ({err})')
    if proc.returncode != 0:
        tail = (proc.stderr or '').strip().splitlines()[-1:] or ['']
        log.warning('yt-dlp %s: %s', url, tail[0][:300])
        return _fail('failed', _why(proc.stderr))
    try:
        info = json.loads(proc.stdout)
        if isinstance(info, dict) and info.get('_type') == 'playlist':
            info = next((e for e in info.get('entries') or [] if isinstance(e, dict)), {})
        found = _pick(info) if isinstance(info, dict) else None
    except ValueError:
        return _fail('failed', 'réponse de yt-dlp illisible')
    if not found:
        return _fail('failed', 'pas de direct en cours')
    return {'ok': True, **found}
