"""A backend for proof games on the Lean REPL: the protocol of docs/game-protocol.md, in a first form.

The backend is only Lean: it gets a context and a statement, and plays moves (tactics) on proof
states. The rules of a game (which tactics and theorems are allowed, hints) are the frontend's
business. One REPL process, started in a project (here nng4), holds the base environment (here the
whole game, `import Game`); all players share it, and contexts are kept, so that each costs once.

    cd nng4 && python3 -I ../repl/bridge.py [port]        (default port 8090)

POST /start {"context": "namespace MyNat", "statement": "example (x y : ℕ) (h : y = x + 7) : 2 * y = 2 * (x + 7)"}
            (or, for convenience, {"world": "Tutorial", "level": 2}: the level from nng4's game data)
                                                         → {"session", "state": {"id", "goals", "solved"}}
POST /step  {"session", "state": 0, "tactic": "rw [h]"}  → {"state": …} or {"error": {"kind", "message"}}
POST /check {"session", "proof": "rw [h]\nrfl"}         → the proof state as lean4game's Game.getProofState
                                                           gives it (steps, diagnostics, completed), so that
                                                           nng-verso's client can show it as it is

With ALLOWED=<file> (a SHA-256 of a context per line), only these contexts are accepted; the hash
of the NNG context: `printf 'namespace MyNat' | sha256sum`.

The REPL is not thread-safe: requests are answered one after another.
"""
import hashlib, json, os, re, subprocess, sys, threading, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPL = os.path.expanduser(os.environ.get('REPL', '~/Code/lean/repl-v4.23/.lake/build/bin/repl'))
GAMEDATA = Path('.lake/gamedata')
# the contexts this server accepts (SHA-256 of their text, one per line); without the file, any
ALLOWED = ({l.split()[0] for l in Path(os.environ['ALLOWED']).read_text().splitlines() if l.strip() and not l.startswith('#')}
           if os.environ.get('ALLOWED') else None)


class Repl:
    """The REPL process; one request at a time."""

    def __init__(self):
        self.p = subprocess.Popen(['lake', 'env', REPL], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        self.lock = threading.Lock()
        # the base: what the server keeps loaded (BASE, here the whole game)
        self.base = self.ask({'cmd': os.environ.get('BASE', 'import Game')})['env']
        self.contexts = {}

    def context(self, code):
        """The environment of a context (Lean code after the base), elaborated once. With a file
        ALLOWED (one SHA-256 of a context per line), only the contexts listed there are accepted."""
        if ALLOWED is not None and hashlib.sha256(code.encode()).hexdigest() not in ALLOWED:
            raise PermissionError('this server does not accept this context')
        if code not in self.contexts:
            r = self.ask({'cmd': code, 'env': self.base}) if code.strip() else {'env': self.base}
            errors = [m['data'] for m in r.get('messages', []) if m.get('severity') == 'error']
            if errors:
                raise ValueError('the context has errors: ' + '; '.join(errors))
            self.contexts[code] = r['env']
        return self.contexts[code]

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


def nng_level(world, n):
    """For convenience: the context and statement of a level of nng4, from its game data."""
    d = json.loads((GAMEDATA / f'level__{world}__{n}.json').read_text())
    # `theorem zero_add … := by` is already in the game: here it is an example
    statement = re.sub(r'^theorem\s+\S+', 'example', d['descrFormat'].strip())
    return 'namespace MyNat', re.sub(r'\s*:=\s*by\s*$', '', statement)


class Session:
    def __init__(self, repl, context, statement):
        self.repl = repl
        r = repl.ask({'cmd': statement + ' := by\n  sorry', 'env': repl.context(context)})
        errors = [m['data'] for m in r.get('messages', []) if m.get('severity') == 'error']
        if errors or not r.get('sorries'):
            raise ValueError('the statement has errors: ' + '; '.join(errors))
        s = r['sorries'][0]
        self.start = {'id': s['proofState'], 'goals': [s['goal']], 'solved': False}
        self.cache = {}  # (state, tactic) → the answer, so that a proof checked again costs nothing

    def step(self, state, tactic):
        key = (state, tactic)
        if key not in self.cache:
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


class Handler(BaseHTTPRequestHandler):
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        # (a page on the web may then ask a bridge on 127.0.0.1, e.g. through an SSH tunnel: Chrome's
        # Private Network Access)
        self.send_header('Access-Control-Allow-Private-Network', 'true')

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def answer(self, obj, code=200):
        # one line per request: when, what, the outcome, how long
        outcome = obj.get('error', {}).get('message', '')[:60] if 'error' in obj else 'solved' if obj.get('completed') or obj.get('state', {}).get('solved') else 'ok'
        print(f"{time.strftime('%H:%M:%S')} {self.client_address[0]} {getattr(self, 'what', self.path)} → {outcome} ({(time.time() - getattr(self, 't0', time.time())) * 1000:.0f} ms)", flush=True)
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.cors()
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        self.t0, self.what = time.time(), self.path
        try:
            req = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
            self.what = f"{self.path} {req.get('statement', '')[:50] or (req.get('tactic') or (req.get('proof') or '').strip().replace(chr(10), '; '))[:60]}"

            if self.path == '/start':
                context, statement = (req.get('context', ''), req['statement']) if 'statement' in req else nng_level(req['world'], int(req['level']))
                sid = uuid.uuid4().hex[:12]
                sessions[sid] = Session(repl, context, statement)
                return self.answer({'session': sid, 'state': sessions[sid].start})
            s = sessions.get(req.get('session'))
            if not s:
                return self.answer({'error': {'kind': 'session', 'message': 'unknown session'}}, 404)
            if self.path == '/step':
                return self.answer(s.step(int(req['state']), req['tactic']))
            if self.path == '/check':
                return self.answer(s.check(req.get('proof', '')))
            self.answer({'error': {'kind': 'path', 'message': self.path}}, 404)
        except PermissionError as e:
            self.answer({'error': {'kind': 'context', 'message': str(e)}}, 403)
        except Exception as e:  # a request that cannot be answered must not end the server
            self.answer({'error': {'kind': 'server', 'message': f'{type(e).__name__}: {e}'}}, 500)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
    repl = Repl()
    print(f'nng4 on the REPL, at http://127.0.0.1:{port}/', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
