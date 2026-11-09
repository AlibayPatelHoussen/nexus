#!/usr/bin/env python3
"""Stand-in for yt-dlp in the E2E tests (the real one needs YouTube, out of reach of a test).

    python3 fake-ytdlp.py --live STREAM [yt-dlp arguments…] -- PAGE

Answers like `yt-dlp -J PAGE`: the live of any page is STREAM (the demo HLS stream of the mock
server). A page whose address contains « offline » has no live on air.
"""
import json
import sys

args = sys.argv[1:]
live = args[args.index('--live') + 1] if '--live' in args[:-1] else ''
page = args[-1] if args else ''
if not live or 'offline' in page:
    sys.stderr.write('ERROR: [youtube] The channel is not currently live\n')
    sys.exit(1)
json.dump({'id': 'e2e', 'title': 'Direct', 'is_live': True, 'formats': [
    {'format_id': '95', 'protocol': 'm3u8_native', 'height': 720, 'url': live, 'manifest_url': live},
]}, sys.stdout)
