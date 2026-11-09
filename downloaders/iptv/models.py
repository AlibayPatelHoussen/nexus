"""Data shapes of the IPTV catalogue (plain dataclasses, serialised to JSON for the server)."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Optional


@dataclass
class PlaylistEntry:
    """One #EXTINF entry of an M3U playlist."""
    name: str
    url: str
    attrs: dict = field(default_factory=dict)      # tvg-id, tvg-logo, group-title…
    user_agent: Optional[str] = None
    referrer: Optional[str] = None


@dataclass
class Stream:
    url: str
    title: str = ''
    feed: Optional[str] = None
    quality: Optional[str] = None
    referrer: Optional[str] = None
    user_agent: Optional[str] = None
    labels: list = field(default_factory=list)       # « Geo-blocked », « Not 24/7 » (iptv-org)


@dataclass
class Channel:
    id: str
    name: str
    country: Optional[str] = None                    # ISO 3166-1 alpha-2, only when the database says so
    categories: list = field(default_factory=list)   # iptv-org category ids, never guessed
    languages: list = field(default_factory=list)    # ISO 639-3 codes of the feeds that have a stream
    logo: Optional[str] = None
    website: Optional[str] = None
    network: Optional[str] = None
    alt_names: list = field(default_factory=list)
    streams: list = field(default_factory=list)      # list[Stream], best first

    def to_json(self) -> dict:
        return asdict(self)
