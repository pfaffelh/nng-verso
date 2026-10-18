import VersoManual
import Game.MyNat
import Game.Authoring

open Verso.Genre Manual
open Game.Authoring
open MyNat

#doc (Manual) "Tutorial World" =>

:::world "Tutorial" (title := "Tutorial World")
Welcome! In this world you learn the first two tactics. A *tactic* is a command that changes the
goal, the statement you are trying to prove. You win a level when no goal is left.
:::

# Level 1: The `rfl` tactic

::::level "Tutorial" 1 (title := "The rfl tactic") (newTactics := "rfl")
The goal below is an equation whose two sides are exactly the same. The tactic `rfl`
("reflexivity") proves such goals.

```statement
/-- For all natural numbers $x$ and $y$, we have $x + y = x + y$. -/
Statement (x y : ℕ) : x + y = x + y := by
  Hint "Both sides are identical. Click on `rfl`."
  rfl
```

:::conclusion
Well done! `rfl` closes every goal of the form `X = X`.
:::
::::

# Level 2: The `rw` tactic

::::level "Tutorial" 2 (title := "The rw tactic") (newTactics := "rw")
Now the two sides are not identical. But the hypothesis `h` says that `y` and `x` are equal, so we
may replace `y` by `x`. This is what `rw [h]` ("rewrite") does.

```statement
/-- If $y = x$, then $y + y = x + x$. -/
Statement (x y : ℕ) (h : y = x) : y + y = x + x := by
  Hint "Replace `y` by `x` with `rw [h]`."
  rw [h]
```

:::conclusion
`rw` also tries `rfl` at the end, which is why the goal disappeared right away.
:::
::::
