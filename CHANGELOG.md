# Changelog

All notable changes to Nexus will be documented here.

## [Unreleased]

### Fixed — player options on iPhone (owner's feedback)
- AirPlay / Image dans l’image / lock buttons moved up into the top bar next to « Retour » (they covered the +10 s button); in full screen they stay over the video
- iPhone, iPad, Mac: the cast button opens the system AirPlay list at once, i.e. every AirPlay TV on the phone's own network (Roku, Samsung, LG… TVs), not the server's. Safari now plays converted videos with its own HLS player, the only one AirPlay and Picture in Picture accept (hls.js was used on recent iPhones)
- Image dans l’image: iOS refuses it to apps opened from the Home Screen (Apple's limit, WebKit bug 303885). In that case the button explains it and offers « Ouvrir dans Safari » (same video, resumes at the same place), where Picture in Picture works, also automatically when Safari is left
- TVs found by the server (other browsers): the real reason when one refuses the video; a Roku refusing network commands says where to allow them (Contrôle par les applications mobiles › Permissif) and suggests AirPlay, since recent Roku OS versions removed « Play on Roku »

### Added — player: Diffuser (AirPlay, Chromecast, TVs), Picture in Picture, Épisodes, lock
- Top of the player, in a Liquid Glass capsule: « Diffuser », « Image dans l’image » and (touch screens) « Verrouiller »; in full screen a close button and the title on the left
- Diffuser: AirPlay on Apple devices (Apple TV and AirPlay TVs; a converted video switches to Safari's own HLS so AirPlay can send it), Chromecast / Google TV through the browser elsewhere, and the TVs the server finds on its network: DLNA / UPnP (Samsung, LG, Sony, Philips, many Android TV / Fire TV, Kodi, VLC…) and Roku. The TV reads the file from Nexus itself; the player turns into a remote (play / pause, ±10 s on DLNA, « Arrêter la diffusion » resumes on the device where the TV stopped) and the position is saved for « Reprendre ». `CAST_BASE_URL` sets the address the TV uses when the automatic one (server's LAN IP and port) is not reachable
- Image dans l’image: button, and Safari continues the video in Picture in Picture when the app is left; lock screen / Control Center show the title and poster with play / pause, ±10 s, position and « suivant » (Media Session)
- Touch screens: big centred −10 s / Lecture / +10 s (iOS player), a tap shows / hides the controls; the bar keeps the timeline. Series: « Épisodes » (panel over the video, also in full screen) and « Épisode suivant »
- « Verrouiller »: hides every control so a touch does nothing; a tap shows « Déverrouiller »

### Added — change your user name in Réglages
- Réglages › Nom d’utilisateur: type the new name, confirm with your password. 3 to 50 letters, digits, _ or -; a name (or e-mail) already used, whatever the case, is refused. The new name is shown at once and is the one to log in with (`PATCH /api/auth/username`)

### Changed — anime synopses and genres in French
- An anime's synopsis is now taken in French: TMDB's French synopsis first, else anime-sama's, AniList's English one only as a last resort; a French synopsis replaces the English one stored by earlier scans
- AniList genres are translated into French and refreshed. Existing animes are updated by « Analyser la bibliothèque »

### Changed — manga synopses and genres in French
- A manga's synopsis is now taken in French: MangaDex's French description first, else the French synopsis anime-sama's catalogue knows for this title, English only as a last resort. The MangaDex Markdown (links list, bold) is cleaned
- A French synopsis replaces the English one stored by earlier scans; genres (MangaDex tags) are translated into French and refreshed. Existing mangas are updated by « Analyser la bibliothèque »

### Changed — manga pages turn like a real book
- Page by page, the page now folds like paper: its corner follows the finger, its back shows with shadows along the crease, and the next page appears under it. Drag the page anywhere: towards the spine turns to the next page, away from it brings the previous one back; let go past the spine (or with a flick) to turn, otherwise the page falls back
- One tap still turns the page: on the outer edge the next one, on the spine side the previous one (with the same fold), in the middle the reader bars show / hide. Keyboard arrows and the desktop buttons use the fold too; right to left (manga): everything mirrored, the pictures never. Off with « Réduire les animations »
- Replaces the 3D page rotation added just before

### Fixed — « Page par page, de droite à gauche » showed mirrored pages
- The manga reading mode flipped every page like a mirror (text unreadable): pages are now shown as they are, only the turning direction changes. ← is the next page (keyboard and desktop arrows), → the previous one; swiping and the position slider already followed the direction
- The reading mode chosen last (vertical, page, right to left) is kept on the device

### Changed — « À la une » changes every hour
- The billboard draw (among all the titles of the section) now changes once an hour instead of at every visit: the same titles all hour long, others the next hour. The order comes from a hash of each title with the hour, nothing is stored

### Fixed — download progress could go back (« 0 chapter done » while one was)
- The progress of a download is saved after each event; two saves sent together could reach the database in the wrong order (« chapter 1 started » written over « chapter 1 done »), and stay so until the next event. Saves of a download now go one after the other

### Added — the library scans itself when a page opens
- Online lookups of a scan (TMDB, AniList, MangaDex) give up after 20 s: a site that never answered kept the scan running forever, and every other scan (downloads, pages opened, « Analyser ») was refused behind it
- Opening Films, Séries, Animes, Manga, YouTube or a title page runs a quick scan of that library: new files and new episodes / chapters (a download running…) appear without « Analyser la bibliothèque », the page refreshes itself. Skipped while another scan runs or when that library was scanned less than 10 s ago (`AUTO_SCAN_MIN_MS`)
- Quick scans (pages opened, each finished download) no longer ask AniList / MangaDex again for titles already in the library, which they did for every anime / manga at every scan: only new titles are looked up. « Analyser la bibliothèque » keeps the full scan

### Fixed — a new download could wait 10 s before starting; main CI red
- A download added while the queue was starting others was only picked up by the next check (10 s later): the queue now makes one more pass right away
- The test of « each finished chapter in the library » waited too little on a slow CI (that is what kept the previous version from being deployed)

### Changed — each finished episode / chapter is in the library at once
- A download of several episodes or chapters no longer waits for the whole job: every finished episode / chapter is added to the library a few seconds later (the rescans of items finished close together are grouped, at most one per 15 s; `DOWNLOADS_RESCAN_DELAY_MS`), so 30 chapters out of 50 can be read while the rest downloads
- Paused, cancelled or failed halfway: what was finished is added to the library too (before, only a complete job was)
- Manga (anime-sama): the pages of a chapter being downloaded go to a hidden folder, so a half chapter never shows up in the library
- YouTube: a pause / cancel arriving the instant yt-dlp starts no longer leaves it running alone (the stop now waits until it is registered)

### Fixed — no tab selected on a title page (iPhone tab bar, sidebar)
- A title page (a manga, a film…) is under the tab it was opened from; that was forgotten when the bar was created again (back from the full-screen reader / player) or when the app reopened directly on the page: no tab was blue. The tab is now kept, and a title page opened directly selects its own library (Manga for a manga, Médias / Films et séries for a film…)
- Sidebar (desktop): same; the selected section is also announced to VoiceOver (`aria-current`) on title pages

### Changed — « À la une » drawn at random among all the titles
- The billboard of Films, Séries, Animes (and YouTube) shows titles drawn at random among ALL the titles of that section, a new draw each time the page opens (it stays the same while the page is open). Before: 6 titles in a row among the 300 newest, the same ones all day
- Titles with a backdrop and a synopsis come first, so the billboard keeps its look; the others fill in when too few have one. New `GET /api/media/featured?type=…&count=…` (up to 20)

### Added — « Télécharger » on the page of a series, an anime or a manga
- Admin: a round download button next to « + » (series, animes) or a « Télécharger » button (mangas) opens the download sheet of that title on its site (movix for series, anime-sama for animes and mangas): seasons, languages, the episodes / chapters already downloaded marked, pick more and download them, without searching for the title again
- The title is found like the automatic downloads: from the downloads that made its files, else by its name on the site (a few seconds; the button waits, then opens). Not found: a message says so

### Fixed — « Ma liste » (the + buttons) did not work, and there was nowhere to see it
- Every « Ajouter à ma liste » button now shares one state: the billboard's « + » showed « + » even for a title already in the list (a tap then removed it), and the menu always said « Ajouter à ma liste » (removing a title already in it). They now show ✓ / « Retirer de ma liste » when the title is in the list, at once (no wait for the server)
- New « Ma liste » page (sidebar › Médias on desktop; « Films ⌄ » menu and the « Ma liste › » shelf on iPhone): the titles added, newest first, filtered by kind (Films, Séries, Animes, Manga, YouTube: only those present)
- « Ma liste » shelf in Films et séries, Animes, Manga (after « Reprendre »), with « Tout voir »

### Changed — « Supprimer de la bibliothèque » deletes the title everywhere
- The menu of a title (admin) deletes it everywhere: its files on the disk (a series / anime / manga: its folder; a film alone in its folder: the folder; a film next to others: its file and what goes with it — subtitles, `.nexus.json`), its row (episodes, chapters, progress, « Reprendre », lists and ratings), the downloads that made it (stopped if running), its follow (new episodes are no longer downloaded), the conversions being played and the keyframe indexes. Before, only the row was removed and the next scan brought the title back
- Never outside the library nor a library folder itself; a collection folder holding other films is never deleted whole. Files owned by root: the server's sudo password is asked, as in the file manager
- Deleting library files in the file manager also removes their titles, episodes, chapters, downloads and follows at once (no rescan needed)

### Fixed — movix films and episodes took very long to download
- ffmpeg fetched the HLS stream one segment after the other: the segments are now fetched 8 at a time (one kept-open connection per thread, 4 tries each), then ffmpeg only assembles the local copy (`-c copy`, a few seconds). About 5× faster with a host that is slow to answer (24 segments at 300 ms: 7.6 s → 1.4 s). Encrypted streams (AES-128) and master playlists (best quality) work; a direct MP4, a live stream, a separate audio track or another cipher are left to plain ffmpeg, as before, and so is a stream whose parallel download fails
- A paused or stopped download keeps its segments (hidden `.hls-…` folder next to the file, skipped by the library scan): the next try only fetches the missing ones
- films.py (French-stream sites) downloads its HLS streams the same way (with the site's cookies)
- Finding the stream in a web player no longer waits a fixed 5 s on each player (it goes on as soon as the stream is seen); a player that needs a click is clicked again every 10 s; the player's Origin header is passed on too

### Fixed — MP4 conversion lost the 5.1 sound
- A first audio track converted to AAC (DTS, AC-3, TrueHD…) keeps its channels: 5.1 stays 5.1 (448 kb/s); it was mixed down to stereo

### Changed — MKV films and episodes become MP4
- H.264 films / episodes in MKV (AVI, TS…) are converted to MP4 in the background, after each download and for those already in the library (owner's choice): read directly like the MP4 films that already work well (instant start and jumps, native full screen), same picture (copied, about 30 s for 2.5 GB). The first audio track is made AAC when it is not; other audio tracks (VF, VO…) and text subtitles are kept
- The MP4 replaces the MKV only once checked (same length, picture, as many audio tracks); title, progress and « Reprendre » follow the new file. Skipped: a film being watched, a file written less than a minute ago, not enough free space, a folder Nexus cannot write. `MP4_CONVERT=off` turns it off
- Never converted (nothing is ever lost): HEVC films (they need re-encoding) and files with subtitles drawn as pictures (PGS / DVD, Blu-ray rips; an MP4 cannot hold them). Text subtitles (SRT, ASS) and subtitles burnt into the picture are kept. Files not converted keep the keyframe index

### Fixed — « Reprendre » right after leaving a film started from 0; dragging the timeline
- Dragging the iPhone timeline over a converted film asked for many positions in one second, each restarting the conversion: a far jump now starts ffmpeg only when no other one follows within 0.3 s, and the positions only passed over are dropped at once
- The player read the resume position from its cache (the one from before watching: nothing for a first watch → from 0) and could read it before the save made when leaving had arrived: it now always reads the saved position, after that save

### Fixed — « Reprendre » on iPhone (again), jumping far in an MKV film, up-to-date progress
- Leaving a film / an episode (or reaching its end) refreshes « Reprendre », the title page's « Reprendre · 67 % » and the next resume position at once; before, they were only updated after a library scan or a reload (and reopening the film within 30 s resumed at the old position)
- The resume position was given up 20 s after the player opened; the iPhone loads nothing before ▶ is tapped, so it was often given up before playing: it now counts from when playback really starts
- Jumping to the middle of an MKV film no longer waits for the copy to get there from the start: a copy starts right at that point (cut at the same keyframes, same timeline; the piece before the keyframe ffmpeg lands on is not served), like MP4 films

### Fixed — « Reprendre » started from the beginning (iPhone)
- The iPhone ignores a position set before the video can play: the resume position is now set again on every media event until the video really is there (given up after 20 s or when the user moves the position)
- Nothing is saved before the resume position is reached: starting from 0 by mistake no longer overwrote the saved position nor removed the film from « Reprendre »

### Changed — MKV films start at once, like Netflix
- Films / episodes whose picture is only copied (MKV H.264…) start in 2-3 s with the whole film in the player (iPhone full screen included), instead of « Préparation de la vidéo… » for the whole file: Nexus reads each such file once in the background (after a scan, a download, and daily; low priority) and keeps the times where it can be cut (a few KB in backend/cache/keyframes). Playing it then gives the whole film at once and copies it in one run cut at those times (~190x real time on the server)
- A file not indexed yet is indexed when first played (« Préparation de la vidéo… » with its progress, about 30 s for 2.5 GB), then never again; the original files are never changed

### Fixed — « Préparation de la vidéo » very slow
- Films whose sound is already AAC / MP3 stereo (most WEB-DL / WEBRip MKV) keep it as it is instead of re-encoding it: on the server, re-encoding the sound (one CPU core, ~30x real time) was what made a 1 h 30 film take 3-4 min to prepare; copying it is limited by the disk only (~30 s for 2.5 GB). Measured on the owner's server

### Changed — converted films are whole in the player from the start
- A film that must be converted no longer shows only the part converted so far (iPhone full screen, timeline): the player gets the whole film at once, like series
  - re-encoded films (HEVC…): the playlist of the whole film is given at once and each part is converted when the player asks for it (a jump far ahead converts from there, without a new conversion of everything)
  - films whose video is only copied (MKV H.264…): prepared completely before playback (fast), « Préparation de la vidéo… 42 % »
- A paused converted film keeps its place: ffmpeg stops and restarts where the player asks

### Fixed — menus closing right after opening on iPhone
- A « … » menu (Reprendre cards…) closed by itself most of the time: the small scroll a tap causes (a shelf snapping back, the page settling, focusing the menu) or the viewport resizing when iOS moves its bars counted as « the user scrolled ». Only a real scroll (over 16 px) or a width change closes it now

### Added — « Retirer de Reprendre »
- Films, series and animes can be removed from « Reprendre »: « … » button on the card (always on iPhone, on hover on Mac) or long press / right click → « Retirer de Reprendre ». The progress is kept; watching the title again brings it back (migration 012)
- iPhone menus widen to fit their labels (no more « Retirer de Reprend… »)

### Fixed — Terminal keyboard
- On touch screens, the keys under the terminal (Esc, Tab, Ctrl+C…), Copier / Coller and the connection no longer open the soft keyboard: it opens only when the terminal itself is tapped (if it is already open, it stays open)

### Changed — Liquid Glass back button everywhere
- The back button of every page is a Liquid Glass capsule with the parent's name (« ‹ Manga »), like the player's « Retour » (iPhone: instead of blue text; over the billboard too; Mac: a glass button in the toolbar)

### Changed — iOS 26 menus
- On iPhone, the « … » menus (Terminal, Fichiers) and long-press menus grow out of the button / the pressed item as an iOS 26 Liquid Glass menu with icons, instead of the old iOS action sheet at the bottom
- In dark mode, the rim of large glass surfaces (menus, sheets, sidebar) is much softer: no more white border

### Fixed — « Taille : 0 o », English statuses
- A detail page no longer shows « Taille : 0 o »: an unknown size hides the row; a series' / anime's size is that of its episodes
- The status is in French (« ongoing », « RELEASING », « Returning Series » → « En cours »…)

### Changed — test notification
- The test notification says what it is (« Notifications activées ») instead of repeating « Nexus », like download notifications (« Échec du téléchargement »…); iOS already shows the app's name

### Fixed — a YouTube download that went on alone, broken videos
- A pause, a cancel or a restart of Nexus (deployment) now stops yt-dlp too: it ran in its own process group and went on alone while the next try worked on the same files (« Conversion failed », a .mp4 with no track). A script also stops by itself when Nexus is gone
- A video that cannot be read (no track) no longer counts as « déjà présent »: it is downloaded again
- A video already merged in the working folder (stopped while its thumbnail was added) is moved to the library instead of being downloaded again

### Fixed — a deployment ran the previous deploy.sh
- When an update changes `scripts/deploy.sh`, the deployment now runs the new version right after `git pull` (bash kept reading the old file, so deno was not installed by the deployment that brought it)

### Fixed — the merge of big YouTube videos was still stopped
- The merge stays protected even when its start is read before the last progress line (two outputs read at once): this race made the CI fail and could stop a merge on the server too
- yt-dlp reports the merge on its error output, which Nexus did not read for that: the merge of a big video was still stopped every 15 s. Checked on the server; the merge now always goes to the end
- deno is installed with yt-dlp (the server's Node 20 is too old for YouTube's checks), so formats do not go missing and 403s do not come back

### Fixed — big YouTube videos killed while being merged
- The 15 s stall restart stopped big videos while their image and sound were being merged (yt-dlp says nothing then): it now knows when the download is over (yt-dlp's post-processing progress) and never stops the merge; the queue shows « Assemblage de l'image et du son… »
- Videos whose image and sound were complete in the working folder are merged when downloaded again (no new download); a failure always says why (« YouTube n'envoie plus rien », yt-dlp's last message…)

### Fixed — YouTube downloads that freeze, half-downloaded files in the library
- A video stopped while its image and sound were being merged (a pause during the long silent merge) was then reported « déjà présent » and never finished: only a finished video counts now; downloading it again merges the complete streams already on disk (sizes checked against YouTube's) instead of downloading gigabytes again, otherwise downloads it again and removes the old pieces
- The queue shows « Assemblage de l'image et du son… » during the merge, so it no longer looks stuck
- A YouTube download that stops receiving data is restarted by itself after 15 s (it continues where it stopped, like a pause / resume by hand), up to 10 times; a dead connection now times out instead of waiting forever
- The video / audio parts yt-dlp writes while downloading go to a hidden folder, so « YouTube » no longer shows « … [id].f251 » / « … .temp » cards without a thumbnail; those already listed are removed at the next scan

### Fixed — YouTube downloads failed with « HTTP Error 403 »
- yt-dlp is kept up to date by itself (at every deployment and once a day), with yt-dlp-ejs, and uses Node.js to pass YouTube's checks when deno is not installed: the server's 8-month-old yt-dlp without a JavaScript runtime got « HTTP Error 403: Forbidden »
- A failed YouTube download says why in French (anti-bot check, private or removed video, yt-dlp too old…) instead of « Téléchargement YouTube impossible »

### Fixed — Attack on Titan was linked to its chibi spin-off
- An anime is linked to the best-known animated TMDB series of its year (most votes), not the first one TMDB lists: Attack on Titan had been linked to « Attack on Titan: Chibi Theater » (2013 too), hence the chibi picture and no logo. Every anime is linked again after the update (poster, logo, key art, IMDb rating)

### Fixed — animes scanned before get their TMDB series by themselves
- The background enrichment (after every update, scan, and once a day) also looks up the TMDB series of animes not linked yet: Attack on Titan, scanned before the better search, gets its poster with the title, its logo and key art without a new library scan

### Fixed — logos and pictures picked automatically
- Back to the previous picture rule (the best-rated one): Marty Supreme has its picture back; only a small fan picture (Attack on Titan's blurry chibi) is passed over when a picture at least 1000 px wide exists
- Title logos as before (the PNG logo, French, then English, then language-free): Dragon Ball Super and Bleach are back to what they were. Only a title with no PNG logo at all (Attack on Titan) takes an SVG one, if it has a transparent background; never another language. Every title is looked up again after the update

### Fixed — title logos in SVG
- Title logos that TMDB only has as SVG (Attack on Titan) can be used: the image cache turns them into PNG (an SVG is never served)

### Fixed — animes get real posters and the title logo
- The TMDB search also tries the folder name first and every title without its season / subtitle (AniList has one entry per season or movie, « Shingeki no Kyojin: The Final Season », TMDB one series « L'Attaque des Titans »), and is no longer skipped when AniList matched a movie / OVA
- Animes: besides AniList, the library scan finds the anime's TMDB series (animated series only, never a live-action remake; the closest to the AniList year), so animes get what films and series have: a poster with the title instead of AniList's textless cover, the title logo on the « À la une » billboard and the title page, textless key art and the IMDb rating. Already scanned animes are updated by the next library scan

### Fixed — tab bar: the selection is already there when the lens lets go
- iPhone tab bar: while the finger drags the lens, the (hidden) selection pill follows the tab under it, so when the finger lifts the pill appears in place right away instead of sliding over from the old tab afterwards; the tab's tint follows at once too

### Added — « MOINS » folds the synopsis back
- Title pages (iPhone and desktop): once « PLUS » has shown the whole synopsis, a « MOINS » capsule under it cuts it again

### Changed — touch screens feel like an installed app
- iPhone / iPad / Android: a long press no longer selects text, opens the link or image menu or a link preview, images cannot be dragged and double tap does not zoom. Nexus' own long-press menus still open; text fields and logs (service journal) keep copy / paste. Mouse and trackpad unchanged

### Fixed — « PLUS » on the synopsis on desktop
- Title pages on a computer: a long synopsis is cut at 5 lines with the « PLUS » capsule (like the Apple TV app and the iPhone), which shows all of it; it used to be cut with no way to read the rest

### Fixed — a series downloaded twice made two folders
- Also recognises a torrent's release folder (« Georgie.and.Mandys.First.Marriage.S02.1080p… »): the title is read before the season / quality tags; the folder named after the series is kept
- Every download of a series (movix, OxTorrent, automatic downloads) goes into the folder already there for it — same TMDB id, or same name once spaces, underscores and punctuation are ignored — instead of starting a second one (« Georgie & Mandy's First Marriage » and « Georgie_&_Mandy's_First_Marriage »). A second folder that already exists is merged into the first when the series is opened in Téléchargements or downloaded again

### Changed — One Piece colour and black & white are one manga
- anime-sama: another edition of the same scans (« Scans (noir et blanc) », colour) is no longer a separate result: it is a version of the manga, chosen like VF / VOSTFR (« Noir et blanc » / « Couleur »). Black & white comes first and is the default: it is the weekly release (One Piece: 1199 chapters, colour 1004). Downloaded into the manga's own folder (« One Piece/VF Noir et blanc »), so the library shows one manga, with its poster; editions downloaded before move there by themselves. One-shots and spin-offs stay separate
- Library: a manga with several versions (VF / VOSTFR, colour / black & white) shows one at a time with a version choice above its chapters; the reader stays in the version of the chapter opened

### Security — server journals are admin-only
- `GET /api/system/logs` and `GET /api/services/:name/logs` now require an admin (a regular account could read the whole system journal). Services page: regular accounts still see each service's state, but no longer the Start / Stop / Restart buttons or the journal (both answered 403)
- multer 1.x → 2.x (known denial-of-service fixes); CI runs on Node 22 (Node 20 is end-of-life)

### Changed — no blur at the top of the screen
- Every page: the top bar no longer blurs what scrolls under it (opaque page colour, then a short sharp fade), and its buttons (back, section menu, search / downloads / « … », open search field) no longer blur what is behind them and have no soft shadow halo (owner's request). Nothing else changes

### Changed — sharp top bar over the billboard
- iPhone: the bar buttons floating over the artwork (« Films ⌄ », search / downloads / « … », back) keep their glass rim and a light tint but no longer blur the artwork under them (owner's request); once scrolled past the artwork they are regular glass again

### Changed — Apple TV artwork, smoother tab bar
- Billboard and title pages use TMDB's image catalogue (`/images`, migration 007): the best-voted **textless key art** on iPhone, the **full-resolution textless backdrop** on larger screens, and the show's **title logo** (French first, then English; PNG only) instead of plain text, like the Apple TV app. Full-resolution files are downscaled once by the image cache (1290 px portrait / 2560 px landscape, logos keep their transparency). Fetched after each scan and daily, with the IMDb ratings
- Tab bar: no React render while the finger moves (motion values, springs, opacity cross-fade for the tint), so the lens follows at 60 fps; in dark mode the lens rim is much fainter (clear glass, not a white outline)

### Added — Top 10 ranked by IMDb
- Every film / series / anime with a TMDB id gets its IMDb id from TMDB (`external_ids`); once a day the official IMDb dataset `title.ratings.tsv.gz` (non-commercial use, refreshed daily by IMDb) is streamed and the IMDb rating and vote count of the library's titles are stored (migration 006). Nothing is scraped from imdb.com
- The Top 10 ranks by IMDb's weighted rating (IMDb Top 250 formula: m = 25 000 votes, C = 7.0) and shows « IMDb 8,7 » under each poster; TMDB's rating is the fallback when fewer than 3 titles have an IMDb score
- `POST /api/media/imdb/refresh` (admin) runs it now; `IMDB_RATINGS_URL`, `IMDB_SYNC=off` for tests

### Changed — iPhone: full-screen billboard, glass bar, Apple Music tab bar
- Home-screen app: the status bar is translucent (`black-translucent`), so the artwork goes under it like the Apple TV app (a soft shade keeps the clock readable on light pages)
- Médias, Manga, YouTube: no large title any more (the tab bar says where you are). At the top: « Films ⌄ » (a glass pull-down menu to switch Films / Séries / Animes / YouTube) and one glass capsule with the magnifying glass, Téléchargements and « … » (list view, filters, scan)
- The magnifying glass morphs into a glass search field across the bar (spring), with a round « × » to close it
- Billboard: swipe left / right (finger or mouse) to change title, the artwork follows the finger; taller on iPhone
- Tab bar like Apple Music on iOS 26: touching it turns the selection into a clear glass lens, larger than a tab and spilling over the bar, that follows the finger; the tabs under it are tinted and magnified; letting go selects the tab and the lens settles back into the pill on a spring

### Changed — title page on iPhone like the Apple TV app
- Taller artwork that goes progressively blurred and dark under the text; bold centred title, « Série · Drame · Comédie », a wide white « Lire le premier épisode / Reprendre · S1 É2 / Lire · S1 É3 » capsule and a round glass « + »; the synopsis on two lines with a glass « PLUS » capsule; « 2024 · 2 saisons ★ 7,4 » and badges
- Back button and bar buttons in glass circles / one glass capsule (iOS 26)
- « Saison 1 ⇅ »: the season is chosen in a Liquid Glass pull-down menu (new `PullDownMenu`, desktop too)
- Episodes on iPhone: one card per episode, the still on top and the text on a blurred copy of it

### Changed — Liquid Glass steps 6–7: YouTube and every page's toolbar
- YouTube like the Apple TV app: 16:9 thumbnails with 14 pt corners and a hairline rim, spring lift and pointer reflection on hover, the duration in a small clear-glass capsule, a white progress bar; channels as horizontal shelves
- Every page's toolbar (desktop) and navigation bar (iPhone) uses the iOS 26 / macOS 26 scroll edge effect instead of the old flat bar with a hairline: the content fades and blurs softly under the bar
- Search fields are one shared capsule component (`SearchField`, iOS 26 / macOS 26); toolbar icon buttons and pop-up menus are round / capsules
- Fixed: a text colour combined with a type size (`text-label` + `text-body`) lost its colour (class merging didn't know Nexus's type scale)

### Changed — Liquid Glass step 5: Manga like Apple Books
- Shelves of book covers: small 6 pt corners, a spine light and a soft shadow as if resting on a shelf, the title underneath; no billboard (« Nouveautés », « Les mieux notés », genres)
- Title page: the whole cover with its shadow, title and capsule buttons
- Reader: the chrome is floating clear glass (a capsule at the top with the chapter, a capsule at the bottom with the page slider), page arrows in glass, the chapters panel in glass; everything fades away while reading

### Changed — Liquid Glass step 4: video player
- The player's controls are clear Liquid Glass over the video (`.glass-media`: clear glass with the HIG's dimming for bright images): a 26 pt capsule control bar that fades in and settles on a spring, a round centre play button, the « Reprise à … » card and the « Retour » capsule

### Changed — Liquid Glass step 3b: title pages like the Apple TV app
- Films, séries and animes open on an immersive header: the artwork fills the top of the window (16:9 up to 80 % of its height, portrait key art on iPhone), with parallax; title, facts and rating, the white « Lecture / Reprendre · S1 É2 » capsule and the round glass « + » (Ma liste) over it; the episode up next and the synopsis beside them (under the artwork on iPhone). The back button is a round clear-glass button over the artwork on iPhone
- The clicked poster grows into that header (View Transitions API, Chrome / Safari 18), the rest cross-fades; the page shows at once with what the card knew, the rest arrives after
- Episodes: Apple TV row of 16:9 stills (« ÉPISODE 3 », title, synopsis, duration / date, progress, « Vu » badge, play button on hover); seasons as a capsule segmented control
- Loading: a skeleton instead of a spinner; a missing artwork shows a clean placeholder
- The page and its shelves share Apple TV's 40 / 25 px gutter. Manga keeps its whole cover (Apple Books, next step)

### Changed — Liquid Glass step 3a: Films / Séries / Animes like the Apple TV app
- Billboard (values measured on tv.apple.com): full-bleed artwork, 16:9 up to 90 % of the window, under the floating sidebar too (portrait key art on iPhone); the same three-layer gradient; title, facts and synopsis bottom-left (centred on iPhone); a white « Lecture » capsule (40 px), round clear-glass « + » (favourites) and « i » (details); carousel of up to 6 titles with cross-fade, slow Ken Burns zoom and pagination dots (20 px pitch); parallax while scrolling; pauses on hover
- The toolbar (desktop) and the large title (iPhone) float over the billboard in white, and become the glass bar once it has scrolled away
- Shelves: 17 / 19 pt bold titles, the title with its chevron opens the full list; cards in a snapping horizontal grid whose count follows the real width (8 across 1440 px, 144 px posters on iPhone), 20 / 10 px gaps, 40 / 25 px gutters; arrows on hover
- Cards: artwork only, 14 px corners and a hairline rim; on hover they lift on a spring with a stronger shadow and a light reflection that follows the pointer. « Reprendre » uses 16:9 cards with the progress bar and the episode written over the image; « Top 10 » with big ranks and the genre

### Changed — Liquid Glass design system (iOS 26 / macOS 26), step 1: tokens, controls, navigation
- `CLAUDE.md`: the permanent design rules (Liquid Glass only, sources in order: Apple's Figma kits, HIG, Apple TV, skills; glass only for navigation; springs; accessibility; check every visual change with Playwright)
- Tokens from Apple's official iOS 26 and macOS 26 Figma kits: iOS 26 blue, Liquid Glass materials (`.glass`, `.glass-strong`, `.glass-clear`: blur + saturation, the kit's thin side rim and specular light, light and dark), radii (capsule controls, 26 pt iOS groups, 34 pt large glass, 38 pt iPhone sheets), reduced transparency / increased contrast variants
- Springs with framer-motion (`src/design/motion.ts`), off when the system asks for reduced motion
- Desktop: the sidebar is a floating Liquid Glass panel 8 px inside the window (macOS 26 kit: 240 px, 32 px rows, 13 pt medium labels, bold section headers); the selection is a capsule that slides on a spring. Same sections as before
- iPhone: the tab bar is the iOS 26 floating glass capsule (62 pt, 54 pt tabs, selection capsule sliding on a spring)
- Buttons, segmented controls, search fields: capsules. Switch: the iOS 26 64 × 28 switch whose knob turns into clear glass while pressed. Menus, alerts, action sheets and toasts in Liquid Glass
- `e2e/shots.mjs`: screenshots of every page at 1440 and 390 px, dark and light

### Changed — OxTorrent: one card per film and per series
- Every release (720p, 1080p, 4K, VF, VOSTFR, MULTI…) used to be its own result. OxTorrent results are now grouped: one card per film (« 5 versions ») and per series (« 22 épisodes · 1 pack »). Release names are read with guessit when installed (deploy installs `python3-guessit`), with the script's own rules otherwise. Titles are compared without accents, punctuation or « the », and « and » == « & » (« Georgie.and.Mandys » and « Georgie & Mandy's » are one series). A release listed twice is kept once, up to 4 result pages are read, and the group gets its poster, year, synopsis and episode titles from TMDB
- Film sheet: every version with resolution, language, source, codec, size and seeders, sorted by quality then seeders, « Recommandé » on the best (1080p, well shared, reasonable size), versions nobody shares greyed out at the bottom, Résolution / Langue filters
- Series sheet: season, season packs on top, a preferred quality applied to every checked episode (the best version when it does not exist for one), a version chosen by hand by unfolding an episode
- Queue: the job keeps the version chosen (« S01E03 · 1080p MULTI »). Asking for another version of something already downloaded says « Déjà téléchargé en 720p MULTI » and offers to replace it: the old files are deleted once the new version is complete
- Nothing changes for anime-sama, movix, films.py and YouTube results (their sheet is the one from before OxTorrent)

### Fixed — download notifications
- A finished OxTorrent film sent its notification, but nothing showed it on the iPhone while Nexus was open (iOS shows no banner for an app in the foreground) and the server did not log successful sends
- Every download (anime-sama, movix, films, YouTube, OxTorrent) now ends with « Film terminé — Deadpool & Wolverine · 1080p MULTI », « Épisodes terminés — One Piece · épisodes 1–3 · VOSTFR », or « Échec du téléchargement — … — reason ». Touching it opens the title in the library once the rescan has found it (the queue otherwise)
- A live toast shows the same message in every open Nexus (admins), and touching it opens the title too
- The server logs every send (« Push download-…: sent to 1/1 device(s) ») and the subscriptions it removes after a 404 / 410; the progress bar reaches 100 % at the end

### Added — OxTorrent in Téléchargements
- New script `downloaders/oxtorrent.py`, made from the qBittorrent search plugin by CravateRouge, with the same `--json` protocol as films.py / movix.py / anisama.py (and a menu without `--json`). It searches OxTorrent (films, séries, animes; music, games and ebooks are left out), reads a torrent page (release, size, seeds, poster, synopsis) and downloads it with aria2
- The site changes domain often: the current one is read from the portal https://ww1.click/oxtorrent/ (its iframe), remembered a day, and can be forced with `OXTORRENT_URL`
- Results show language, quality, size and seeds (« MULTI · 2160p · 4.36 GB · 82 seeds »), right after anime-sama and before films.py / movix; a torrent is downloaded whole (no episode choice, no follow switch)
- Files: films in `<films>/<Titre (Année)>/` (video and subtitles only, samples left out), séries and animes in `<séries|animes>/<Titre>/` as the torrent has them; the exact TMDB id is written next to them for the library. While downloading, everything stays in a hidden `.part-oxtorrent-<id>` folder (resumed after a pause); not enough free space is said before starting
- `deploy.sh` installs aria2 when it is missing (`sudo apt-get install -y aria2`); migration 005 allows the new source in the queue

### Fixed — movix languages and recent episodes
- movix.py only asked two sources (links, purstream) that know neither the language nor recent episodes: Georgie & Mandy saison 3, out in VOSTFR on movix, failed. It now asks fstream and wiflix (what movix's own player uses) and tries the players of the asked language first (uqload first). Tested on the server: S3E1 VOSTFR downloaded, 213 MB
- The detail sheet only offers the languages that really exist: per season for series, per film; an episode missing in the chosen language is greyed out (« pas disponible en VF (seulement VOSTFR) »). Asking for it anyway fails right away with that message
- Follow switch: an episode out only in another language is not « known », so a VF follow gets it when the VF comes out

### Fixed — movix episodes not out yet
- A series season announced on TMDB but not hosted on movix yet (Georgie & Mandy's First Marriage, saison 3) failed with « Aucune source n'a fonctionné » after a minute per episode. Episodes not out yet (TMDB date to come, or placeholder title « Épisode N ») are now greyed out with dashed borders in the detail sheet and cannot be selected (« prochain le … »)
- When movix has no link for an episode, the job says « Épisode pas encore disponible sur movix (sortie le …) » right away instead of waiting 60 s for the web player
- Follow switch: announced episodes are no longer counted as already known, so they are downloaded the day they come out (they were skipped forever before)
- movix: a source whose stream was found but could not be saved no longer stops the search, the next sources are tried

### Changed — anime-sama search always live, catalogue rebuilt every day
- anime-sama is asked at every search, so new titles appear right away; the local catalogue completes the results (close spellings the site's search misses) and answers alone when the site does not
- The site's search had moved (old address 404, result cards without `title`): it now uses the site's own search box request, with the catalogue page as a second way; until now only the local catalogue answered. Loosely related titles the site adds (« kaiju » → Kaiji) are left out: every word searched must be in the title, its address or its other names
- Other scans of a page carry the work's name: « One Piece — Scans (noir et blanc) »
- The catalogue is rebuilt every day (`CATALOGUE_REFRESH_DAYS`, default 1) instead of every week; « Actualiser » still rebuilds it by hand. The date shown is the last full rebuild (`data/catalogue.updated`), searches adding titles no longer push the next rebuild back

### Added — anime-sama catalogue kept up to date
- The anime-sama catalogue (list of titles used by the search) is rebuilt from the site every week (`CATALOGUE_REFRESH_DAYS`, default 7); titles are only ever added, posters and descriptions already known are kept
- A search that finds nothing in the catalogue asks anime-sama directly and adds the new titles found
- Téléchargements: under the search field, « Catalogue anime-sama : N titres, mis à jour le … » with an « Actualiser » button (admin)

### Fixed — anime-sama pages read like a browser (audit of 88 titles)
- The page is read as the browser runs it: seasons the site disables with `/* */` or `//` comments and whole sections hidden in `<!-- -->` are ignored, real lines next to them are no longer lost (cause of the missing Naruto manga)
- The site's example links (`panneau("nom", "url")`) no longer create phantom seasons; a scan page answering 200 is no longer taken as proof that scans exist (fake manga results)
- Other scans of a page (one-shot, spin-off: `scan_one_shot`, `scan-boruto-…`) appear as their own manga
- « Sans fillers » for every season kind (`kaihs`, `film…hs`)
- Episode lists written by the site without closing quotes (Hunter x Hunter sans fillers, Star Butterfly saison 3 VF) are read in full

### Fixed — Naruto manga missing from anime-sama results
- anisama: the scans of a title are now always checked (2 quick requests) instead of only when the title page listed them where the script read it — the « Naruto » manga (700+ chapters) was missing
- anisama: the chapter list is asked with the title exactly as the site writes it (« Naruto  » with its spaces); the trimmed title answered « not found » and made the script fail. API errors no longer crash it
- anisama: « Sans fillers » seasons (`saison1hs`) are listed and downloadable

### Changed
- Download search results always come in the same order, whatever site answers first: anime (anime-sama), manga (anime-sama), films (films.py), films (movix), series (movix), then YouTube videos

### Fixed — downloaded series shown as another title
- A « One Piece » episode downloaded from movix (the 1999 anime, TMDB 37854) appeared in Séries as the 2023 live-action series: the library scan looked the folder name up on TMDB and took the most popular match. Downloads from movix now leave the exact TMDB id next to the files (`.nexus.json` in the series folder, `.<file>.nexus.json` for a film); the scan uses it instead of searching by name, and corrects a title already matched wrongly (metadata and episode titles). Hints are also written at startup for movix downloads finished before this update

### Changed
- Download results say where they come from: « 2 saisons · anime-sama », the detail sheet shows « Source : movix · script movix.py », and the queue shows the site of each job

### Fixed — push notifications refused by Apple
- iPhone notifications never arrived: the server signed them as `mailto:admin@localhost`, which Apple rejects (403 BadJwtToken). The sender is now `VAPID_SUBJECT`, else the public https address of Nexus (`FRONTEND_URL`), never localhost
- « Envoyer un test » says why a send failed (service and reason) instead of « Aucun appareil abonné »; opening Réglages sends this device's subscription to the server again, in case it was forgotten

### Changed — downloads on iPhone, anime badge, follow switch in the library
- iPhone: Téléchargements now lives in Médias (download button with the active count in the navigation bar of Films / Séries / Animes / YouTube; back goes to Médias) instead of Aperçu
- The anime badge reads « Animé/Série »
- The « Téléchargement automatique » switch is also on the library page of every anime, series and manga (off by default). Nexus finds the matching title on the site — from the downloads that created its files, else by its exact name — and follows the season / language downloaded last (else the latest season). `GET /api/downloads/follows/media/:id`

### Added — automatic downloads of new episodes / chapters (step 6, off by default)
- In the detail sheet of an anime, a series or a manga: « Télécharger automatiquement les nouveaux épisodes / chapitres ». Off unless switched on; it follows the season and language chosen in the sheet. What exists when it is switched on is never downloaded by itself — only what comes out afterwards
- Each followed title is checked once a day (one after the other, gentle with the sites); new episodes / chapters are added to the queue, so they get the usual progress and notifications. `GET|PUT /api/downloads/follows`, `POST /api/downloads/follows/check` (check now)

### Added — YouTube in Médias, push notifications (step 5, part 2)
- Médias › YouTube, next to Films / Séries / Animes (same switch on Mac and iPhone; the switch now shows on every video page on Mac too): the videos of `/media/youtube` as 16:9 thumbnails with title, channel and duration, newest download first or by title, optionally grouped by channel; playing resumes where you stopped
- The scanner indexes `/media/youtube` (`MediaScanner.scanYoutube`, `POST /api/media/scan/youtube`, part of full scans and of the rescan after a YouTube download): title, channel, duration and date from yt-dlp's `.info.json`, the `.jpg` next to the video as thumbnail (served by the image route, only from the library folders); old `/media/youtube/Titre.mp4` files are listed too
- Films saved by movix in language folders (`/media/films/VF/Titre_2020.mp4`) are now one film each instead of a single title « VF »
- PWA push notifications: Réglages › Notifications turns them on per device (iPhone: from the home-screen app); a notification when a download finishes or fails, opening the queue when tapped; « Envoyer un test ». VAPID keys generated once in `backend/data/vapid.json` (or `VAPID_*` in `.env`); devices that unsubscribed are forgotten
- Migration 004: media type `youtube` + `channel`, tables `push_subscriptions` and `follows`

### Added — « Téléchargements » page (step 5, part 1)
- New section Téléchargements (sidebar, ⌘K, and Aperçu on iPhone), admins only
- One search field queries the four scripts at once; cards appear as each script answers, with a discreet line for the ones still searching or that failed. Poster grid like the TV app on Mac (YouTube in 16:9 with the duration), big thumbnails list on iPhone; type filter Tout / Animés / Mangas / Films / Séries / YouTube; badges with one system colour per type; images that fail show a neutral placeholder
- Detail sheet (macOS sheet / iOS bottom sheet): season and language, episodes or chapters as number chips with a range « De … à … », « Tout sélectionner », already downloaded ones ticked; one button for a film or a video; duplicates ask before downloading again
- Queue: En cours / En attente / Terminés / Échecs with progress bars (chapter and page for manga; Mo, speed and time left for video), live over Socket.io; pause / resume / cancel / retry / remove from the context menu on Mac and by swiping the row on iPhone; « Ouvrir » plays the video or opens the manga reader
- `GET /api/downloads/:id/open` finds the downloaded file in the library

### Added — downloads backend (step 4 of « Téléchargements »)
- Table `downloads` (migration 003) and a queue worker: 2 jobs at a time (`DOWNLOADS_PARALLEL`), each runs the right script with `spawn` (arguments as an array, minimal environment without Nexus' secrets, own process group so pause / cancel also stop ffmpeg and the browser), reads its JSON Lines and saves the progress; jobs left running by a restart go back to the queue
- Admin API: `POST /api/downloads/search` (the four scripts in parallel, results streamed over Socket.io `/downloads` as `download:search_result`, one `download:search_done` per script, timeout per script), `GET /api/downloads/details`, `POST /api/downloads`, `GET /api/downloads`, `POST /api/downloads/:id/pause|resume|cancel|retry`, `DELETE /api/downloads/:id`; live `download:status` / `download:progress`
- Strict validation of ids, languages, seasons and episode / chapter lists; duplicates (same title and episodes / chapters already queued or done) answer 409 with the list instead of downloading again, unless forced
- When a download finishes, the library of its type is rescanned so it appears at once
- Search posters go through `/api/images/remote`, a cached image proxy that only serves URLs signed by the server
- `migrate-db.sh` gives tables created by migrations to the database owner

### Added — download scripts usable by Nexus (step 1 of « Téléchargements »)
- `downloaders/`: copies of the scripts of `/media/scripts` (anisama, films, movix, youtube; the originals stay untouched as a backup) with a non-interactive mode: `--json --search`, `--details`, `--download <id> [--season] [--lang] [--episodes|--chapters] --dest`. Output is JSON Lines (`result`, `details`, `item_start`, `progress`, `item_done`, `item_skipped`, `error`, `done`); without `--json` the menus work as before
- anisama: one title gives an `anime` and/or a `manga` result (season links vs `scan/` links of the site), with poster and synopsis kept in its catalogue; fixed for the site's new video host (ansembed) and dead mirror domains (each request now sends its own site as Referer)
- movix: the TMDB key is no longer written in the script (`TMDB_API_KEY` from the environment / Nexus' `.env`)
- youtube: search through yt-dlp metadata (thumbnail, duration, channel); downloads go to `/media/youtube/{Chaîne}/{Titre} [id].mp4` with the thumbnail `.jpg` (same name, also embedded) and `.info.json`
- Files being downloaded are named `.part-…` and renamed when complete, so a cut download is never taken for a finished one
- CI compiles the scripts and runs their unit tests

### Fixed — services and overview show the real state of the server
- Services are read from systemd (`systemctl show`) instead of `is-active`, which answered "inactive" for units that do not exist: services that are not installed now show "Non installé" (hidden from Aperçu) instead of "Arrêté"
- Cockpit is socket-activated: it now shows "Actif · à la demande" when its socket is listening, instead of "Arrêté"; Démarrer / Arrêter / Redémarrer act on the socket too, and its journal includes both units
- Wi-Fi uses the network manager actually installed (`WIFI_SERVICE`, wifi, NetworkManager, iwd, wpa_supplicant, systemd-networkd); the Wi-Fi watchdog and automatic deployment are listed too
- Service details: since when, memory used, started at boot, systemd units; states "Démarrage…" / "Arrêt…" are shown instead of "État inconnu"
- Memory in Aperçu no longer counts the Linux disk cache as used (total − available, like htop); free disk space is the space really writable

### Changed — Apple-like motion
- Buttons, links and cards shrink slightly under the finger / click and spring back when released (cards press more softly); list rows highlight at once and fade out on release, like iOS lists
- Pages slide in like iOS navigation on phones (push from the right, back from the left, fade between tabs) and fade in on Mac / iPad; each page keeps its own scroll position (a new page opens at the top, "back" returns where you were)
- Segmented controls: the selected thumb slides to the new choice; switches: the knob stretches while pressed; tab bar icons bounce when chosen; context menus pop open from where they were asked; artwork fades in once loaded
- Everything follows "Reduce motion"

### Fixed
- MangaDex matched the wrong title (a "One Piece" folder got "One Piece: Ace's Story—The Manga"): MangaDex sorted its results by latest upload, so licensed series without chapters on the site fell behind their spin-offs. The search now asks for relevance order, also compares alternative titles, ignores punctuation / accents, and prefers the closest title over one that only starts the same way
- A rescan now replaces a wrong MangaDex match already stored (title, cover, synopsis, genres); when MangaDex does not answer, the stored data is kept

### Removed
- The Scripts page (running `.py` / `.sh` files from `/media/scripts`) and its `/api/scripts` routes: it did not work and the space will be used for something else

### Changed — manga pages served like manga sites
- New `GET /api/media/chapters/:id/page/:n?w=` (stream token): every page (image folder, CBZ or PDF) is converted once by the server to a light WebP at the screen's width (sharp; PDFs via poppler `pdftoppm`), kept in `backend/cache/pages` and sent with an immutable cache header. A 2 MB scan becomes a few hundred KB; PDFs are no longer downloaded and drawn by the phone
- The server prepares the next 3 pages while one is read, and the reader downloads the next 4 in the background: turning the page is instant
- `deploy.sh` / `setup-server.sh` install `poppler-utils`; without it, PDF chapters fall back to PDF.js on the phone

### Changed — manga: first pages first, chapters kept on the device
- The server now answers Range requests for PDFs too (206): PDF.js only downloads what the page being read needs (first page of a 71 MB volume: ~2 MB instead of the whole file)
- Pages already read (PDF and images) are kept on the device (Cache Storage, last 40 chapters): coming back to a chapter shows them without downloading anything again. Needs HTTPS (or localhost); without it, reading works without the cache

### Fixed
- Manga PDF chapters stayed blank / loading on iPhone: they are now read with PDF.js (Mozilla's PDF reader, works in Safari) inside the Nexus reader, with the same modes as image chapters. The PDF is downloaded in one request (progress shown) because the server answers range requests with the whole file, which broke PDF.js and Safari's own viewer on big PDFs; pages are drawn only when they come near the screen
- Notifications were unreadable in dark mode (white text on the toast library's white background)

### Changed — interface redesigned like a native Apple app
- One design system in `src/design/tokens.css` (colours light / dark, type scale per device, radii, 4/8 spacing, motion, materials); Tailwind only reads these tokens. System font (SF Pro / SF Mono), Geist removed. One accent (system blue); green / orange / red only for states; darker accessible variants for coloured text (WCAG AA)
- Appearance Auto / Clair / Sombre (Auto follows the device and stays local; the server keeps storing light / dark)
- Adaptive app frame: translucent sidebar and toolbar on desktop (⌘K quick search, ⌘, for Réglages), collapsible sidebar on tablets, tab bar (Aperçu, Médias, Manga, Terminal, Réglages), Large Titles and back buttons on phones
- Components: Button, Toggle, SegmentedControl, TextField, GroupedList / ListRow, Sheet (macOS sheet / iOS bottom sheet with swipe to dismiss), ActionSheet, ContextMenu (right click / long press), StatSparkline, CapacityBar, EmptyState, Skeleton, Spinner; confirmations as macOS alerts / iOS action sheets; notifications as banners
- Overview like Activity Monitor (live 3-minute graphs), library like the TV app (featured title, shelves, Finder-like list view), title pages inside the app frame, AVKit-style player controls, Books-style manga reader, Terminal.app theme in light and dark, Finder / Files-like file manager (selection, keyboard, path bar, selection mode on phones), Services as list + detail, Réglages and Réseau as grouped lists, Apple ID-style sign-in
- PWA: manifest, app icon, Apple web-app meta tags (installable on the home screen)
- French units everywhere (6,1 Go, 2,4 Mo/s, 23 %); no emoji, no gradients, glows or neon; old styles, `StatCard`, `ServiceRow`, `notify.tsx` and the unused Plyr stylesheet removed
- Removed the overview's "Redémarrer" and "Mises à jour" buttons: they only displayed a message and did nothing
- Stopping or restarting a service now asks for confirmation (it can cut access to Nexus)

### Changed — immediate automatic deployment
- GitHub webhook `POST /api/deploy/webhook` (HMAC `X-Hub-Signature-256` with `DEPLOY_WEBHOOK_SECRET`, event "Workflow runs"): when the CI of a push to `main` is green, Nexus writes `logs/.deploy-request` and the systemd unit `nexus-auto-deploy.path` deploys immediately
- `auto-deploy.sh install` creates the secret in `backend/.env`, restarts Nexus and prints the webhook settings for GitHub; the timer becomes a 10-minute safety net; commits merged during a deployment are deployed right after it

### Added — automatic deployment
- `scripts/auto-deploy.sh install`: the server checks `main` every 2 minutes and runs `deploy.sh` by itself once the commit's CI is green (red CI → skipped; failing deployment retried 3 times; one run at a time; no CI result after 15 min → deployed anyway). Pull-based: no inbound SSH or GitHub secret. `status` shows the running version vs GitHub and the last deployments
- The disabled SSH "Deploy to Server" CI job is removed

### Fixed
- `wifi-watchdog.sh install` crashed with "Segmentation fault": its `install` function called itself instead of the `install` command

### Added — Wi-Fi watchdog for USB dongles
- `scripts/wifi-watchdog.sh install`: checks the Internet every minute (systemd timer, independent of Nexus) and repairs step by step — Wi-Fi service restart, interface down/up, then software USB replug of the dongle; turns off Wi-Fi power saving and USB autosuspend for the dongle. `status` shows the last repairs
- `deploy.sh` says clearly when the server has no Internet instead of a raw git error

### Added — full server access from Nexus
- File manager administrator mode: when an action is refused for lack of rights and the Nexus account has passwordless sudo, it is done with sudo — create folder/file, edit, rename, move (also between disks), delete, upload, list/read protected folders. What Nexus creates belongs to its account; an edited system file keeps its owner. `FILES_SUDO=off` disables it
- Terminal like Cockpit: real login shell of the account with a clean environment (Nexus' secrets are no longer inherited), `xterm-256color`, session kept on the server when leaving the page / losing the network (output replayed on return, closed after `TERMINAL_IDLE_MINUTES`, default 60), font size, copy / paste (Ctrl+Shift+C / V), clickable links, Unicode, "Réinitialiser", "Nouvelle session" after `exit`, "Reprendre ici" when opened elsewhere
- `deploy.sh` gives the library folders back to the Nexus account automatically when sudo needs no password
- Clear error messages for create / rename / upload / edit in the file manager

### Fixed
- Uploaded file names with accents were garbled ("Ã‰pisode")

### Security — forced deletion accepted any password
- With passwordless sudo (`NOPASSWD`, common on cloud servers), sudo checked nothing, so any password deleted the item. The password is now checked by the system (`unix_chkpwd`, the helper used for logins) before sudo runs, whatever the sudo configuration; if it cannot be checked, the forced deletion is refused

### Added — force a deletion with the server password
- When a deletion in the media library is refused for lack of rights (folder owned by root…), Nexus asks for the server account's password (the one used for `sudo`) and deletes it anyway
- Only inside the library folders (never a library/category folder itself, a system folder, or outside through a symlink or `../`); the password goes to `sudo` on stdin, is never stored or logged; `sudo -k` always re-checks it
- 5 wrong attempts → blocked 15 min (`SUDO_RATE_LIMIT_MAX`); cancelling shows the `chown` command to fix the rights for good

### Changed — confirmations and permission errors
- Confirmations (delete files, remove a title from the library, restart the server) use an in-app dialog instead of the browser's `confirm()`: clear title, what will happen, list of items, red "Supprimer" button, Escape / "Annuler" cancel
- "Permission denied" on deletion now names the folder that actually blocks it (deleting needs write access to the parent folder) and its owner; the error toast shows the `sudo chown` command with a "Copier" button
- `deploy.sh` warns when library folders do not belong to the Nexus user and prints the one-time fix

### Fixed — artwork, manga chapters, file deletion
- Anime covers never displayed: AniList serves them from `s4.anilist.co`, blocked by the CSP; MangaDex refuses hotlinked covers. All remote artwork now goes through a backend proxy with a disk cache (`/api/images/…`), with a clean placeholder when an image is missing
- Manga chapters: recursive discovery (image folders at any depth, PDF and CBZ/ZIP anywhere, one-shots), CBZ reader support, one broken manga no longer stops the scan; chapter list sorted by number with empty / error states
- Artwork is shown whole (object-fit: contain, 2:3 frame, blurred fill) on title pages, the billboard, cards and episode stills; text never overlaps it
- File deletion: clear messages (permission denied with the `chown` command, missing file, busy…), batch delete reporting each failure, protected system/library folders, `../` cannot escape `FILES_ROOT`, list refreshed after deletion

### Added — play every video in the browser
- ffprobe detects whether a file is browser-ready (MP4 + H.264 8-bit + AAC/MP3); if so it is streamed directly with range requests
- Otherwise the server converts it on the fly to HLS with ffmpeg: H.264 video is copied and only the audio is converted to AAC; HEVC/MPEG-4/10-bit… are re-encoded with `libx264 -preset veryfast` (max 1080p)
- Seeking anywhere: the conversion restarts at the requested position; ffmpeg is stopped when the player closes, the tab is hidden, or the player stops requesting segments
- Player: centered loading spinner (load / buffering), "Préparation de la vidéo…" while converting
- Fixed: the player reloaded the video (back to 0) on some re-renders

### Fixed (playback & deploy diagnostics)
- Playback progress was never really saved (the periodic save kept the first position); resume now works and "Recommencer" restarts from 0
- Unknown `/api/*` routes returned the SPA page with HTTP 200 instead of a 404 (an outdated backend looked "OK" to the UI)
- Backend reports its build (`/api/health`), the UI warns when it differs from the interface; `deploy.sh` verifies the running build; clear log when the port is already in use
- File manager keeps the current folder in the URL

### Added
- End-to-end test suite on the production build (`npm run e2e`)

### Security
- File manager (`/api/files/*`) is now admin-only; non-admin users can only stream/download inside `MEDIA_ROOT`
- Media URLs use a short-lived read-only *stream* token instead of the access token; tokens in URLs are redacted from access logs
- Typed JWTs (`access` / `refresh` / `stream`), optional `JWT_REFRESH_SECRET`, access tokens now last 15 min
- Refresh re-reads the user from the database (deleted or demoted users lose access)
- Rate limiting on login/refresh and on the API (streaming excluded)
- Script names validated against the scripts directory (no path traversal)
- `execFile` instead of shell `exec` for systemctl/journalctl; unused `runCommand` removed
- Upload filenames sanitized, `rename` rejects names containing a path, Range headers validated (416)

### Fixed
- Rescanning a manga no longer wipes reading progress (chapter upsert in a transaction)
- `.sh` scripts can be run
- Only one media scan runs at a time (409 otherwise)

### Changed
- Versioned database migrations (`backend/src/db/migrations`, `scripts/migrate-db.sh`) replace inline SQL in `deploy.sh`
- Service links come from `SERVICES_DOMAIN`, sudoers file is a template (`NEXUS_USER`)
- Admin-only pages hidden from the sidebar for regular users

### Added
- Full-stack server control panel with React + Node.js + PostgreSQL
- JWT authentication with bcrypt hashing and refresh tokens
- Real-time system stats (CPU, RAM, disk, temperature) via WebSocket
- Complete file manager: browse, edit, upload, download, rename, delete
- Integrated terminal (xterm.js + node-pty via WebSocket)
- Services management: start/stop/restart systemd services with logs
- Scripts runner with SSE streaming output
- Media library: films, series, animes, manga/webtoon
- Automatic metadata fetching from TMDB, AniList, MangaDex
- Custom video player (Plyr) with resume, progress tracking, episode list
- Manga/webtoon reader: vertical scroll, page mode, RTL, zoom, chapters
- Dark/light theme with CSS variables
- Network info page
- Settings: profile, theme, password change
- CI/CD pipeline (GitHub Actions): lint → typecheck → tests → build → deploy
- PM2 ecosystem config
- Cloudflare Tunnel integration
- Complete PostgreSQL schema with triggers

### Security
- JWT + bcrypt authentication
- Rate limiting on all endpoints (stricter on auth)
- Helmet.js security headers
- CORS configuration
- Role-based access (admin/user)
- Sudoers config for safe service control

## [0.1.0] - 2026-04-21
- Initial project scaffolding
