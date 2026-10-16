import VersoManual
import GameServer

/-!
# Writing lean4game levels in Verso

A level is written in a Verso document; the same module is the level module that the game server
loads. The directives below run the game server's commands (`World`, `Level`, `Statement`, …) in
the document's environment and render the page:

````
::::level "Addition" 1 (title := "zero_add") (newTactics := "induction")
Introduction, in Verso markup.

```statement
Statement zero_add (n : ℕ) : 0 + n = n := by
  Hint "Start with `induction n with d hd`."
  induction n with d hd
  · rw [add_zero]
  · rw [add_succ, hd]
```

:::conclusion
Shown after the level is solved.
:::
::::
````

The `statement` block is elaborated but not shown; the editor appears in its place. The palette of
available tactics and theorems is read from the game data (`.lake/gamedata`) when the site is
rendered, since it is only known after `MakeGame` has seen all levels.
-/

open Lean Elab
open Verso Doc Elab ArgParse
open Verso.Genre Manual
open Verso.Output (Html)

namespace Game.Authoring

/-! ## Running game server commands from a document -/

/-- Elaborates commands in the document's environment and keeps their effect. -/
def runCommands (cmds : Array Command) : DocElabM Unit := do
  let cctx : Command.Context :=
    { fileName := ← getFileName, fileMap := ← getFileMap, snap? := none, cancelTk? := none }
  let mut st : Command.State :=
    { env := ← getEnv, maxRecDepth := ← MonadRecDepth.getMaxRecDepth, scopes := ← InlineLean.Scopes.getScopes }
  for cmd in cmds do
    match ← liftM <| EIO.toIO' <| ((Command.elabCommand cmd).run cctx).run st with
    | .error e => logError e.toMessageData
    | .ok ((), st') => st := st'
  for msg in st.messages.toList do logMessage msg
  setEnv st.env
  InlineLean.Scopes.setScopes st.scopes

def words (s : String) : Array Ident :=
  (s.splitOn " ").filter (· ≠ "") |>.toArray.map (mkIdent ·.toName)

/-! ## Blocks of the rendered page -/

def gameDataDir : System.FilePath := ".lake" / "gamedata"

def levelJs : String := include_str "../../site/NNGSite/level.js"
def levelCss : String := include_str "../../site/NNGSite/level.css"

/-- The level's data written by `MakeGame`, read when the page is rendered. -/
def readLevelData (world : String) (level : Nat) : IO Json := do
  let path := gameDataDir / s!"level__{world}__{level}.json"
  unless ← path.pathExists do
    throw <| IO.userError s!"{path} not found: build the game (`lake build Game`) before rendering"
  IO.ofExcept <| Json.parse (← IO.FS.readFile path)

-- Wrapper of a level, carrying world and level number for `level.js`. A `step` is a small level
-- inside a lesson: shown compactly, and revealed once the previous step is solved.
block_extension Block.level (world : String) (level : Nat) (step : Bool) where
  data := Json.mkObj [("world", world), ("level", level), ("step", step)]
  traverse _ _ _ := pure none
  extraJs := {JS.mk levelJs}
  extraCss := {CSS.mk levelCss}
  toHtml := some fun _ goB _ data content => do
    let world := (data.getObjValAs? String "world").toOption.getD ""
    let level := (data.getObjValAs? Nat "level").toOption.getD 0
    let step := (data.getObjValAs? Bool "step").toOption.getD false
    let relay := (← IO.getEnv "NNG_RELAY_URL").map (fun url => #[("data-relay", url)]) |>.getD #[]
    let cls := if step then "nng-level nng-step" else "nng-level"
    pure <| .tag "div" (#[("class", cls), ("data-world", world), ("data-level", toString level),
        ("data-lang", "en")] ++ relay) (← content.mapM goB)
  toTeX := none

/-- An inventory entry of the level data. -/
structure Item where
  name : String
  displayName : String
  locked : Bool
  hidden : Bool
  disabled : Bool
  altTitle : String := ""
deriving FromJson

-- The statement, the palette of available tactics and theorems, the editor and the feedback area.
block_extension Block.play (world : String) (level : Nat) where
  data := Json.mkObj [("world", world), ("level", level)]
  traverse _ _ _ := pure none
  toHtml := some fun _ _ _ data _ => do
    let world := (data.getObjValAs? String "world").toOption.getD ""
    let level := (data.getObjValAs? Nat "level").toOption.getD 0
    let info ← readLevelData world level
    let items (key : String) : Array Item :=
      ((info.getObjValAs? (Array Item) key).toOption.getD #[]).filter
        fun i => !i.locked && !i.hidden && !i.disabled
    let descr := (info.getObjValAs? String "descrFormat").toOption.getD ""
    let statement := ":=".intercalate (descr.splitOn ":=").dropLast |>.trimRight
    let div (cls : String) (inner : Html := .empty) : Html := .tag "div" #[("class", cls)] inner
    let button (cls name : String) (type : String := "") : Html :=
      .tag "button" (#[("type", "button"), ("class", s!"nng-insert {cls}"), ("data-insert", name),
        ("title", if type.isEmpty then "Click to insert" else s!"{name}{type}")] ++
        (if type.isEmpty then #[] else #[("data-type", type)])) (.text true name)
    let group (label : String) (buttons : Array Html) : Html :=
      if buttons.isEmpty then .empty
      else div "nng-palette-group" <| .seq <|
        #[.tag "span" #[("class", "nng-palette-label")] (.text true label)] ++ buttons
    pure <| .seq #[
      .tag "pre" #[("class", "nng-statement")] (.text true statement),
      div "nng-palette" <| .seq #[
        group "Tactics" ((items "tactics").map (button "nng-tactic" ·.displayName)),
        group "Theorems" ((items "lemmas").map fun i => button "nng-lemma" i.displayName i.altTitle),
        group "Symbols" (#["←", "·", "at"].map (button "nng-symbol") ++ #[
          .tag "button" #[("type", "button"), ("class", "nng-newline")] (.text true "⏎ New line"),
          .tag "button" #[("type", "button"), ("class", "nng-undo")] (.text true "↶ Undo")])
      ],
      div "nng-play" <| .seq #[
        div "nng-editor-col" <| .seq #[
          .tag "textarea" #[("class", "nng-editor"), ("spellcheck", "false"),
            ("placeholder", "Type tactics here, one per line …")] .empty,
          div "nng-status"],
        div "nng-feedback-col" <| .seq #[div "nng-goals", div "nng-hints", div "nng-messages"]
      ]
    ]
  toTeX := none

