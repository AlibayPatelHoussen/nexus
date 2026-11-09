"""Downloads of the iptv-org files, with timeouts, mirrors and a local cache.

- Each file is tried on its mirrors in order (iptv-org.github.io first, then the same files
  on raw.githubusercontent.com: some networks block one of the two).
- Answers are cached in data/iptv/cache with their ETag / Last-Modified, and asked again
  conditionally (304 = cache still good): no full download when nothing changed.
- When every mirror fails (network down, HTTP error), the last cached copy is used and the
  caller is told so. Without a cached copy, FetchError.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import logging
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import List, Optional, Tuple

log = logging.getLogger('iptv')

USER_AGENT = 'Nexus-IPTV/1.0 (+https://github.com/iptv-org/iptv)'
MAX_BYTES = 200 * 1024 * 1024       # the biggest API file (guides.json) is ~25 MB; we never need it


def _env_list(name: str, default: List[str]) -> List[str]:
    raw = os.environ.get(name, '')
    items = [v.strip().rstrip('/') for v in raw.split(',') if v.strip()]
    return items or default


def api_bases() -> List[str]:
    return _env_list('IPTV_API_BASE', [
        'https://iptv-org.github.io/api',
        'https://raw.githubusercontent.com/iptv-org/api/gh-pages',
    ])


def playlist_urls() -> List[str]:
    return _env_list('IPTV_PLAYLIST_URL', [
        'https://iptv-org.github.io/iptv/index.m3u',
        'https://raw.githubusercontent.com/iptv-org/iptv/gh-pages/index.m3u',
    ])


def data_dir() -> Path:
    base = os.environ.get('IPTV_DATA_DIR') or str(Path(__file__).resolve().parent.parent / 'data' / 'iptv')
    path = Path(base)
    path.mkdir(parents=True, exist_ok=True)
    return path


class FetchError(Exception):
    pass


def _cache_paths(url: str) -> Tuple[Path, Path]:
    key = hashlib.sha1(url.encode()).hexdigest()[:16]
    cache = data_dir() / 'cache'
    cache.mkdir(parents=True, exist_ok=True)
    return cache / f'{key}.body', cache / f'{key}.meta.json'


def fetch(url: str, timeout: float = 30) -> bytes:
    """GET url (conditional on the cached copy). Returns the body; FetchError on failure."""
    body_path, meta_path = _cache_paths(url)
    headers = {'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip'}
    meta = {}
    if body_path.exists() and meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text())
            if meta.get('etag'):
                headers['If-None-Match'] = meta['etag']
            if meta.get('last_modified'):
                headers['If-Modified-Since'] = meta['last_modified']
        except (OSError, ValueError):
            meta = {}
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            data = res.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                raise FetchError(f'{url}: too big')
            if res.headers.get('Content-Encoding') == 'gzip':
                data = gzip.decompress(data)
            tmp = body_path.with_suffix('.tmp')
            tmp.write_bytes(data)
            tmp.replace(body_path)
            meta_path.write_text(json.dumps({
                'url': url, 'etag': res.headers.get('ETag'), 'last_modified': res.headers.get('Last-Modified'),
                'fetched_at': time.time(),
            }))
            return data
    except urllib.error.HTTPError as err:
        if err.code == 304 and body_path.exists():
            return body_path.read_bytes()
        raise FetchError(f'{url}: HTTP {err.code}') from err
    except (urllib.error.URLError, OSError, ValueError) as err:   # DNS, refused, timeout, bad gzip
        raise FetchError(f'{url}: {getattr(err, "reason", err)}') from err


def cached(url: str) -> Optional[bytes]:
    body_path, _ = _cache_paths(url)
    try:
        return body_path.read_bytes()
    except OSError:
        return None


def fetch_first(urls: List[str], timeout: float = 30) -> Tuple[bytes, str, bool]:
    """Tries each mirror; falls back to the newest cached copy. -> (body, url, from_cache)."""
    errors = []
    for url in urls:
        try:
            return fetch(url, timeout), url, False
        except FetchError as err:
            log.warning('%s', err)
            errors.append(str(err))
    for url in urls:
        body = cached(url)
        if body is not None:
            return body, url, True
    raise FetchError('; '.join(errors) or 'no source')


API_FILES = ('channels', 'streams', 'feeds', 'logos', 'categories', 'countries', 'languages', 'blocklist')


def fetch_api(timeout: float = 60) -> Tuple[dict, List[str]]:
    """All the API files needed by the catalogue. -> ({name: list}, notes). FetchError when
    the channels or streams cannot be had at all (the rest is optional)."""
    data, notes = {}, []
    for name in API_FILES:
        try:
            body, url, stale = fetch_first([f'{b}/{name}.json' for b in api_bases()], timeout)
            data[name] = json.loads(body)
            if stale:
                notes.append(f'{name}: copie locale (source injoignable)')
        except (FetchError, ValueError) as err:
            if name in ('channels', 'streams'):
                raise FetchError(f'{name}.json: {err}') from err
            data[name] = []
            notes.append(f'{name}: indisponible ({err})')
    return data, notes
