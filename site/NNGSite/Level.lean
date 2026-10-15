import VersoManual
import NNGSite.I18n

/-!
# Playable lean4game levels in Verso

The directive `:::level "World" n` embeds level `n` of world `World` of a lean4game game. At build
time it reads the level data that `MakeGame` wrote to `.lake/gamedata` of the game, converts the
Markdown texts (introduction, statement description, documentation of new tactics, conclusion) to
Verso blocks and adds an editor. In the browser, `level.js` connects the editor to the lean4game
relay, which runs the game's Lean server.
-/

open Lean Elab
open Verso Doc Elab ArgParse
open Verso.Genre Manual
open Verso.Output (Html)

namespace NNGSite

/-- Where `MakeGame` stored the game data, relative to the site project. -/
def gameDataDir : System.FilePath := ".." / "nng4" / ".lake" / "gamedata"

def levelJs : String := include_str "level.js"
def levelCss : String := include_str "level.css"
/-- Translations for the hints, which the server sends in English. -/
def hintCatalogue : String := include_str "../../nng4/.i18n/de/Game.json"

/-- The page links of worlds (key `World`) and levels (key `World:n`), collected during traversal. -/
def pageLinksKey : Name := `NNGSite.pageLinks

def pageLinks (state : TraverseState) : Json :=
  match state.get? (α := Json) pageLinksKey with
  | some (.ok j) => j
  | _ => Json.mkObj []

/-- Records the page that contains the current block under `key`. -/
def registerPage (key : String) : ReaderT TraverseContext (StateT TraverseState (BuildLogT IO)) Unit := do
  let link := (← read).path.link
  let links := pageLinks (← get)
  if (links.getObjValAs? String key).toOption != some link then
    modify (·.set `NNGSite.pageLinks (links.setObjVal! key link))

-- Wrapper of a level. Carries the world and level number for `level.js`.
block_extension Block.nngLevel (world : String) (level : Nat) where
  data := Json.mkObj [("world", world), ("level", level)]
  traverse _ data _ := do
    let world := (data.getObjValAs? String "world").toOption.getD ""
    let level := (data.getObjValAs? Nat "level").toOption.getD 0
    registerPage s!"{world}:{level}"
    pure none
  extraJs := {JS.mk levelJs}
  extraCss := {CSS.mk levelCss}
  extraDataFiles :=
    if language == "en" then {} else {{ filename := "nng-i18n.json", contents := hintCatalogue.toUTF8 }}
  toHtml := some fun _ goB _ data content => do
    let world := (data.getObjValAs? String "world").toOption.getD ""
    let level := (data.getObjValAs? Nat "level").toOption.getD 0
    -- The relay's WebSocket URL is read when rendering, e.g.
    -- `NNG_RELAY_URL=/websocket/g/verso/nng4 lake exe nng-site`; a path means the page's own host.
    let relay := (← IO.getEnv "NNG_RELAY_URL").map (fun url => #[("data-relay", url)]) |>.getD #[]
    pure <| .tag "div" (#[("class", "nng-level"), ("data-world", world), ("data-level", toString level),
        ("data-lang", language)] ++ relay)
      (← content.mapM goB)
  toTeX := none

-- The statement, a palette of the available tactics and theorems, the editor and the feedback area.
block_extension Block.nngPlay (statement : String) (tactics lemmas lemmaTypes : Array String) where
  data := Json.mkObj [("statement", statement), ("tactics", toJson tactics), ("lemmas", toJson lemmas),
    ("lemmaTypes", toJson lemmaTypes)]
  traverse _ _ _ := pure none
  toHtml := some fun _ _ _ data _ => do
    let statement := (data.getObjValAs? String "statement").toOption.getD ""
    let tactics := (data.getObjValAs? (Array String) "tactics").toOption.getD #[]
    let lemmas := (data.getObjValAs? (Array String) "lemmas").toOption.getD #[]
    let lemmaTypes := (data.getObjValAs? (Array String) "lemmaTypes").toOption.getD #[]
    let div (cls : String) (inner : Html := .empty) : Html := .tag "div" #[("class", cls)] inner
    -- `type` is the statement of a theorem; it decides between `rw`, `apply` and `exact`.
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
        group "Tactics" (tactics.map (button "nng-tactic")),
        group "Theorems" ((lemmas.zip lemmaTypes).map fun (n, t) => button "nng-lemma" n t),
        group "Symbols" (#["←", "·", "at"].map (button "nng-symbol") ++ #[
          .tag "button" #[("type", "button"), ("class", "nng-newline"),
            ("title", "New line with the same indentation")] (.text true "⏎ New line"),
          .tag "button" #[("type", "button"), ("class", "nng-undo"), ("title", "Undo the last change")]
            (.text true "↶ Undo")])
      ],
      div "nng-play" <| .seq #[
        div "nng-editor-col" <| .seq #[
          .tag "textarea" #[("class", "nng-editor"), ("spellcheck", "false"),
            ("placeholder", "Type tactics here, one per line …")] .empty,
          div "nng-status"
        ],
        div "nng-feedback-col" <| .seq #[
          div "nng-goals", div "nng-hints", div "nng-messages"
        ]
      ]
    ]
  toTeX := none

-- Text shown only after the level has been solved.
block_extension Block.nngConclusion where
  traverse _ _ _ := pure none
  toHtml := some fun _ goB _ _ content => do
    pure <| .tag "div" #[("class", "nng-conclusion"), ("hidden", "")] (← content.mapM goB)
  toTeX := none

