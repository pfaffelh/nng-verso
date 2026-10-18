# The Natural Number Game as a click game

Thoughts, nothing implemented yet. The question is whether NNG can be played by tapping, the way
the [Incredible Proof Machine remake](https://github.com/pfaffelh/ipm) is played in its Lean tactic
mode, while the game server (Lean) stays at the HHU in Düsseldorf.

## What the IPM does, and what carries over

In the IPM's Lean tactic mode one never types. A tapped goal or hypothesis offers the tactics that fit
it (`intro h₃`, `constructor`, `obtain ⟨h₂, h₃⟩ := h₁`, `rw [h]`, …), named as in Lean, and one tap
applies a tactic. The proof is a tactic script that one has *played*; below the board it is shown as
Lean code. A level offers only the tactics it has unlocked, and a tactic's tip appears the first time
its button is offered. Goals with different hypotheses get boards of their own, as tabs.

The IPM checks the proofs in the browser, because propositional and first-order natural deduction is
simple enough. NNG cannot do that. It is mostly equational reasoning (`rw`, `rfl`, `induction`,
`simp`-like steps later), and only Lean can say whether a step works. So **Lean must check every tap**:

* Each tap is one change of the document plus `Game.getProofState`: a round trip to the HHU, roughly
  0.3–1 s. That is fine for a step. It is too slow for trying many candidate buttons in the
  background just to decide which ones to show.
* So the client has to *guess* which buttons fit, from the goal it has (the pretty-printed goal and
  its `TaggedText` with subterm positions), and Lean then decides. A wrong guess costs one round trip
  and is undone (with an explanation, as the IPM's ☠ does).
* The server stays the referee: tactics that are not unlocked are rejected there anyway, and its
  hints arrive with each step, as now.

## What already exists in `site/NNGSite/level.js`

* The palette: a tapped tactic inserts a template (`rw [|]`, `induction | with d hd`), a tapped
  theorem or hypothesis goes where a name is expected, or becomes `rw [h]`, `apply h` or `exact h` on
  a new line.
* Goals are rendered from `TaggedText`, and each subterm is a span with its `subexprPos`, so it can be
  clicked.
* `·` lines come by themselves when a tactic splits the goal, Undo reverts any change, and errors are
  explained in plain words.

So the editor is already halfway to a click game. What is missing is the step from "insert a
template, then type" to "one tap is one finished step".

## Three stages

### 1. Tactic buttons by the shape of the goal

Tap the goal: buttons for what fits, as in the IPM.

| Goal or hypothesis | Buttons |
|---|---|
| `a = a` (both sides print the same) | `rfl` |
| a natural number `n` in the goal | `induction n with d hd` |
| `P → Q`, `∀ x, …` | `intro h` |
| hypothesis `h : a = b`, and `a` occurs in the goal | `rw [h]` (and `rw [← h]` if `b` occurs) |
| an unlocked theorem whose left side's head occurs in the goal | `rw [add_zero]`, … |
| `h : a = b` and the goal is `a = b` | `exact h` |

The left sides of the theorems come from the game data (the inventory has their statements), so the
client can match the head symbol (`_ + 0`, `succ _`, `_ * _`) against the subterms of the goal without
asking Lean. That is a rough filter, and Lean has the last word.

### 2. Tap a subterm to rewrite it

Tap `a + 0` in the goal: the theorems and hypotheses whose left side matches it are offered, and a tap
rewrites *that* occurrence. The occurrence is known from `subexprPos`. If it is not the first one, the
step is `nth_rewrite k [add_zero]` (if NNG unlocks it) or `rw [add_zero]` with a warning that the first
occurrence will be rewritten. This is the step that makes rewriting feel like algebra on paper. It is
also the most work, because counting occurrences the way `rw` counts them has to match Lean.

### 3. The proof as a chain

The goal states between the steps are already shown. For equational levels they can be drawn as a
chain:

```
a + succ b
  = succ (a + b)     rw [add_succ]
  = succ (b + a)     rw [ih]
  = …
```

Each line is one tap, and the line is what was rewritten (the IPM highlights changes the same way).
The script stays a list of `rw`. A `calc` block is not needed, and NNG may not allow it anyway.
`induction` splits the chain in two, like the IPM's boards: one tab for the base case, one for the
successor case.

## Two modes, as in the IPM

The text editor should stay, as a second mode. Both modes edit the same proof, and one can switch in
the middle of a level. A tapped step writes exactly the Lean line one would have typed, so the editor
shows the played script. This is how the IPM's two modes work, and it keeps the point of NNG: one
learns Lean, not a different game.

## Constraints

* **The HHU server stays unchanged.** Everything above is client-side; only the protocol it already
  has (`didOpen`, range edits, `Game.getProofState`) is used.
* **Politeness:** no speculative requests to test candidate buttons, only the step the player chose.
  At most one request in flight per tap, as now.
* **Latency:** a button shows "…" while Lean checks. Undo is local and immediate (the previous proof
  state is kept).
* **Offline:** without the server nothing can be checked. The buttons can still be shown, but not
  applied.

## Open questions

* Can one relay session hold more than one document (for checking a guess without touching the
  player's proof)? If yes, a "dry run" of a button becomes possible, but see politeness.
* Which NNG tactics are unlocked per level, and does the inventory say enough about theorem statements
  to match left sides (or does the client need to parse the Lean statement)?
* `nth_rewrite` vs. `rw` at an occurrence: what NNG allows, and whether occurrence counting can be done
  reliably in the client.
* Mobile: goals with long terms need wrapping that keeps subterms tappable.

## A first prototype

Stage 1 only, on the Addition world: buttons on the goal (`rfl`, `induction`, `rw [h]`, `rw [thm]`
for unlocked theorems whose head matches), each one appending a finished line. The existing goal
rendering, hints and error explanations are reused, and the editor stays visible as the text mode.
If tapping through `add_comm` feels good, stage 2 follows.
