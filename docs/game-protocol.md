# A standard between Lean and the frontends of proof games

*Draft 0.1, for discussion (Peter Pfaffelhuber, with Claude). Comments welcome.*

Everybody who builds a proof game wants their own frontend: a web app like lean4game, a Verso
document, a click game on a phone, a course page with exercises. The backend is Lean in any case.
What is missing is a **standard in between**: a format for levels, and a protocol for playing them.
This note proposes one, based on what two quite different frontends needed:

* **nng-verso** (this repository, <https://pfaffelh.github.io/nng-verso/>): the Natural Number Game
  as a Verso document, played against the unchanged lean4game backend of the HHU Düsseldorf, with
  text input and a click input (tactics as buttons, theorems as a menu).
* **The Incredible Proof Machine in Lean** (<https://pfaffelh.github.io/ipm/>): natural deduction as
  pictures, played by tapping, with a tactic mode in which every move is a Lean tactic. It checks
  proofs in the browser and shows the proof as Lean code, but has no Lean backend yet.

## 1. What Lean already has, and what is missing

Lean has almost everything a game needs:

* **States**: a proof state is a list of goals (metavariables), each with its local context.
* **Moves**: a tactic is a function from a state to a new state (`evalTactic`).
* **Display**: goals as interactive text with the positions of all subterms (`getInteractiveGoals`,
  `TaggedText`, `SubExpr.Pos`), which is what the infoview shows.
* **History**: the info tree records the state before and after every tactic of a proof.
* **Remote access**: LSP and the RPC framework (used by the infoview and ProofWidgets).

What is missing is a thin layer on top:

1. **A move-oriented interface.** LSP is made for editors: one sends a whole document and asks about
   positions. A game wants: *here is state 17, apply `rw [h]`*, answer: *state 18 with these goals*,
   or *not possible, because …*. The Lean REPL and Pantograph show that this works; they have no game
   rules, though.
2. **Game rules**: which tactics and theorems are allowed, which hint belongs to which goal, when a
   level counts as solved. lean4game has these, built into its server. In this proposal they are
   part of the level format and applied by the frontend (§5); the backend stays plain Lean.
3. **Levels as data**: today a game must be compiled into the server (`MakeGame`); hints, for
   instance, exist only in the compiled game and are not part of the level data that a frontend can
   download.

lean4game's present protocol (WebSocket, LSP, `Game.getProofState`) already serves an external
frontend well — nng-verso uses it unchanged. What we had to learn from the relay's source code, and
what a standard should state, is in Appendix A.

## 2. Layers

```
frontend (any)  ──  protocol (§4), JSON-RPC over WebSocket or HTTP  ──  game server  ──  Lean
(rules, hints,       contexts, statements, moves                        (sessions,
 progress)                                                                warm environments)
```

* The **level format** says what a level is. Levels can come from the frontend (it sends the level
  with `start`) or from the server (a game installed there, referred to by name).
* The **protocol** says how a level is played. It does not care how the frontend looks.
* The **game server** keeps Lean environments warm and runs moves in a sandbox. It knows no game: it
  gets a context and a statement and plays tactics.
* The **frontend** applies the rules of the level format: it offers only allowed moves, checks typed
  ones before it sends them, matches hints, and keeps the progress.

## 3. The level format

A level is a JSON object. Example: Tutorial level 2 of the Natural Number Game.

```json
{
  "format": "lean-game-level/0.1",
  "id": "nng4/Tutorial/2",
  "env": { "base": "nng4", "imports": ["Game.Levels.Tutorial.L01rfl"] },
  "preamble": "",
  "statement": "(x y : ℕ) (h : y = x + 7) : 2 * y = 2 * (x + 7)",
  "name": null,
  "inventory": {
    "tactics": [ { "name": "rfl" }, { "name": "rw", "new": true } ],
    "theorems": [],
    "definitions": [],
    "disabled": []
  },
  "hints": [
    { "goal": "(x y : ℕ) (h : y = x + 7) : 2 * y = 2 * (x + 7)",
      "text": "First execute `rw [h]` to replace the `y` with `x + 7`." },
    { "goal": "(x y : ℕ) (h : y = x + 7) : 2 * (x + 7) = 2 * (x + 7)",
      "text": "Now `rfl` will work.", "hidden": true }
  ],
  "texts": {
    "introduction": "In this level the *goal* is $2y=2(x+7)$ …",
    "conclusion": "You now know enough tactics to prove `2 + 2 = 4`!"
  },
  "solution": "rw [h]\nrfl"
}
```

* **`env`**: the Lean environment the level is elaborated in. `base` names an environment that the
  server keeps warm (here the game nng4; for other games `"Mathlib"` or `"core"`); `imports` are
  modules of it. The base is what makes moves fast: loading Mathlib takes seconds and gigabytes, the
  small context of a level does not.
* **`preamble`**: Lean code elaborated after the imports (definitions, notation, earlier theorems).
  This is how a frontend brings its own levels without a server build. The IPM, for instance, would
  send its statements as propositions (`(A B : Prop) (h₁ : A ∧ B) : B ∧ A`) with an empty preamble.
* **`statement`**: binders and the proposition, as in `example …`. `name`: if set, a solved level
  becomes a theorem of this name for later levels (lean4game's `Statement name`).
* **`inventory`**: what may be used. Entries can carry `new` (introduced here) and the frontend may
  add display data (`displayName`, a category); the server only needs the names. `disabled` lists
  what is known but switched off in this level.
* **`hints`**: a goal pattern and a text. A hint is shown when a goal of the player matches the
  pattern up to the names of hypotheses and variables (lean4game's rule); placeholders `{x}` in the
  text are replaced by the player's names. `hidden` hints are shown on request. Hints could also be
  given, as in lean4game today, as `Hint` commands inside the `solution`; the server then derives the
  goals from it.
* **`texts`**: Markdown with `$…$` for mathematics. How a frontend shows them is its own business.
* **`solution`**: a sample proof. The server checks it when a level is installed, and it is the
  source of hints given inline.

A **game** is a list of worlds, each a list of levels, and the dependencies between worlds (as
lean4game's `game.json`: `worlds.nodes`, `worlds.edges`, `worldSize`). Progress is not part of the
format: frontends keep it themselves (nng-verso and the IPM keep it in the browser).

## 4. The protocol

JSON-RPC 2.0, over a WebSocket (one connection per player) or HTTP (stateless calls with a session
id). Methods:

### `game/start`

```json
{ "base": "nng4", "context": "namespace MyNat",
  "statement": "example (x y : ℕ) (h : y = x + 7) : 2 * y = 2 * (x + 7)" }
```

The backend knows no levels: the frontend sends the level's `env`, `preamble` and `statement` (§3)
as base, context and statement. (A server may offer installed levels by name for convenience.)

Answer: a session, and **state 0**.

```json
{ "session": "s7f3", "state": {
    "id": 0,
    "goals": [ { "id": "g1", "case": null,
      "hyps": [ { "names": ["x", "y"], "type": { "text": "ℕ", "tags": [] } },
                { "names": ["h"], "type": { "text": "y = x + 7", "tags": [ … ] } } ],
      "target": { "text": "2 * y = 2 * (x + 7)", "tags": [ … ] } } ],
    "solved": false } }
```

Expressions are text with **tags**: the ranges of subterms with their position (`SubExpr.Pos`), so
that a frontend can let the player tap a subterm (nng-verso highlights and rewrites them; a click
game needs them).

### `game/step`

```json
{ "session": "s7f3", "state": 0, "tactic": "rw [h]" }
```

Answer: a new state (`id: 1`, with its goals and `solved`) or an error. (That `simp` is not available
in a level is the frontend's message; the backend does not know the level's rules.)

```json
{ "error": { "kind": "lean", "message": "motive is not type correct …" } }
{ "error": { "kind": "limit", "message": "The move took longer than 5 s." } }
```

States are immutable and numbered, so **Undo is free**: one continues from an earlier state. A step
applies to the first goal, as in Lean; `goal` may name another one (`"goal": "g2"`), which a click
frontend with several goals on the screen needs (the IPM's tactic mode works this way).

### `game/check`

For text input: the whole proof at once.

```json
{ "session": "s7f3", "proof": "rw [h]\nrfl" }
```

Answer: the states after each line, the messages with their lines, and `solved`, as lean4game's
`Game.getProofState` today.

### `game/suggest` (optional)

Help for frontends, so that they need not guess:

```json
{ "session": "s7f3", "state": 1, "goal": "g1", "kind": "tactics" }
{ "session": "s7f3", "state": 1, "goal": "g1", "kind": "rewrite", "at": { "hyp": null, "pos": "/1/0" } }
```

Answers: the tactics of the inventory that make progress at this goal (each with the resulting
goals), or the theorems and hypotheses that rewrite the subterm at `pos`. nng-verso's click input
guesses these from the text of the goal today; the IPM computes them itself by unification. A
server can do it properly, but it costs a Lean run per candidate, so it should be bounded.

### `game/match` (optional)

For hints: whether a goal of a state matches patterns (statements with metavariables, in the
level's context), up to the names of hypotheses and variables, and with which names for the
placeholders; a plain Lean question, without game rules.

```json
{ "session": "s7f3", "state": 1, "goal": "g1",
  "patterns": ["(x y : ℕ) (h : y = x + 7) : 2 * (x + 7) = 2 * (x + 7)"] }
```

Answer: `[ { "pattern": 0, "names": { "x": "x", "y": "y", "h": "h" } } ]`. A frontend can also match
the goals as text, which is cruder but needs no request.

### `game/close`

Ends the session and frees its state.

## 5. Rules and resources

* **The rules are the frontend's.** The backend is only Lean: it gets a context and a statement and
  plays moves. Which tactics and theorems a level allows, which hints it gives and when it counts as
  solved is up to the frontend, which knows the level anyway (it offers only allowed moves in a click
  input, and checks typed lines before it sends them). For a learning game this is enough: who
  cheats, cheats himself. Where results count (grades, leaderboards), a server can check a finished
  proof once more against the rules; that is a separate, optional service.
* **Sandbox and limits**: moves run Lean code (tactics, `#eval` in a preamble), so they run in a
  sandbox with limits on time per move, memory, and sessions per client. Limits are reported in
  `game/start` (`"limits": { "msPerStep": 5000, … }`) and errors say which one was hit.
* **Warm environments**: the server keeps the bases (`nng4`, `Mathlib`) loaded and forks sessions
  from them; a level's preamble is elaborated once per session.
* **Identification and versions**: a frontend names itself (`"client": "nng-verso/0.3"`) and the
  protocol version it speaks; the server answers with its version. Operators can then see who uses
  what, and frontends learn about changes before they break.

## 6. How to get there

* **From the Lean REPL / Pantograph**: they have the move-oriented interface and environments that
  can be reused; they need the level format, and `game/check` and `game/match` on top. A first
  bridge in front of the REPL, for nng4, is in `repl/` of this repository (nng-verso plays against
  it, text and click input; one REPL process for all players).
* **From lean4game**: the info-tree walk behind `Game.getProofState` is `game/check`; its level
  commands (`Statement`, `Hint`, `NewTactic`) would also write the level format, so that its games
  can be played on any backend; its rules and hint matching could become a small library for
  frontends, or an optional check of finished proofs where results count.
* **For frontends**: nng-verso would replace its LSP client by the four methods above (and drop the
  workaround for line numbers, Appendix A); the IPM could check its proofs and show Lean's own goals.

## 7. Open questions

* Should hints stay patterns of goals, or become small Lean programs (*if the goal has the form …*)?
* How much of a frontend's help (`game/suggest`) belongs in the standard?
* Texts: Markdown, or something richer (Verso documents carry cross-references, math, code)?
* Multiplayer, teachers who follow their students' progress: outside the standard, or a later part?
* Who maintains the standard: lean4game, the Lean FRO, a small group of frontend authors?

## Appendix A: lean4game's protocol today, as nng-verso uses it

* WebSocket to `wss://<server>/websocket/g/<owner>/<game>`; plain LSP JSON-RPC, one message per
  frame. The relay starts one Lean process per connection (in a bubblewrap sandbox); about 1.7 GB of
  memory per player on our own test server.
* `textDocument/didOpen` with the URI `file:///<World>/<Level>.lean` (which tells the relay the
  level) and as text only the player's tactic proof. The relay prepends a header (imports, the
  statement with `:= by`), so all line numbers are shifted; later changes must therefore replace a
  range of the proof (`textDocument/didChange` with a range), not the whole document.
* `$/lean/rpc/connect` gives a session id; `$/lean/rpc/call` with method `Game.getProofState`
  (params: the document, `worldId`, `levelId`) returns `steps` (for each line the goals after it,
  each with its hints, and the diagnostics), `diagnostics` and `completed`.
  `Game.getInteractiveGoals` returns the goals at a position with subterm tags.
  `$/lean/rpc/keepAlive` every 10 seconds keeps the session.
* The level data (texts, inventory, statement) can be downloaded from
  `https://<server>/data/g/<owner>/<game>/level__<World>__<n>.json` and `game.json`; hints are not
  in it.
