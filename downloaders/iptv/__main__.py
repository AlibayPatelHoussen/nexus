"""Command line of the IPTV module, used by the Nexus server (JSON lines on stdout, like the
download scripts; human messages on stderr).

    python3 iptv_cli.py --json refresh [--out FILE]
        downloads the iptv-org files (API, playlist), builds the catalogue, writes it to FILE
        (default data/iptv/catalogue.json) -> {"type": "done", "file", "stats", "notes"}
    python3 iptv_cli.py --json check [--in items.json]      (else the list on stdin)
        items: [{id, url, user_agent?, referrer?}] -> one {"type": "check", …} per stream
    python3 iptv_cli.py --json epg --url URL --ids FILE [--out FILE] [--hours 36]
        reads an XMLTV guide for the channel ids of FILE -> {"type": "done", "file", "channels"}
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import sys
import time
from pathlib import Path

from . import catalogue, epg, sources, stream_checker
from .playlist_parser import parse_m3u


def emit(kind: str, **fields) -> None:
    sys.stdout.write(json.dumps({'type': kind, **fields}, ensure_ascii=False) + '\n')
    sys.stdout.flush()


def cmd_refresh(args) -> int:
    started = time.time()
    notes = []
    playlist = None
    try:
        body, url, stale = sources.fetch_first(sources.playlist_urls(), timeout=args.timeout)
        playlist = parse_m3u(body.decode('utf-8', 'replace'))
        if stale:
            notes.append('playlist: copie locale (source injoignable)')
    except sources.FetchError as err:
        notes.append(f'playlist: indisponible ({err})')
    try:
        api, api_notes = sources.fetch_api(timeout=args.timeout)
        notes += api_notes
        channels = catalogue.build_from_api(api, playlist)
        source = 'api'
    except sources.FetchError as err:
        if not playlist:
            emit('error', message=f'Catalogue IPTV injoignable : {err}', fatal=True)
            return 1
        notes.append(f'API indisponible ({err}) : catalogue construit depuis la playlist seule')
        api = {}
        channels = catalogue.build_from_playlist(playlist)
        source = 'playlist'
    out = Path(args.out) if args.out else sources.data_dir() / 'catalogue.json'
    payload = {
        'generated_at': dt.datetime.now(dt.timezone.utc).isoformat(), 'source': source,
        'channels': [c.to_json() for c in channels], **catalogue.facets(channels, api),
    }
    tmp = out.with_suffix('.tmp')
    tmp.write_text(json.dumps(payload, ensure_ascii=False))
    tmp.replace(out)
    stats = {'channels': len(channels), 'streams': sum(len(c.streams) for c in channels),
             'countries': len(payload['countries']), 'categories': len(payload['categories']),
             'languages': len(payload['languages']), 'seconds': round(time.time() - started, 1)}
    emit('done', file=str(out), stats=stats, notes=notes, source=source)
    return 0


def cmd_check(args) -> int:
    try:
        items = json.loads(Path(args.input).read_text()) if args.input else json.load(sys.stdin)
    except (OSError, ValueError):
        emit('error', message='liste de flux illisible', fatal=True)
        return 1
    items = [it for it in items if isinstance(it, dict) and isinstance(it.get('url'), str)][:500]
    n = 0
    for res in stream_checker.check_many(items, workers=args.workers, timeout=args.timeout):
        emit('check', **res)
        n += 1
    emit('done', checked=n)
    return 0


def cmd_epg(args) -> int:
    try:
        wanted = set(json.loads(Path(args.ids).read_text()))
        raw = sources.fetch(args.url, timeout=args.timeout)
    except (OSError, ValueError, sources.FetchError) as err:
        emit('error', message=f'Guide TV illisible : {err}', fatal=True)
        return 1
    now = dt.datetime.now(dt.timezone.utc)
    try:
        progs = epg.parse_xmltv(epg.open_maybe_gzip(raw), wanted, now - dt.timedelta(hours=3), now + dt.timedelta(hours=args.hours))
    except Exception as err:      # malformed XML, bad gzip
        emit('error', message=f'Guide TV illisible : {err}', fatal=True)
        return 1
    out = Path(args.out) if args.out else sources.data_dir() / 'epg.json'
    out.write_text(json.dumps(progs, ensure_ascii=False))
    emit('done', file=str(out), channels=len(progs), programmes=sum(len(v) for v in progs.values()))
    return 0


def main(argv=None) -> int:
    logging.basicConfig(stream=sys.stderr, level=logging.INFO, format='%(levelname)s %(message)s')
    p = argparse.ArgumentParser(prog='iptv')
    p.add_argument('--json', action='store_true', help='machine-readable output (always JSON lines)')
    sub = p.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('refresh'); r.add_argument('--out'); r.add_argument('--timeout', type=float, default=60)
    c = sub.add_parser('check'); c.add_argument('--in', dest='input'); c.add_argument('--workers', type=int, default=4); c.add_argument('--timeout', type=float, default=8)
    e = sub.add_parser('epg'); e.add_argument('--url', required=True); e.add_argument('--ids', required=True)
    e.add_argument('--out'); e.add_argument('--hours', type=float, default=36); e.add_argument('--timeout', type=float, default=120)
    args = p.parse_args(argv)
    return {'refresh': cmd_refresh, 'check': cmd_check, 'epg': cmd_epg}[args.cmd](args)


if __name__ == '__main__':
    sys.exit(main())
