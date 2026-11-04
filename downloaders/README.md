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
