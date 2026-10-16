import VersoManual

/-!
# Proof graph tasks

`::::task (assumptions := "A, B") (conclusions := "A ∧ B")` embeds a task for the tap-based proof
graph editor `ipm.js`, in the style of the Incredible Proof Machine. The task is checked in the
browser, without a server. A Lean proof of the task belongs inside the directive, in a hidden
`lean` block, so that building the site checks that the task is provable:

````
::::task (assumptions := "A ∧ B") (conclusions := "B ∧ A")
Swap the two parts.

```lean -show
example (A B : Prop) (h : A ∧ B) : B ∧ A := ⟨h.2, h.1⟩
```
::::
````
-/

open Lean Elab
open Verso Doc Elab ArgParse
open Verso.Genre Manual
open Verso.Output (Html)

namespace Game.Ipm

def ipmJs : String := include_str "ipm.js"
def ipmCss : String := include_str "ipm.css"

def items (s : String) : Array String :=
  (s.splitOn ",").toArray.map (·.trim) |>.filter (· ≠ "")

-- A task: assumptions, conclusions and the rules available, for `ipm.js`.
block_extension Block.task (assumptions conclusions rules : Array String) where
  data := Json.mkObj [("assumptions", toJson assumptions), ("conclusions", toJson conclusions),
    ("rules", toJson rules)]
  traverse _ _ _ := pure none
  extraJs := {JS.mk ipmJs}
  extraCss := {CSS.mk ipmCss}
  toHtml := some fun _ goB _ data content => do
    let get (k : String) := (data.getObjVal? k).toOption.getD (Json.arr #[])
    pure <| .tag "div" #[("class", "ipm-task"), ("data-assumptions", (get "assumptions").compress),
        ("data-conclusions", (get "conclusions").compress), ("data-rules", (get "rules").compress)] <|
      .seq #[← content.mapM goB, .tag "div" #[("class", "ipm-board")] .empty]
  toTeX := none

structure TaskConfig where
  assumptions : String
  conclusions : String
  rules : String

instance : FromArgs TaskConfig DocElabM where
  fromArgs := TaskConfig.mk <$> .namedD `assumptions .string "" <*> .named `conclusions .string false <*>
    .namedD `rules .string "conjI, conjE"

/-- A proof graph task; see the module documentation. -/
@[directive]
def task : DirectiveExpanderOf TaskConfig
  | cfg, contents => do
    let blocks ← contents.mapM elabBlock
    ``(Verso.Doc.Block.other
        (Block.task $(quote (items cfg.assumptions)) $(quote (items cfg.conclusions)) $(quote (items cfg.rules)))
        #[$blocks,*])

end Game.Ipm
