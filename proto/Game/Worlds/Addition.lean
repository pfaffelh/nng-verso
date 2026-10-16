import VersoManual
import Game.MyNat
import Game.Authoring
import Game.Worlds.Tutorial

open Verso.Genre Manual
open Game.Authoring
open MyNat

#doc (Manual) "Addition World" =>

:::world "Addition" (title := "Addition World")
Addition on our natural numbers is defined by two rules, which you can use as theorems:
`add_zero a : a + 0 = a` and `add_succ a b : a + succ b = succ (a + b)`.
:::

# Level 1: Adding zero twice

::::level "Addition" 1 (title := "add_zero") (newTheorems := "MyNat.add_zero MyNat.add_succ")
The theorem `add_zero` rewrites `a + 0` to `a`. A rewrite can use several theorems at once:
`rw [add_zero, add_zero]`.

```statement
/-- For every natural number $a$, we have $a + 0 + 0 = a$. -/
Statement (a : ℕ) : a + 0 + 0 = a := by
  Hint "Rewrite with `add_zero` twice."
  rw [add_zero, add_zero]
```
::::

# Level 2: `zero_add`

::::level "Addition" 2 (title := "zero_add") (newTactics := "induction")
We know $`a + 0 = a`, but what about $`0 + n = n`? Neither rule applies to `0 + n` directly. The
answer is *induction*: prove the statement for `0`, and prove it for `succ d` assuming it holds for
`d`.

```statement
/-- For every natural number $n$, we have $0 + n = n$. -/
Statement zero_add (n : ℕ) : 0 + n = n := by
  Hint "Start with `induction n with d hd`: click on `n`."
  induction n with d hd
  · Hint "This is the case `0`. Which rule applies to `0 + 0`?"
    rw [add_zero]
  · Hint "Use `add_succ` to move `succ` to the outside, then the hypothesis `hd`."
    rw [add_succ, hd]
```

:::conclusion
This was your first proof by induction. You have now proved `zero_add`, a theorem that is *not* one
of the defining rules of addition.
:::
::::

# Level 3: An exercise

::::level "Addition" 3 (title := "Exercise: four rewrites")
An exercise rather than a lesson: you know everything you need, but not every rewrite helps. Plan
first, then click.

```statement
/-- If $a = b$, then $0 + a + succ 0 = succ b$. -/
Statement (a b : ℕ) (h : a = b) : 0 + a + succ 0 = succ b := by
  Hint (hidden := true) "Get rid of `0 +` first."
  rw [zero_add, add_succ, add_zero, h]
```

:::conclusion
Four rewrites, and several of the offered ones lead nowhere.
:::
::::
