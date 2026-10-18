import GameServer
import Game.Rewrite

/-!
# Natural numbers for the prototype game

A minimal version of the natural numbers of the Natural Number Game, without Mathlib.
-/

/-- The natural numbers, built from `0` and `succ`. -/
inductive MyNat where
  | zero : MyNat
  | succ : MyNat → MyNat

@[inherit_doc] notation "ℕ" => MyNat

namespace MyNat

instance : OfNat MyNat 0 := ⟨zero⟩

/-- Induction with `0` instead of `MyNat.zero` in the goals. -/
@[elab_as_elim, induction_eliminator]
def rec' {motive : ℕ → Sort u} (zero : motive 0) (succ : (n : ℕ) → motive n → motive (succ n)) :
    (t : ℕ) → motive t
  | .zero => zero
  | .succ n => succ n (rec' zero succ n)

/-- Addition, by recursion on the second argument. -/
def add : ℕ → ℕ → ℕ
  | a, .zero => a
  | a, .succ b => succ (add a b)

instance : Add ℕ := ⟨add⟩

theorem add_zero (a : ℕ) : a + 0 = a := rfl

theorem add_succ (a b : ℕ) : a + succ b = succ (a + b) := rfl

end MyNat

/-- `induction n with d hd`, as in the Natural Number Game: the cases `0` and `succ d`, where
`hd` is the statement for `d`. -/
macro "induction " n:ident " with " d:ident hd:ident : tactic =>
  `(tactic| (refine MyNat.rec' ?zero (fun $d:ident $hd:ident => ?succ) $n:ident <;> try clear $n:ident))

/-! ## Documentation shown in the game -/

/-- `rfl` proves goals of the form `X = X`. -/
TacticDoc rfl

/-- `rw [h]` replaces `X` by `Y` in the goal if `h : X = Y`. `rw [← h]` replaces `Y` by `X`. -/
TacticDoc rw

/-- `induction n with d hd` proves a statement about `n` by proving it for `0` and, assuming it
for `d` (hypothesis `hd`), for `succ d`. -/
TacticDoc induction

/-- `add_zero a` is a proof of `a + 0 = a`. -/
TheoremDoc MyNat.add_zero as "add_zero" in "+"

/-- `add_succ a b` is a proof of `a + succ b = succ (a + b)`. -/
TheoremDoc MyNat.add_succ as "add_succ" in "+"
