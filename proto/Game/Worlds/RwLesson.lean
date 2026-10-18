import VersoManual
import Game.MyNat
import Game.Authoring

open Verso.Genre Manual
open Game.Authoring
open MyNat

/-
The same material as the `rw` levels of the game, as a lesson in small steps (compare
`Tutorial.lean` and `Addition.lean`). All steps are on one page; each step is revealed once the
previous one is solved.
-/

#doc (Manual) "Lesson: The rw Tactic" =>

:::world "RwLesson" (title := "Lesson: rw")
Equations let you replace one thing by another. In Lean this is done by the tactic `rw`
("rewrite"). Five short steps.
:::

::::level "RwLesson" 1 (title := "Replace") (newTactics := "rw") +step
The hypothesis `h` says `y = x`. Then `rw [h]` replaces *every* `y` in the goal by `x`.

```statement
Statement (x y : ℕ) (h : y = x) : y + y = x + x := by
  Hint "Click on `rw`, then on `h`."
  rw [h]
```

:::conclusion
Both `y` were replaced at once. Then the two sides were equal, and `rw` finished the proof by
itself.
:::
::::

::::level "RwLesson" 2 (title := "Theorems are equations") (newTheorems := "MyNat.add_zero") +step
Theorems can be used in the same way. The theorem `add_zero` says $`a + 0 = a` for every `a`.

```statement
Statement (a : ℕ) : a + 0 = a := by
  Hint "Click on `add_zero`."
  rw [add_zero]
```

:::conclusion
`rw [add_zero]` found `a + 0` in the goal and replaced it by `a`.
:::
::::

::::level "RwLesson" 3 (title := "Choose the place") +step
Instead of choosing a rule, you can choose the place: click on a term in the goal, and you see the
rules that can rewrite exactly this term.

```statement
Statement (a b : ℕ) : a + (b + 0) = a + b := by
  Hint "Click on `b + 0` in the goal on the right (on the `+` between `b` and `0`)."
  rw [add_zero]
```

:::conclusion
Clicking the same place again selects the next larger term.
:::
::::

::::level "RwLesson" 4 (title := "The other direction") +step
`rw [h]` always replaces the left side of `h` by its right side. For the other direction, write
`rw [← h]`. Here there is no `x` in the goal, so `rw [h₁]` cannot work.

```statement
Statement (x y z : ℕ) (h₁ : x = y) (h₂ : x = z) : y = z := by
  Hint "Replace `y` by `x` with `rw [← h₁]`: click on `y`."
  rw [← h₁]
  Hint "Now replace `x` by `z`."
  rw [h₂]
```

:::conclusion
Two rewrites: first backwards with `h₁`, then forwards with `h₂`.
:::
::::

::::level "RwLesson" 5 (title := "Rewrite a hypothesis") +step
`rw` can also change a hypothesis: `rw [add_zero] at h` rewrites in `h` instead of the goal.

```statement
Statement (a b : ℕ) (h : a + 0 = b) : a = b := by
  Hint "Click on `a + 0` in the hypothesis `h`."
  rw [add_zero] at h
  Hint "Now `h` says exactly what you need."
  rw [h]
```

:::conclusion
That is all you need to know about `rw` for now. Its direction (`←`), the place (click), and
the location (`at h`).
:::
::::
