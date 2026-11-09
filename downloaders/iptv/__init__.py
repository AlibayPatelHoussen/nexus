"""IPTV module of Nexus: the iptv-org catalogue (https://github.com/iptv-org/iptv).

- sources.py          downloads the playlists / API files (timeouts, mirrors, local cache)
- playlist_parser.py  reads M3U playlists (#EXTINF attributes, VLC options), malformed lines skipped
- catalogue.py        merges channels, feeds, streams, logos; leaves out blocked / adult channels
- stream_checker.py   careful availability checks (few at a time, short timeouts)
- epg.py              programme guide from an XMLTV file, only when one is configured
- __main__.py         command line used by the Nexus server (--json mode, like the download scripts)

Standard library only: no dependency to install on the server.
"""
