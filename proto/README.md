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
