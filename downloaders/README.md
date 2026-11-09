# Download scripts (Nexus copies)

Copies of the scripts of `/media/scripts/` (which stay untouched, as a backup),
with a non-interactive mode used by Nexus. Without `--json` they behave like the
originals (menus, questions).

```
python3 anisama.py --json --search "one piece"
python3 anisama.py --json --details anisama:anime:one-piece
python3 anisama.py --json --download anisama:anime:one-piece --season saison1 --lang VOSTFR --episodes 1-12 --dest /media/animes
python3 anisama.py --json --download anisama:manga:one-piece --lang VF --chapters 1-50 --dest /media/scans
python3 movix.py   --json --download movix:tv:37854 --lang VF --season 1 --episodes 1-12 --dest /media/series
python3 movix.py   --json --download movix:movie:603 --lang VF --dest /media/films
python3 films.py   --json --download films:<id> --dest /media/films
python3 youtube.py --json --download youtube:<videoId> --dest /media/youtube
```

Output: one JSON object per line — `result`, `details`, `item_start`, `progress`,
`item_done`, `item_skipped`, `error`, `done`. Human messages go to stderr.

- No key in these files: `TMDB_API_KEY` comes from the environment (Nexus passes
  it), else from `backend/.env`.
- `anisama.py` keeps its catalogue in `data/catalogue.json` (not versioned),
  copied from `/media/scripts/catalogue.json` the first time; posters and
  synopses found during searches are added to it.
- Files being downloaded are named `.part-…` and renamed when complete.

## IPTV (`iptv_cli.py` + package `iptv/`)

Not a copy of an owner's script: the IPTV module of Nexus, standard library only.
It reads the public lists of [iptv-org](https://github.com/iptv-org/iptv) (the
`api/*.json` files, the `index.m3u` playlist as a fallback) and the hand-picked playlist of
[Free-TV](https://github.com/Free-TV/IPTV), merged into one catalogue. It never invents data.

```
python3 iptv_cli.py refresh --out /tmp/catalogue.json     # fetch + parse + merge → catalogue
python3 iptv_cli.py check --in /tmp/streams.json --workers 4   # check a few streams
python3 iptv_cli.py resolve --url https://www.youtube.com/@chaine/live   # the live stream of a page (yt-dlp)
python3 iptv_cli.py epg --url https://…/guide.xml.gz --ids TF1.fr,France2.fr --hours 24
```

- `sources.py`: downloads with timeouts, conditional requests (ETag / Last-Modified)
  and a cache in `data/iptv/` (not versioned); mirrors in order, then the cached copy
  when every mirror is down. `IPTV_API_BASE` / `IPTV_PLAYLIST_URL` / `IPTV_FREETV_URL`
  (comma lists; `IPTV_FREETV_URL=off` leaves Free-TV out) and `IPTV_DATA_DIR` override the
  defaults.
- `catalogue.py`: one entry per channel with its streams (deduplicated, http(s) only,
  main feed first), logo, country, categories, languages. Channels on the iptv-org
  blocklist (DMCA / NSFW), adult and closed channels are left out.
- `freetv.py`: the Free-TV entries join the catalogue — same channel id, else same stream
  address, else the same name in the same country: the stream is added to that channel
  (Free-TV's first: it is hand-picked); otherwise a new channel with what the playlist
  says, nothing more. Its marks are read (Ⓢ not HD, Ⓖ only in its country), its order is
  kept (`curated`: the channels people expect first). Blocklisted channels and DASH
  streams (`.mpd`, unreadable by the player) are left out. iptv-org down: Free-TV alone.
- `resolver.py`: Free-TV lists some channels by the page of their live (YouTube Ⓨ, Twitch Ⓣ,
  Dailymotion Ⓓ). The stream behind the page is looked up with yt-dlp when the channel is
  played or checked (it changes every few hours, it is never stored). Those three sites
  only, HLS only. Without yt-dlp these channels say so; `IPTV_YTDLP` names another command.
- `stream_checker.py`: reads at most 64 KB of a stream (the playlist, then its first
  variant) and says if it answers; 401 / 403 / 451 are reported as « géo-bloqué ». A web
  page or a DASH manifest answers but cannot be played: reported unavailable, with the
  reason. A bare MPEG-TS stream counts as available: the Nexus server converts it with ffmpeg
  when it is watched.
  Nexus checks favourites and watched channels first, a few at a time — never the
  whole list.
- `epg.py`: iptv-org publishes no ready-made guide; with an XMLTV address set in
  Nexus (IPTV › Paramètres), the programmes of the catalogue channels are read
  (streamed, gzip accepted).
- Output: JSON lines (`progress`, `result`, `done` / `error`) like the other scripts.
- Tests: `python3 -m unittest discover downloaders` (local HTTP server, no internet).
