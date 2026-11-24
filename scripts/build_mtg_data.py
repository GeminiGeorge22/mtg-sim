#!/usr/bin/env python3
# Build slim, sharded MTG card data from Scryfall's free Oracle Cards bulk file (jsonl.gz) into public/data/mtg/*.json (Workers static assets).
# usage: python3 scripts/build_mtg_data.py /tmp/oracle.jsonl.gz    (then delete the bulk file)
import gzip, json, sys, re, os, zlib
FORMATS = ['standard','pioneer','modern','legacy','vintage','pauper','commander','historic','timeless','explorer','alchemy','brawl','standardbrawl','oathbreaker','penny','premodern','oldschool','predh','paupercommander','duel','gladiator','future']
CODE = {'legal':'l','banned':'b','restricted':'r','not_legal':'n'}
SKIP = {'token','art_series','emblem','double_faced_token','vanguard','scheme','planar'}
NSH = 64
def shard(k): return zlib.crc32(k.encode()) % NSH
def limit(text, type_line):
    if re.search(r'\bBasic\b.*\bLand\b', type_line): return 'any'
    if re.search(r'A deck can have any number of cards named', text, re.I): return 'any'
    m = re.search(r'A deck can have up to (\w+) cards named', text, re.I)
    if m: return {'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,'seven':7,'eight':8,'nine':9,'ten':10}.get(m.group(1).lower()) or int(m.group(1)) if m.group(1).isdigit() or m.group(1).lower() in ['one','two','three','four','five','six','seven','eight','nine','ten'] else 4
    return None
shards = [dict() for _ in range(NSH)]; n = 0
with gzip.open(sys.argv[1], 'rt') as f:
    for line in f:
        line = line.strip().rstrip(',')
        if not line or line in '[]': continue
        c = json.loads(line)
        if c.get('layout') in SKIP or c.get('set_type') == 'memorabilia' and c.get('layout') != 'normal': continue
        faces = c.get('card_faces') or []
        tl = c.get('type_line') or (faces[0].get('type_line','') if faces else '')
        text = c.get('oracle_text') or '\n'.join(x.get('oracle_text','') for x in faces)
        cost = c.get('mana_cost') if c.get('mana_cost') not in (None, '') else (faces[0].get('mana_cost','') if faces else '')
        rec = {'n': c['name'], 'm': c.get('cmc', 0), 't': tl, 'c': ''.join(c.get('color_identity', [])), 'k': cost or '', 'p': ''.join(x for x in c.get('produced_mana', []) if len(x) == 1),
               'g': ''.join(CODE.get(c.get('legalities', {}).get(fm, 'not_legal'), 'n') for fm in FORMATS)}
        lim = limit(text, tl)
        if lim is not None: rec['x'] = lim
        if re.search(r'can be your commander', text, re.I): rec['cmd'] = 1
        if re.search(r'\bPartner\b|Friends forever|Choose a Background|Doctor\'s companion', text): rec['pt'] = 1
        keys = {c['name'].lower()} | {x.get('name','').lower() for x in faces if x.get('name')}
        for k in keys:
            if not k: continue
            s = shards[shard(k)]
            if k in s and k != c['name'].lower(): continue  # full names win over face aliases
            s[k] = rec
        n += 1
os.makedirs('public/data/mtg', exist_ok=True)
for i, s in enumerate(shards):
    json.dump(s, open(f'public/data/mtg/{i}.json', 'w'), separators=(',', ':'), ensure_ascii=False)
json.dump({'formats': FORMATS, 'shards': NSH, 'cards': n, 'source': 'Scryfall Oracle Cards bulk data (free)', 'built': os.environ.get('BUILT', '')}, open('public/data/mtg/meta.json', 'w'))
print('cards', n, 'keys', sum(len(s) for s in shards))