-- The introduction of a world; records the world's page for the world map.
block_extension Block.nngWorld (world : String) where
  data := Json.str world
  traverse _ data _ := do
    registerPage (data.getStr?.toOption.getD "")
    pure none
  toHtml := some fun _ goB _ _ content => content.mapM goB
  toTeX := none

-- A collapsible section.
block_extension Block.nngDetails (summary : String) where
  data := Json.str summary
  traverse _ _ _ := pure none
  toHtml := some fun _ goB _ data content => do
    let summary := data.getStr?.toOption.getD ""
    pure <| .tag "details" #[] <| .seq #[.tag "summary" #[] (.text true summary), ← content.mapM goB]
  toTeX := none

structure LevelConfig where
  world : String
  level : Nat

instance : FromArgs LevelConfig DocElabM where
  fromArgs := LevelConfig.mk <$> .positional `world .string <*> .positional `level .nat

/-- Reads a JSON file from the game data. -/
def readGameData (file : String) : DocElabM Json := do
  let path := gameDataDir / file
  unless ← path.pathExists do
    throwError "Game data file {path} not found. Did you run `lake build` in the game?"
  match Json.parse (← IO.FS.readFile path) with
  | .ok j => pure j
  | .error e => throwError "Cannot parse {path}: {e}"

/-- Converts a Markdown text of the game to Verso blocks. -/
def markdownBlocks (md : String) : DocElabM (Array Term) := do
  if md.all Char.isWhitespace then return #[]
  let md := translate (← loadTranslations) md
  let some doc := MD4Lean.parse md (MD4Lean.MD_DIALECT_GITHUB ||| MD4Lean.MD_FLAG_LATEXMATHSPANS)
    | throwError "Cannot parse Markdown:\n{md}"
  doc.blocks.mapM (Markdown.blockFromMarkdown · (handleHeaders := Markdown.strongEmphHeaders))

/-- An inventory entry of the level data. -/
structure Item where
  name : String
  displayName : String
  locked : Bool
  new : Bool
  hidden : Bool
  disabled : Bool
  /-- For theorems: the statement without the name, e.g. ` (a b : ℕ) : a + b = b + a`. -/
  altTitle : String := ""
deriving FromJson

def available (items : Array Item) : Array Item :=
  items.filter fun i => !i.locked && !i.hidden && !i.disabled

/-- The documentation of the items that are new in this level. -/
def newItemDocs (docPrefix : String) (items : Array Item) : DocElabM (Array Term) := do
  let mut out := #[]
  for i in (available items).filter (·.new) do
    let doc ← readGameData s!"doc__{docPrefix}__{i.name}.json"
    let content := (doc.getObjValAs? String "content").toOption.getD ""
    let blocks ← markdownBlocks content
    out := out.push <| ← ``(Verso.Doc.Block.other (Block.nngDetails $(quote s!"New: {i.displayName}"))
      #[$blocks,*])
  return out

/--
Embeds a playable level of the game. Optional content of the directive is shown before the editor.

```
:::level "Addition" 3
:::
```
-/
@[directive]
def level : DirectiveExpanderOf LevelConfig
  | cfg, contents => do
    let data ← readGameData s!"level__{cfg.world}__{cfg.level}.json"
    let str (key : String) := (data.getObjValAs? String key).toOption.getD ""
    let items (key : String) := (data.getObjValAs? (Array Item) key).toOption.getD #[]
    let intro ← markdownBlocks (str "introduction")
    let extra ← contents.mapM elabBlock
    let descr ← markdownBlocks (str "descrText")
    let inventory :=
      (← newItemDocs "Tactic" (items "tactics")) ++ (← newItemDocs "Theorem" (items "lemmas")) ++
      (← newItemDocs "Definition" (items "definitions"))
    let tactics := (available (items "tactics")).map (·.displayName)
    let lemmas := (available (items "lemmas")).map (·.displayName)
    let lemmaTypes := (available (items "lemmas")).map (·.altTitle)
    let conclusion ← markdownBlocks (str "conclusion")
    -- Strip the trailing `:= by` from the statement as shown in lean4game.
    let statement := ":=".intercalate ((str "descrFormat").splitOn ":=").dropLast |>.trimAsciiEnd.copy
    let play ← ``(Verso.Doc.Block.other (Block.nngPlay $(quote statement) $(quote tactics) $(quote lemmas) $(quote lemmaTypes)) #[])
    let concl ← ``(Verso.Doc.Block.other Block.nngConclusion #[$conclusion,*])
    let all := intro ++ extra ++ descr ++ inventory ++ #[play, concl]
    ``(Verso.Doc.Block.other (Block.nngLevel $(quote cfg.world) $(quote cfg.level)) #[$all,*])

structure WorldConfig where
  world : String

instance : FromArgs WorldConfig DocElabM where
  fromArgs := WorldConfig.mk <$> .positional `world .string

/-- The introduction of a world, from the game data. -/
@[directive]
def worldIntro : DirectiveExpanderOf WorldConfig
  | cfg, _ => do
    let game ← readGameData "game.json"
    let some intro := (game.getObjVal? "worlds" >>= (·.getObjVal? "nodes")
        >>= (·.getObjVal? cfg.world) >>= (·.getObjValAs? String "introduction")).toOption
      | throwError "World {cfg.world} not found in game data"
    let blocks ← markdownBlocks intro
    ``(Verso.Doc.Block.other (Block.nngWorld $(quote cfg.world)) #[$blocks,*])

end NNGSite
