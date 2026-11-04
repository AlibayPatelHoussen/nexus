-- Torrents from OxTorrent (downloaders/oxtorrent.py) in the download queue
ALTER TABLE downloads DROP CONSTRAINT IF EXISTS downloads_source_script_check;
ALTER TABLE downloads ADD CONSTRAINT downloads_source_script_check
  CHECK (source_script IN ('anisama', 'films', 'movix', 'oxtorrent', 'youtube'));
