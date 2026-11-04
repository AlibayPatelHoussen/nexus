"""Fake download script for the E2E tests: same --json protocol as downloaders/, no internet."""
import json, os, re, sys, time
args = sys.argv[1:]
name = os.path.basename(sys.argv[0]).split('.')[0]
IMG = 'http://localhost:4010/img'
def out(**o): print(json.dumps(o, ensure_ascii=False), flush=True)
def arg(k): return args[args.index(k) + 1] if k in args else None

if '--search' in args:
    q = arg('--search')
    time.sleep({'anisama': 0.3, 'movix': 0.8, 'films': 1.5, 'oxtorrent': 1.2, 'youtube': 1.0}[name])
    if name == 'anisama' and q.lower() != 'one piece':
        slug = re.sub(r'[^a-z0-9]+', '-', q.lower()).strip('-')
        out(type='result', id=f'anisama:anime:{slug}', source='anisama', kind='anime', title=q, poster_url=f'{IMG}/as/{slug}.png', seasons=[{'id': 'saison1', 'label': 'Saison 1', 'langs': ['VOSTFR']}])
        out(type='result', id=f'anisama:manga:{slug}', source='anisama', kind='manga', title=q, poster_url=f'{IMG}/as/{slug}-scan.png', langs=['VF'])
    elif name == 'anisama':
        out(type='result', id='anisama:anime:one-piece', source='anisama', kind='anime', title='One Piece', poster_url=f'{IMG}/as/one-piece.png',
            description='Monkey D. Luffy rêve de devenir le Roi des Pirates.', seasons=[{'id': 'saison1', 'label': 'Saison 1', 'langs': ['VOSTFR', 'VF']}, {'id': 'saison2', 'label': 'Saison 2', 'langs': ['VOSTFR']}])
        out(type='result', id='anisama:manga:one-piece', source='anisama', kind='manga', title='One Piece', poster_url=f'{IMG}/as/one-piece-scan.png', langs=['VF'])
    elif name == 'movix':
        out(type='result', id='movix:tv:37854', source='movix', kind='serie', title='One Piece', year=1999, poster_url=f'{IMG}/tmdb/op-tv.png', langs=['VF', 'VOSTFR'], seasons=[{'id': 1, 'label': 'Saison 1', 'episodes_count': 8}])
        out(type='result', id='movix:movie:900667', source='movix', kind='film', title='One Piece Film - Red', year=2022, poster_url=f'{IMG}/tmdb/op-red.png', langs=['VF', 'VOSTFR'])
    elif name == 'films':
        out(type='result', id='films:aHR0cHM6Ly9leGFtcGxlLmNvbS9iL3gvMQ', source='films', kind='film', title='One Piece Stampede', year=None, poster_url='https://broken.invalid/x.jpg')
    elif name == 'oxtorrent' and q.lower() == 'one piece':
        out(type='result', id='oxtorrent:serie:5550', source='oxtorrent', kind='serie', title='One Piece', year=None, poster_url=f'{IMG}/tmdb/op-tv.png',
            release='One.Piece.S01.MULTi.1080p.WEB.x264', size='12.4 GB', seeds=40, leech=3, langs=['MULTI'], quality='1080p', season=1)
    elif name == 'youtube':
        for i in range(3):
            out(type='result', id=f'youtube:abcdefghij{i}', source='youtube', kind='youtube', title=f'{q} — vidéo {i + 1}', channel='Chaîne Test',
                duration=212 + i * 60, thumbnail_url=f'{IMG}/yt/wide-{i}.png', poster_url=f'{IMG}/yt/wide-{i}.png')
    out(type='done')
elif '--details' in args:
    ident = arg('--details')
    if ident.startswith('anisama:manga'):
        out(type='details', id=ident, kind='manga', title='One Piece', langs=[{'lang': 'VF', 'chapters': [{'n': n, 'pages': 18, 'downloaded': n == 1} for n in range(1, 41)]}])
    elif ident.startswith('anisama:anime'):
        out(type='details', id=ident, kind='anime', title='One Piece', seasons=[
            {'id': 'saison1', 'lang': 'VOSTFR', 'label': 'Saison 1 — VOSTFR', 'episodes': [{'n': n, 'label': f'Episode {n}', 'downloaded': False} for n in range(1, 62)]},
            {'id': 'saison1', 'lang': 'VF', 'label': 'Saison 1 — VF', 'episodes': [{'n': n, 'label': f'Episode {n}', 'downloaded': False} for n in range(1, 62)]},
            {'id': 'saison2', 'lang': 'VOSTFR', 'label': 'Saison 2 — VOSTFR', 'episodes': [{'n': n, 'label': f'Episode {n}', 'downloaded': False} for n in range(1, 78)]}])
    elif ident.startswith('oxtorrent:'):
        out(type='details', id=ident, kind='serie', title='One Piece', release='One.Piece.S01.MULTi.1080p.WEB.x264', size='12.4 GB',
            seeds=40, leech=3, langs=['MULTI'], quality='1080p', season=1, downloadable=True, description='Saison 1 complète.')
    elif ident.startswith('movix:tv'):
        out(type='details', id=ident, kind='serie', title='One Piece', langs=['VF', 'VOSTFR'], seasons=[{'id': 1, 'label': 'Saison 1', 'episodes': [{'n': n, 'label': f'E{n:02d}', 'downloaded': []} for n in range(1, 9)]}])
    else:
        out(type='details', id=ident, kind='film', title='One Piece Film - Red', langs=[{'lang': 'VF', 'downloaded': False}, {'lang': 'VOSTFR', 'downloaded': False}])
    out(type='done')
elif '--download' in args:
    ident, dest = arg('--download'), arg('--dest')
    sel = arg('--chapters') or arg('--episodes') or '1'
    nums = []
    for part in sel.split(','):
        a, _, b = part.partition('-')
        nums += list(range(int(a), int(b or a) + 1))
    for i, n in enumerate(nums, 1):
        item = f'Chapitre {n}' if ident.startswith('anisama:manga') else 'One.Piece.S01.MULTi.1080p.WEB.x264' if ident.startswith('oxtorrent:') else f'Episode {n}'
        out(type='item_start', name=item, index=i, total=len(nums))
        for step in range(1, 6):
            time.sleep(0.25)
            if ident.startswith('anisama:manga'):
                out(type='progress', item=item, chapter=i, chapters_total=len(nums), page=step * 4, pages_total=20)
            else:
                out(type='progress', item=item, percent=step * 20, downloaded_mb=step * 60.0, total_mb=300.0, speed='4.2 MB/s', eta=f'{(5 - step)}s')
        path = os.path.join('/tmp/nexus-e2e-downloads', os.path.basename(dest), f'{item}.bin')   # never in the test library
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, 'w').write('x')
        out(type='item_done', name=item, path=path)
    out(type='done', ok=len(nums), failed=0, skipped=0)
