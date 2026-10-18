#!/usr/bin/env python3
"""Downloads the game data of nng4 from a lean4game server (by default the Lean Game Server of the
HHU Düsseldorf) into ../nng4/.lake/gamedata, where the site reads it when it is built. So the site
can be built without building nng4 (and Mathlib), and its texts and levels match the game that the
server runs.

Usage: python3 scripts/fetch-gamedata.py [base URL] [target directory]
"""
import json, os, sys, urllib.parse, urllib.request

base = sys.argv[1] if len(sys.argv) > 1 else 'https://adam.math.hhu.de/data/g/leanprover-community/nng4'
target = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', '..', 'nng4', '.lake', 'gamedata')
os.makedirs(target, exist_ok=True)


def get(name):
    with urllib.request.urlopen(f'{base}/{urllib.parse.quote(name)}', timeout=60) as r:
        data = r.read()
    with open(os.path.join(target, name), 'wb') as f:
        f.write(data)
    return json.loads(data)


game = get('game.json')
inventory = get('inventory.json')
docs = set()
for kind, prefix in [('tactics', 'Tactic'), ('lemmas', 'Theorem'), ('definitions', 'Definition')]:
    docs |= {(prefix, i['name']) for i in inventory.get(kind, [])}
n = 0
for world, size in game['worldSize'].items():
    for level in range(1, size + 1):
        data = get(f'level__{world}__{level}.json')
        n += 1
        for kind, prefix in [('tactics', 'Tactic'), ('lemmas', 'Theorem'), ('definitions', 'Definition')]:
            docs |= {(prefix, i['name']) for i in data.get(kind, [])}
missing = []
for prefix, name in sorted(docs):
    try:
        get(f'doc__{prefix}__{name}.json')
    except Exception:
        missing.append(f'{prefix} {name}')
print(f'{n} levels, {len(docs) - len(missing)} docs from {base}' +
      (f'; not found: {", ".join(missing)}' if missing else ''))
