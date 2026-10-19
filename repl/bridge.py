"""A game backend for nng4 on the Lean REPL: the protocol of docs/game-protocol.md, in a first form.

One REPL process, started in nng4, holds the loaded game; all players share it. A level is its
statement in the game's environment; a move is a tactic on a proof state. The rules of the level
(the tactics and theorems of its inventory) are checked here, before Lean sees the tactic.

    cd nng4 && python3 -I ../repl/bridge.py [port]        (default port 8090)

POST /start {"world": "Tutorial", "level": 2}            → {"session", "state": {"id", "goals", "solved"}}
POST /step  {"session", "state": 0, "tactic": "rw [h]"}  → {"state": …} or {"error": {"kind", "message"}}
POST /check {"session", "proof": "rw [h]\\nrfl"}         → the proof state as lean4game's Game.getProofState
                                                           gives it (steps, diagnostics, completed), so that
                                                           nng-verso's client can show it as it is

Hints are not given yet. The REPL is not thread-safe: requests are answered one after another.
"""
import json, os, re, subprocess, sys, threading, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPL = os.path.expanduser(os.environ.get('REPL', '~/Code/lean/repl-v4.23/.lake/build/bin/repl'))
GAMEDATA = Path('.lake/gamedata')


class Repl:
    """The REPL process; one request at a time."""

    def __init__(self):
        self.p = subprocess.Popen(['lake', 'env', REPL], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        self.lock = threading.Lock()
        # the whole game, in the namespace of its levels
        self.env = self.ask({'cmd': 'import Game\nnamespace MyNat'})['env']

    def ask(self, obj):
        with self.lock:
            self.p.stdin.write(json.dumps(obj) + '\n\n')
            self.p.stdin.flush()
            lines = []
            while True:
                line = self.p.stdout.readline()
                if not line:
                    raise RuntimeError('the REPL has ended')
                if line.strip() == '' and lines:
                    break
                if line.strip():
                    lines.append(line)
            return json.loads(''.join(lines))


class Level:
    """A level of the game: its statement and its inventory, from the game data."""

    def __init__(self, world, n):
        d = json.loads((GAMEDATA / f'level__{world}__{n}.json').read_text())
        # `theorem zero_add … := by` is already in the game: here it is an example
        self.statement = re.sub(r'^theorem\s+\S+', 'example', d['descrFormat'].strip())
        if not self.statement.endswith(':= by'):
            self.statement += ' := by'
        usable = lambda i: not i['locked'] and not i['disabled']
        self.tactics = {i['name'] for i in d['tactics'] if usable(i)}
        # theorems: by their short and their full name; the ones that are not (yet) allowed
        self.theorems = {}
        for i in d['lemmas']:
            for name in {i['name'], i['displayName'], i['name'].split('.')[-1]}:
                self.theorems[name] = usable(i)

    def refuse(self, tactic):
        """Why the tactic is not allowed in this level, or None."""
        if re.search(r'\b(sorry|admit)\b', tactic):
            return '`sorry` is not allowed.'
        for part in re.split(r';|<;>', tactic):
            words = part.strip().split()
            if not words:
                continue
            name = words[0]
            if name == 'repeat' and len(words) > 1:
                name = words[1]
            if name not in self.tactics:
                return f'The tactic `{name}` is not available in this level.'
        for ident in re.findall(r"[A-Za-z_][\w.']*", tactic):
            if self.theorems.get(ident) is False:
                return f'The theorem `{ident}` is not available in this level.'
        return None


class Session:
    def __init__(self, repl, level):
        self.repl, self.level = repl, level
        r = repl.ask({'cmd': level.statement + '\n  sorry', 'env': repl.env})
        s = r['sorries'][0]
        self.start = {'id': s['proofState'], 'goals': [s['goal']], 'solved': False}
        self.cache = {}  # (state, tactic) → the answer, so that a proof checked again costs nothing

    def step(self, state, tactic):
        key = (state, tactic)
        if key not in self.cache:
            why = self.level.refuse(tactic)
            if why:
                self.cache[key] = {'error': {'kind': 'not-allowed', 'message': why}}
            else:
                r = self.repl.ask({'tactic': tactic, 'proofState': state})
                if 'message' in r and 'proofState' not in r:
                    self.cache[key] = {'error': {'kind': 'lean', 'message': r['message'].removeprefix('Lean error:\n')}}
                else:
                    errors = [m['data'] for m in r.get('messages', []) if m.get('severity') == 'error']
                    if errors:
                        self.cache[key] = {'error': {'kind': 'lean', 'message': '\n'.join(errors)}}
                    else:
                        self.cache[key] = {'state': {'id': r['proofState'], 'goals': r.get('goals', []),
                                                     'solved': r.get('proofStatus') == 'Completed'}}
        return self.cache[key]

    def check(self, proof):
        """The whole proof, line by line, as lean4game's Game.getProofState answers."""
        goals = lambda gs: [{'goal': {'text': g}, 'hints': []} for g in gs]
        steps = [{'line': 0, 'goals': goals(self.start['goals']), 'diags': []}]
        state, solved = self.start, False
        for i, line in enumerate(proof.split('\n')):
            tactic = re.sub(r'^\s*·\s*', '', line).strip()
            if not tactic or tactic.startswith('--'):
                continue
            r = self.step(state['id'], tactic)
            if 'error' in r:
                steps.append({'line': i + 1, 'goals': goals(state['goals']), 'diags': [{
                    'severity': 1, 'range': {'start': {'line': i, 'character': 0}, 'end': {'line': i, 'character': len(line)}},
                    'message': {'text': r['error']['message']}}]})
                return {'steps': steps, 'diagnostics': [], 'completed': False}
            state = r['state']
            steps.append({'line': i + 1, 'goals': goals(state['goals']), 'diags': []})
            solved = state['solved']
        return {'steps': steps, 'diagnostics': [], 'completed': solved}


repl = None
sessions = {}
levels = {}


class Handler(BaseHTTPRequestHandler):
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def answer(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.cors()
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            req = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
            if self.path == '/start':
                key = (req['world'], int(req['level']))
                if key not in levels:
                    levels[key] = Level(*key)
                sid = uuid.uuid4().hex[:12]
                sessions[sid] = Session(repl, levels[key])
                return self.answer({'session': sid, 'state': sessions[sid].start})
            s = sessions.get(req.get('session'))
            if not s:
                return self.answer({'error': {'kind': 'session', 'message': 'unknown session'}}, 404)
            if self.path == '/step':
                return self.answer(s.step(int(req['state']), req['tactic']))
            if self.path == '/check':
                return self.answer(s.check(req.get('proof', '')))
            self.answer({'error': {'kind': 'path', 'message': self.path}}, 404)
        except Exception as e:  # a request that cannot be answered must not end the server
            self.answer({'error': {'kind': 'server', 'message': f'{type(e).__name__}: {e}'}}, 500)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
    repl = Repl()
    print(f'nng4 on the REPL, at http://127.0.0.1:{port}/', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
