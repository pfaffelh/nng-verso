import GameServer

/-!
# Can a level be solved by blind clicking?

`MeasureBlindClicking` (after `MakeGame`) simulates a player who clicks at random. In each state the
possible clicks are the rewrites that the page offers (`Game.Rewrite`): every rule at every subterm
it matches, forwards and backwards, in the goal and in hypotheses, with the rules being the
theorems unlocked in the level and the equations among the hypotheses; and `rfl` if it closes the
goal. As with `rw`, a rewrite is followed by an attempt to close the goal with `rfl`.

For each level the command reports how often random clicking solves it within a few clicks, and
how many clicks are possible per state. A high rate means the level does not require thinking
when played by clicking — fine for a lesson step, too narrow for an exercise. Tactics other than
`rw` and `rfl` (such as `induction`) are not simulated; levels needing them show 0 %.
-/

open Lean Elab Meta Command

namespace Game.Blind

/-- A possible click: a function producing the next goal, or `none` if the proof is finished. -/
abbrev Move := MetaM (Option MVarId)

/-- All subterms of `e` outside binders. -/
partial def subterms (e : Expr) (acc : Array Expr := #[]) : Array Expr :=
  let acc := acc.push e
  match e with
  | .app f a => subterms a (subterms f acc)
  | .mdata _ b => subterms b acc
  | _ => acc

/-- Closes `g` with `rfl` (reducible, as `rw` does) if possible. -/
def tryRfl (g : MVarId) : MetaM Bool := do
  let s ← saveState
  try withReducible g.refl; return true
  catch _ => s.restore; return false

/-- The rewrites of `type` (the goal or a hypothesis) with the rule `proof : ∀ xs, lhs = rhs`,
one for every subterm matched by `lhs` (or `rhs` backwards), as `rw [rule args]` would do it. -/
def rewritesOf (g : MVarId) (type : Expr) (proof : Expr) : MetaM (Array (Expr × Bool)) := do
  let ruleType ← inferType proof
  let mut out := #[]
  for e in subterms (← instantiateMVars type) do
    if e.hasLooseBVars then continue
    for symm in [false, true] do
      let found ← withNewMCtxDepth do
        let (args, _, body) ← forallMetaTelescopeReducing ruleType
        let some (_, lhs, rhs) := body.eq? | return none
        let src := if symm then rhs else lhs
        if src.isMVar || src.toHeadIndex != e.toHeadIndex || src.headNumArgs != e.headNumArgs then
          return none
        unless ← withReducible (isDefEq src e) do return none
        let heq ← instantiateMVars (mkAppN proof args)
        if heq.hasExprMVar then return none
        return some heq
      if let some heq := found then out := out.push (heq, symm)
  let _ := g
  return out

/-- All clicks possible in goal `g` with the theorems `rules`. -/
def moves (g : MVarId) (rules : Array Name) : MetaM (Array Move) := g.withContext do
  let mut proofs : Array Expr := #[]
  for r in rules do proofs := proofs.push (← mkConstWithFreshMVarLevels r)
  let hyps := (← getLCtx).getFVars
  for h in hyps do
    if (← instantiateMVars (← inferType h)).isEq then proofs := proofs.push h
  let mut out : Array Move := #[]
  -- `rfl`
  if ← (do let s ← saveState; let ok ← tryRfl g; s.restore; pure ok) then
    out := out.push (do discard <| tryRfl g; return none)
  -- rewriting the goal
  let target ← g.getType
  for p in proofs do
    for (heq, symm) in ← rewritesOf g target p do
      out := out.push do
        let r ← g.rewrite target heq symm
        let g' ← g.replaceTargetEq r.eNew r.eqProof
        if ← tryRfl g' then return none else return some g'
  -- rewriting a hypothesis
  for h in hyps do
    let htype ← instantiateMVars (← inferType h)
    for p in proofs do
      if p == h then continue
      for (heq, symm) in ← rewritesOf g htype p do
        out := out.push do
          let r ← g.rewrite htype heq symm
          let res ← g.replaceLocalDecl h.fvarId! r.eNew r.eqProof
          let g' := res.mvarId
          if ← tryRfl g' then return none else return some g'
  return out

structure Result where
  /-- Fraction of random runs that solved the level. -/
  rate : Float
  /-- Average number of possible clicks per state. -/
  branching : Float

/-- Random clicking from goal `g`: `runs` runs of at most `depth` clicks. -/
def measure (g : MVarId) (rules : Array Name) (runs depth : Nat) : MetaM Result := do
  let mut solved := 0
  let mut choices := 0
  let mut states := 0
  for _ in [0:runs] do
    let s ← saveState
    let mut cur := g
    let mut done := false
    for _ in [0:depth] do
      let ms ← moves cur rules
      states := states + 1
      choices := choices + ms.size
      if ms.isEmpty then break
      let i ← IO.rand 0 (ms.size - 1)
      let next ← try ms[i]! catch _ => pure (some cur)
      match next with
      | none => done := true; break
      | some g' => cur := g'
    if done then solved := solved + 1
    s.restore
  return { rate := solved.toFloat / runs.toFloat,
           branching := if states == 0 then 0 else choices.toFloat / states.toFloat }

/-- The theorems unlocked in a level, from the game data written by `MakeGame`. -/
def unlockedTheorems (world : Name) (level : Nat) : IO (Array Name) := do
  let path : System.FilePath := ".lake" / "gamedata" / s!"level__{world}__{level}.json"
  let json ← IO.ofExcept <| Json.parse (← IO.FS.readFile path)
  let items := (json.getObjValAs? (Array Json) "lemmas").toOption.getD #[]
  return items.filterMap fun i =>
    if (i.getObjValAs? Bool "locked").toOption == some false then
      (i.getObjValAs? String "name").toOption.map (·.toName)
    else none

def percent (x : Float) : String := s!"{(x * 100).round.toUInt64}%"

def fmt1 (x : Float) : String := s!"{(x * 10).round.toUInt64 / 10}.{(x * 10).round.toUInt64 % 10}"

/-- Reports for every level how often blind clicking solves it (200 runs of at most 10 clicks). -/
elab "MeasureBlindClicking" : command => do
  let game ← GameServer.getCurGame
  let mut report := #[]
  for (worldId, world) in game.worlds.nodes.toArray.qsort (·.1.toString < ·.1.toString) do
    for (idx, level) in world.levels.toArray.qsort (·.1 < ·.1) do
      let rules ← unlockedTheorems worldId idx
      let sig := level.goal.raw
      let binders := sig[0].getArgs
      let typeStx := sig[1][1]
      let result ← withScope (fun _ => level.scope) <| liftTermElabM do
        Term.elabBinders binders fun _ => do
          let type ← Term.elabType typeStx
          Term.synthesizeSyntheticMVarsNoPostponing
          let g := (← mkFreshExprMVar type).mvarId!
          measure g rules (runs := 200) (depth := 10)
      let line := s!"{worldId} {idx} ({level.title}): blind clicking solves {percent result.rate} \
        of 200 runs within 10 clicks; {fmt1 result.branching} possible clicks per state"
      report := report.push line
  logInfo m!"{"\n".intercalate report.toList}"

end Game.Blind