-- Text shown only after the level has been solved.
block_extension Block.conclusion where
  traverse _ _ _ := pure none
  toHtml := some fun _ goB _ _ content => do
    pure <| .tag "div" #[("class", "nng-conclusion"), ("hidden", "")] (← content.mapM goB)
  toTeX := none

/-! ## Directives -/

structure WorldConfig where
  world : String
  title : String

instance : FromArgs WorldConfig DocElabM where
  fromArgs := WorldConfig.mk <$> .positional `world .string <*> .named `title .string false

/-- Starts a world: `:::world "Addition" (title := "Addition World")` with its introduction. -/
@[directive]
def world : DirectiveExpanderOf WorldConfig
  | cfg, contents => do
    runCommands #[← `(command| World $(quote cfg.world)), ← `(command| Title $(quote cfg.title))]
    let blocks ← contents.mapM elabBlock
    ``(Verso.Doc.Block.concat #[$blocks,*])

structure LevelConfig where
  world : String
  level : Nat
  title : String
  newTactics : String
  newTheorems : String
  /-- A small step of a lesson (see `Block.level`). -/
  step : Bool

instance : FromArgs LevelConfig DocElabM where
  fromArgs := LevelConfig.mk <$> .positional `world .string <*> .positional `level .nat <*>
    .named `title .string false <*> .namedD `newTactics .string "" <*> .namedD `newTheorems .string "" <*>
    .flag `step false

/-- A level; see the module documentation. -/
@[directive]
def level : DirectiveExpanderOf LevelConfig
  | cfg, contents => do
    runCommands #[
      ← `(command| World $(quote cfg.world)),
      ← `(command| Level $(Syntax.mkNumLit (toString cfg.level))),
      ← `(command| Title $(quote cfg.title))]
    -- The `statement` block inside runs `Statement` for this level.
    let blocks ← contents.mapM elabBlock
    let tactics := words cfg.newTactics
    let theorems := words cfg.newTheorems
    let mut inventory : Array Command := #[]
    unless tactics.isEmpty do inventory := inventory.push (← `(command| NewTactic $tactics*))
    unless theorems.isEmpty do inventory := inventory.push (← `(command| NewTheorem $theorems*))
    runCommands inventory
    ``(Verso.Doc.Block.other (Block.level $(quote cfg.world) $(quote cfg.level) $(quote cfg.step)) #[$blocks,*])

/-- The statement of the current level with hints and solution, in the game server's syntax. It is
elaborated but not shown; the editor appears in its place. -/
@[code_block]
def statement : CodeBlockExpanderOf Unit
  | (), str => do
    let config : InlineLean.LeanBlockConfig :=
      { «show» := false, keep := true, name := none, error := false, fresh := false }
    discard <| InlineLean.elabCommands config str (fun _ _ _ => ``(Verso.Doc.Block.concat #[]))
    let world ← GameServer.getCurWorldId
    let level ← GameServer.getCurLevelIdx
    ``(Verso.Doc.Block.other (Block.play $(quote world.toString) $(quote level)) #[])

/-- Text shown after the level is solved. -/
@[directive]
def conclusion : DirectiveExpanderOf Unit
  | (), contents => do
    let blocks ← contents.mapM elabBlock
    ``(Verso.Doc.Block.other Block.conclusion #[$blocks,*])

end Game.Authoring
