# nng4 with the Lean REPL: a first measurement

Can the Natural Number Game be played through the
[Lean REPL](https://github.com/leanprover-community/repl) instead of lean4game's server, one move at
a time (see `docs/game-protocol.md`)? Yes, and much more cheaply.

## Setup

```bash
# nng4 (Lean v4.23.0), with Mathlib from the cache
cd nng4 && lake exe cache get && lake build

# the REPL for the same Lean version (there is no tag v4.23.0; v4.23.0-rc2 builds with v4.23.0)
git clone --depth 1 --branch v4.23.0-rc2 https://github.com/leanprover-community/repl ~/Code/lean/repl-v4.23
cd ~/Code/lean/repl-v4.23 && echo leanprover/lean4:v4.23.0 > lean-toolchain && lake build

# run it in nng4, so that it finds the game
cd nng4 && lake env ~/Code/lean/repl-v4.23/.lake/build/bin/repl
```

A level is the level module's imports and namespace, then the statement with `sorry`, which gives a
proof state; each move is a tactic on a proof state and gives a new one:

```
{"cmd": "import Game.Metadata\nimport Game.MyNat.Multiplication\nnamespace MyNat"}
{"cmd": "example (x y : ℕ) (h : y = x + 7) : 2 * y = 2 * (x + 7) := by\n  sorry", "env": 0}
{"tactic": "rw [h]", "proofState": 0}      → goal 2 * (x + 7) = 2 * (x + 7)  (NNG's rw: no rfl)
{"tactic": "rfl", "proofState": 1}         → "proofStatus": "Completed"
{"tactic": "simp", "proofState": 0}        → "Lean error: `simp` made no progress"
```

## Measurement (2026-10-19, a laptop)

`python3 -I load.py 200` in `nng4`: one REPL process, 200 "players" who each open Tutorial level 2
and play `rw [h]`, `rfl`.

| | |
|---|---|
| loading the game (`import`) | 1.5 s, 1.1 GB |
| 200 players, each with a solved level | 1.14 GB in all (+30 MB) |
| opening a level | 12 ms (median) |
| a move (`rw [h]`, `rfl`) | 1–2 ms |

lean4game starts a Lean process per player (about 1.7 GB each on our test server). With the REPL
the players share the loaded game, and another player costs next to nothing.

## A first backend: `bridge.py`

`bridge.py` puts the protocol of `docs/game-protocol.md` in front of the REPL, in a first form:
`/start`, `/step` and `/check` over HTTP (only the Python standard library). It loads the whole game
once (`import Game`), makes a level's statement an `example`, and checks every tactic against the
level's inventory (tactics, theorems, no `sorry`) before Lean sees it. `/check` plays a whole proof
line by line and answers in the form of lean4game's `Game.getProofState`, so that nng-verso's client
shows it as it is; it keeps the answers, so that a proof checked again costs nothing.

```bash
cd nng4 && python3 -I ../repl/bridge.py 8090        # then open the site with ?backend=http://127.0.0.1:8090
```

The site remembers the backend (`?backend=` switches back to the Lean Game Server of the HHU). With
it, the Tutorial and Addition levels play in text and click input without any connection to the HHU;
a move takes about 0.1 s in the browser.

Still missing in the bridge: hints, `·` blocks (a line is a move on the first goal, which is the same
for proofs without `·`), several REPL processes with a time limit, cleaning up of states.

## What is missing for a game backend

* **The rules**: the REPL knows no inventory; tactics must be checked against the level's (from the
  level data) by a thin layer in front of it.
* **Hints**: they are in the compiled game (lean4game's environment extension); to be read with a
  small Lean command and matched against the goals.
* **Concurrency**: one REPL process answers one request after another; a few processes, and a time
  limit per move (heavy `decide` or `simp`).
* **Cleaning up**: the REPL keeps all proof states; restart processes now and then.
* **Subterm positions**: goals come as text; tapping a subterm (as in nng-verso) needs a small
  extension.
