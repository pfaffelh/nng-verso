# Prototype: levels written in Verso

A small lean4game game whose levels are written directly in Verso documents. Each document in
`Game/Worlds/` is both

* the **level module** that the lean4game server loads when someone plays, and
* a **chapter of the site**, rendered by Verso.

Verso and the game server must use the same Lean version; both have a tag for v4.31.0.

## Writing a level

````
::::level "Addition" 2 (title := "zero_add") (newTactics := "induction")
Introduction in Verso markup, with math such as $`0 + n = n`.

```statement
/-- For every natural number $n$, we have $0 + n = n$. -/
Statement zero_add (n : ℕ) : 0 + n = n := by
  Hint "Start with `induction n with d hd`: click on `n`."
  induction n with d hd
  · rw [add_zero]
  · rw [add_succ, hd]
```

:::conclusion
Shown after the level is solved.
:::
::::
````

* `:::world "Addition" (title := …)` and `::::level …` run the game server's commands `World`,
  `Level`, `Title`, and afterwards `NewTactic` / `NewTheorem` (`Game/Authoring.lean`).
* The `statement` block is elaborated with Verso's `elabCommands`, so `Statement` with its hints and
  solution is checked when the document is built, with errors at the right place. It is not shown;
  the editor appears in its place.
* `Game.lean` imports the worlds and runs `MakeGame`, which writes `.lake/gamedata`. The site reads
  the available tactics and theorems of each level from there when it is rendered.

## Lesson format

`Game/Worlds/RwLesson.lean` presents the `rw` material as a lesson in small steps on one page, for
comparison with the game format (one level per page in `Tutorial.lean` and `Addition.lean`). A level
with `+step` is shown compactly; the steps of a page are revealed one at a time, each once the
previous one is solved, and solved steps shrink to text, proof and conclusion.

Theorem buttons show the theorem's statement (`a + 0 = a`) instead of its name (`add_zero`); the
name is the tooltip and is what gets inserted.

## Clicking subterms

Goals are shown as nested subterms. Clicking one asks the game server (`Game/Rewrite.lean`, RPC
method `Game.rewriteSuggestions`) which theorems and hypotheses rewrite exactly this subterm, and
offers the tactics, e.g. `rw [add_zero a] → a`. Clicking the same spot again selects the enclosing
subterm. If plain `rw [rule]` would rewrite a different occurrence first, the rule gets its explicit
arguments. Inside an unfinished `·` block the page fetches the goals with
`Game.getInteractiveGoals`, so they can be clicked there too.

## Proof graphs (after the Incredible Proof Machine)

`Game/Worlds/Conjunction.lean` has the 12 tasks of session 1 of the
[Incredible Proof Machine](https://incredible.pm) (Joachim Breitner, MIT license) as proof graphs:
assumptions at the top, goals at the bottom, connected by rule blocks (∧I, ∧E). Lean conventions
apply: `∧` groups to the right, so the Proof Machine's `A∧B∧C` is written `(A ∧ B) ∧ C`.

* `::::task (assumptions := …) (conclusions := …)` (`Game/Ipm.lean`) contains a hidden Lean proof
  of the task, checked when the site is built.
* The editor (`Game/ipm.js`) checks proofs in the browser, without a server: every connection is
  checked by unification in the order the connections were made, so a conflict is blamed on the
  newest connection (☠, tap it for an explanation). Any correct graph is accepted.
* It is operated by tapping, for phones: tap a red circle (something to prove), and the outputs
  that fit glow green; tap one of them or its box to draw the line. It works the other way round,
  too (blue dot first). The rules are listed generically (`∧I  ?1, ?2 ⟹ ?1 ∧ ?2`), always all of
  them, drawn as the very block they add, in a sheet that folds to one line; choosing one only
  adds the block, which the player then
  connects. Undetermined parts are shown as `?1`, `?2` until unification fills them in. The layout
  is automatic. Tasks are revealed one at a time.

## Measuring blind clicking

`MeasureBlindClicking` in `Game.lean` (after `MakeGame`, see `Game/Blind.lean`) simulates a player
who clicks at random among the moves the page offers: every rewrite with an unlocked theorem or an
equation hypothesis at every matching subterm, forwards and backwards, in the goal and in
hypotheses, and `rfl`. For each level it reports how often 200 random runs of at most 10 clicks
solve the level, and the average number of possible clicks per state. A high rate is fine for a
lesson step and too narrow for an exercise. Only `rw` and `rfl` are simulated, so levels needing
`induction` show 0 %.

Current results: all lesson steps and tutorial levels 95–100 %; the exercise (Addition 3) 54 %,
since its rules only simplify, so almost any order works. Rules that can go round in circles or
are useful in both directions (commutativity, associativity) are what makes blind clicking fail.

## Building and playing

```bash
lake build                     # game and site library; writes .lake/gamedata
NNG_RELAY_URL=ws://localhost:8080/websocket/g/local/proto lake exe game-site
cd _out/html-multi && python3 -m http.server 8001
```

and in `../lean4game`: `npm run start:relay` (development mode serves `local/proto` from this
directory).

## Files

```
Game/MyNat.lean          natural numbers, `induction n with d hd`, tactic and theorem docs
Game/Authoring.lean      directives `world`, `level`, `conclusion`, code block `statement`
Game/Worlds/*.lean       the worlds: Verso documents that define the levels
Game.lean                game title, world dependencies, `MakeGame`
Site.lean, SiteMain.lean the site (includes the worlds)
```

The page's browser code (`level.js`, `level.css`) is shared with `../site`.

## Limits of the prototype

* Hints written inside `·` blocks are not shown at the end of an unfinished block, because the
  client then reads the goals from the error message.
* `induction n with d hd` is a simple macro; unlike NNG4's tactic it does not generalize
  hypotheses that mention `n`.
* Levels must be built (`lake build`) before the site is rendered, since the palette comes from the
  game data.
