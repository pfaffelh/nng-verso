# Many "players" in one REPL process: each opens the level and plays rw [h], rfl.
# Measures the time of each kind of request and the memory of the process.
import json, subprocess, sys, time, os
repl = os.path.expanduser(os.environ.get('REPL', '~/Code/lean/repl-v4.23/.lake/build/bin/repl'))
p = subprocess.Popen(['lake', 'env', repl], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
def ask(obj):
    p.stdin.write(json.dumps(obj) + '\n\n'); p.stdin.flush()
    lines = []
    while True:
        l = p.stdout.readline()
        if l.strip() == '' and lines: break
        if l.strip(): lines.append(l)
    return json.loads(''.join(lines))
def rss():
    # the repl process is a child of `lake env`
    pids = subprocess.run(['pgrep', '-P', str(p.pid)], capture_output=True, text=True).stdout.split() or [str(p.pid)]
    return max(int(open(f'/proc/{q}/status').read().split('VmRSS:')[1].split()[0]) for q in pids) // 1024
t = time.time(); env = ask({'cmd': 'import Game.Metadata\nimport Game.MyNat.Multiplication\nnamespace MyNat'})['env']
print(f'import: {time.time()-t:.2f} s, {rss()} MB')
n = int(sys.argv[1]) if len(sys.argv) > 1 else 100
times = {'open': [], 'rw': [], 'rfl': []}
for i in range(n):
    t = time.time(); r = ask({'cmd': 'example (x y : ℕ) (h : y = x + 7) : 2 * y = 2 * (x + 7) := by\n  sorry', 'env': env}); times['open'].append(time.time() - t)
    s0 = r['sorries'][0]['proofState']
    t = time.time(); s1 = ask({'tactic': 'rw [h]', 'proofState': s0}); times['rw'].append(time.time() - t)
    t = time.time(); s2 = ask({'tactic': 'rfl', 'proofState': s1['proofState']}); times['rfl'].append(time.time() - t)
    assert s2['proofStatus'] == 'Completed', s2
    if i + 1 in (1, 10, 50, 100, 200, 500): print(f'{i+1} players: {rss()} MB')
for k, v in times.items(): print(f'{k}: median {sorted(v)[len(v)//2]*1000:.0f} ms, max {max(v)*1000:.0f} ms')
p.stdin.close(); p.wait()
