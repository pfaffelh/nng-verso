import Lean

/-!
# Rewrite suggestions for a clicked subterm

The page shows goals as nested subterms; each carries a reference to its expression (an
`InfoWithCtx`, as in Lean's infoview). When the player clicks a subterm, the page asks which of the
available theorems and hypotheses can rewrite *this* subterm, and offers the corresponding tactics.

A rule `lhs = rhs` applies forwards if `lhs` matches the subterm, and backwards (`←`) if `rhs`
does. Matching is done like `rw` does it: same head symbol, and unification with reducible
transparency only, so that e.g. `?a + 0` does not match a plain `b` by unfolding addition.
-/

open Lean Elab Meta Server

namespace Game.Rewrite

structure Params where
  /-- The context of the goal (`ctx` of an interactive goal). -/
  ctx : WithRpcRef ContextInfo
  /-- The goal. -/
  mvarId : MVarId
  /-- The hypothesis containing the clicked subterm (its user name), or none for the goal. -/
  hyp? : Option String := none
  /-- Where the clicked subterm sits in the goal or hypothesis (`subexprPos` of the tag). -/
  pos : SubExpr.Pos
  /-- Names of theorems and hypotheses to try. -/
  candidates : Array String
  deriving RpcEncodable

structure Suggestion where
  /-- The rule, e.g. `add_zero` or `← h`. -/
  rule : String
  /-- The tactic to insert, e.g. `rw [add_zero] at h`. -/
  tactic : String
  /-- The subterm after rewriting, for a preview. -/
  result : String
  deriving FromJson, ToJson

/-- The statement of a hypothesis or theorem named `name`. -/
def statementOf? (name : String) : MetaM (Option Expr) := do
  if let some decl := (← getLCtx).findFromUserName? name.toName then
    return some decl.type
  for (n, fields) in ← resolveGlobalName name.toName do
    if fields.isEmpty then
      if let some info := (← getEnv).find? n then return some info.type
  return none

/-- Whether `pattern` (with metavariables) matches `e` the way `rw` would find it. -/
def rwMatches (pattern e : Expr) : MetaM Bool := do
  if pattern.isMVar then return false
  if pattern.toHeadIndex != e.toHeadIndex || pattern.headNumArgs != e.headNumArgs then return false
  withReducible <| isDefEq pattern e

/-- The rule `name` as a term: a hypothesis or a constant. -/
def ruleTerm (name : String) : MetaM Expr := do
  if let some decl := (← getLCtx).findFromUserName? name.toName then return decl.toExpr
  for (n, fields) in ← resolveGlobalName name.toName do
    if fields.isEmpty then return ← mkConstWithFreshMVarLevels n
  throwError "unknown rule {name}"

/-- An argument as it would be written in a rule, with parentheses if needed. -/
def argText (a : Expr) : MetaM String := do
  let a ← instantiateMVars a
  if a.hasExprMVar then return "_"
  let s := toString (← ppExpr a)
  return if s.contains ' ' then s!"({s})" else s

/--
Ways to rewrite the subterm `e` of `root` with the rule `name`, forwards and backwards. Plain
`rw [name]` rewrites the first instance of the rule's pattern that Lean finds, which need not be
the clicked one; then the rule's explicit arguments are given, e.g. `rw [add_zero (a + 0)]`.
-/
def suggestionsFor (goal : MVarId) (root e : Expr) (name : String) (location : String) :
    MetaM (Array Suggestion) := do
  let some type ← statementOf? name | return #[]
  let mut out := #[]
  for backwards in [false, true] do
    let found ← withNewMCtxDepth do
      let (args, binfos, body) ← forallMetaTelescopeReducing type
      let some (_, lhs, rhs) := body.eq? | return none
      let (src, tgt) := if backwards then (rhs, lhs) else (lhs, rhs)
      unless ← rwMatches src e do return none
      let tgt ← instantiateMVars tgt
      -- The goal as it should look: every occurrence of this instance replaced.
      let expected ← instantiateMVars ((← kabstract root e).instantiate1 tgt)
      -- What plain `rw [name]` does.
      let plain ← observing? do
        let r ← goal.rewrite root (← ruleTerm name) backwards
        instantiateMVars r.eNew
      let exact := plain == some expected
      let explicit ← (args.zip binfos).filterMapM fun (a, bi) =>
        if bi.isExplicit then some <$> argText a else pure none
      let ruleText := if exact || explicit.isEmpty then name else " ".intercalate (name :: explicit.toList)
      return some (ruleText, toString (← ppExpr tgt))
    if let some (ruleText, result) := found then
      let rule := if backwards then s!"← {ruleText}" else ruleText
      out := out.push { rule, tactic := s!"rw [{rule}]{location}", result }
  return out

/--
The subterm at `pos` in `root`. Lean's pretty printer tags a notation such as `a + b` with the
position of its head constant (`HAdd.hAdd`), i.e. the term's own position followed by one `0` per
argument; in that case, return the whole application. Subterms under binders are not returned,
since `rw` cannot rewrite terms mentioning bound variables.
-/
def subtermAt (pos : SubExpr.Pos) (root : Expr) : MetaM (Option Expr) := do
  let arr := pos.toArray
  let trailing := (arr.toList.reverse.takeWhile (· == 0)).length
  for j in (List.range (trailing + 1)).reverse do
    let pre := SubExpr.Pos.ofArray (arr.extract 0 (arr.size - j))
    let x? ← try viewSubexpr (fun fvars e => pure (if fvars.isEmpty then some e else none)) pre root
      catch _ => pure none
    if let some x := x? then
      if x.getAppNumArgs == j then return some x
  return none

/-- Rewrite suggestions for the clicked subterm. -/
@[server_rpc_method]
def _root_.Game.rewriteSuggestions (p : Params) : RequestM (RequestTask (Array Suggestion)) :=
  RequestM.pureTask do
    let ctx := p.ctx.val
    let decl ← ctx.runMetaM {} p.mvarId.getDecl
    ctx.runMetaM decl.lctx do
      let root ← match p.hyp? with
        | none => pure decl.type
        | some h => match decl.lctx.findFromUserName? h.toName with
          | some hdecl => pure hdecl.type
          | none => return #[]
      let root ← instantiateMVars root
      let some e ← subtermAt p.pos root | return #[]
      let location := p.hyp?.map (s!" at {·}") |>.getD ""
      let mut out := #[]
      for name in p.candidates do
        -- A hypothesis cannot be used to rewrite itself.
        if p.hyp? == some name then continue
        out := out ++ (← suggestionsFor p.mvarId root e name location)
      return out

end Game.Rewrite
