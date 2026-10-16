import VersoManual
import Game.Ipm

open Verso.Genre Manual
open Game.Ipm
open Verso.Genre.Manual.InlineLean

/-
Session 1 of the Incredible Proof Machine (https://incredible.pm, Joachim Breitner, MIT license),
with Lean's conventions: `∧` groups to the right, so the Proof Machine's `A∧B∧C` is `(A ∧ B) ∧ C`.
Each task carries a Lean proof, checked when the site is built.
-/

#doc (Manual) "Logic: Conjunction" =>

Proofs as pictures, after the [Incredible Proof Machine](https://incredible.pm) by Joachim
Breitner. What you know (the assumptions) is at the top, what you want to show (the goals) at the
bottom. A proof is a set of lines that lead from the assumptions to the goals.

* A *red circle* is something still to be proved. Tap it: you get a list of what can prove it.
* A *blue dot* is something you have. Tap it: you get a list of where it can be used.
* Tap an entry of the list, and the line is drawn. You are done when no red circle is left.

Two rules help on the way:

* *∧-introduction* (∧I) makes `A ∧ B` from `A` and `B`,
* *∧-elimination* (∧E) takes `A ∧ B` apart into `A` and `B`.

::::task (assumptions := "A") (conclusions := "A")
Tap the red circle on top of the goal `A`, then choose *Use A* (the assumption).

```lean -show
example (A : Prop) (a : A) : A := a
```
::::

::::task (assumptions := "A, B") (conclusions := "A")
Not every assumption has to be used.

```lean -show
example (A B : Prop) (a : A) (_ : B) : A := a
```
::::

::::task (assumptions := "A, B") (conclusions := "B, A")
Two goals.

```lean -show
example (A B : Prop) (a : A) (b : B) : B ∧ A := ⟨b, a⟩
```
::::

::::task (assumptions := "A, B") (conclusions := "A ∧ B")
Your first rule. Tap the red circle of the goal and choose *∧I*: a new block appears that needs
`A` and `B`. Then fill its two red circles.

```lean -show
example (A B : Prop) (a : A) (b : B) : A ∧ B := ⟨a, b⟩
```
::::

::::task (assumptions := "A") (conclusions := "A ∧ A")
An assumption can be used more than once.

```lean -show
example (A : Prop) (a : A) : A ∧ A := ⟨a, a⟩
```
::::

::::task (assumptions := "A ∧ B") (conclusions := "A")
Now take a conjunction apart. Tap the blue dot below `A ∧ B` and choose *∧E*. Then use its output
`A` for the goal.

```lean -show
example (A B : Prop) (h : A ∧ B) : A := h.1
```
::::

::::task (assumptions := "A ∧ B") (conclusions := "A, B")
One ∧-elimination gives both parts.

```lean -show
example (A B : Prop) (h : A ∧ B) : A ∧ B := ⟨h.1, h.2⟩
```
::::

::::task (assumptions := "A ∧ B") (conclusions := "A ∧ B")
The shortest way is the best.

```lean -show
example (A B : Prop) (h : A ∧ B) : A ∧ B := h
```
::::

::::task (assumptions := "A ∧ B") (conclusions := "B ∧ A")
Take apart, then put together again.

```lean -show
example (A B : Prop) (h : A ∧ B) : B ∧ A := ⟨h.2, h.1⟩
```
::::

::::task (assumptions := "(A ∧ B) ∧ C") (conclusions := "A, B, C")
Three goals from one assumption.

```lean -show
example (A B C : Prop) (h : (A ∧ B) ∧ C) : A ∧ B ∧ C := ⟨h.1.1, h.1.2, h.2⟩
```
::::

::::task (assumptions := "(A ∧ B) ∧ C") (conclusions := "A ∧ C")
Pick the parts you need.

```lean -show
example (A B C : Prop) (h : (A ∧ B) ∧ C) : A ∧ C := ⟨h.1.1, h.2⟩
```
::::

::::task (assumptions := "(A ∧ B) ∧ C") (conclusions := "A ∧ B ∧ C")
Regroup. In Lean, `A ∧ B ∧ C` means `A ∧ (B ∧ C)`.

```lean -show
example (A B C : Prop) (h : (A ∧ B) ∧ C) : A ∧ B ∧ C := ⟨h.1.1, h.1.2, h.2⟩
```
::::
