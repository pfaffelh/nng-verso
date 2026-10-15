import VersoManual
import NNGSite.Level

/-!
# World map

The directive `:::worldMap` draws the dependency graph of the worlds as in lean4game: each world is
a circle with its levels arranged around it. The layout is computed at build time from the game
data; links to the world and level pages are filled in during traversal (see `registerPage`).
`worldmap.js` colours worlds and levels according to the progress stored in the browser.
-/

open Lean Elab
open Verso Doc Elab ArgParse
open Verso.Genre Manual
open Verso.Output (Html)

namespace NNGSite

def worldMapJs : String := include_str "worldmap.js"
def worldMapCss : String := include_str "worldmap.css"

structure MapWorld where
  world : String
  title : String
  size : Nat
  preds : Array String
  x : Float := 0
  y : Float := 0
deriving ToJson, FromJson, Inhabited

/-! Geometry, following lean4game's `world_tree.tsx`. -/

/-- Radius of a level circle. -/
def levelRadius : Float := 16
def layerDistance : Float := 250
def worldDistance : Float := 250

def piF : Float := 3.141592653589793

/-- Angle between two levels around a world with `n` levels. -/
def levelAngle (n : Nat) : Float := 2 * piF / (min (max n 5 + 2) 17).toFloat

/-- Distance of the level circles from the world's centre. -/
def levelOrbit (n : Nat) : Float := 1.1 * levelRadius / Float.sin (levelAngle n / 2)

def worldRadius (n : Nat) : Float := levelOrbit n - 1.2 * levelRadius

def levelPos (w : MapWorld) (i : Nat) : Float × Float :=
  let β := levelAngle w.size * i.toFloat
  (w.x + Float.sin β * levelOrbit w.size, w.y - Float.cos β * levelOrbit w.size)

/--
Layered layout: a world's layer is the length of the longest dependency path leading to it.
Within a layer, worlds are ordered by the mean position of their predecessors.
-/
def layoutWorlds (worlds : Array MapWorld) : Array MapWorld := Id.run do
  let mut layer : Std.HashMap String Nat := {}
  for _ in worlds do
    for w in worlds do
      let l := w.preds.foldl (fun acc p => max acc ((layer.getD p 0) + 1)) 0
      layer := layer.insert w.world l
  let depth := worlds.foldl (fun acc w => max acc (layer.getD w.world 0)) 0
  let mut xs : Std.HashMap String Float := {}
  let mut result := #[]
  for l in [0:depth + 1] do
    let inLayer := worlds.filter (layer.getD ·.world 0 == l)
    let key (w : MapWorld) : Float :=
      if w.preds.isEmpty then 0
      else w.preds.foldl (fun acc p => acc + xs.getD p 0) 0 / w.preds.size.toFloat
    let sorted := inLayer.insertionSort fun a b => key a < key b
    let k := sorted.size.toFloat
    for h : i in [0:sorted.size] do
      let w := sorted[i]
      let x := (i.toFloat - (k - 1) / 2) * worldDistance
      xs := xs.insert w.world x
      result := result.push { w with x, y := l.toFloat * layerDistance }
  return result

def fmt (x : Float) : String :=
  let r := x.round
  if r < 0 then "-" ++ toString (-r).toUInt64 else toString r.toUInt64

def renderMap (worlds : Array MapWorld) (links : Json) : Html := Id.run do
  let link (key : String) : Option String := (links.getObjValAs? String key).toOption
  let attrsWithLink (key : String) (inner : Html) : Html :=
    match link key with
    | some href => .tag "a" #[("href", href)] inner
    | none => inner
  let byName : Std.HashMap String MapWorld := worlds.foldl (fun m w => m.insert w.world w) {}
  -- Bounding box
  let margin := 2 * levelRadius
  let mut minX := 0.0
  let mut maxX := 0.0
  let mut maxY := 0.0
  for w in worlds do
    let ext := levelOrbit w.size + levelRadius + margin
    minX := min minX (w.x - ext)
    maxX := max maxX (w.x + ext)
    maxY := max maxY (w.y + ext + 30)
  let minY := -(worlds.foldl (fun acc w => max acc (levelOrbit w.size)) 0 + levelRadius + margin)
  -- Edges first, so that they are behind the worlds.
  let mut edges := #[]
  for w in worlds do
    for p in w.preds do
      if let some src := byName[p]? then
        edges := edges.push <| .tag "line" #[("class", "nng-map-edge"), ("data-from", p),
          ("x1", fmt src.x), ("y1", fmt src.y), ("x2", fmt w.x), ("y2", fmt w.y)] .empty
  let mut groups := #[]
  for w in worlds do
    let R := worldRadius w.size
    let circle : Html := .tag "circle" #[("class", "nng-map-world-circle"),
      ("cx", fmt w.x), ("cy", fmt w.y), ("r", fmt R)] .empty
    let label : Html := .tag "foreignObject" #[("x", fmt (w.x - 80)),
        ("y", fmt (w.y + R + 2.4 * levelRadius)), ("width", "160"), ("height", "40")] <|
      .tag "div" #[("class", "nng-map-label")] (.text true w.title)
    let mut levels := #[]
    for i in [1:w.size + 1] do
      let (x, y) := levelPos w i
      levels := levels.push <| attrsWithLink s!"{w.world}:{i}" <|
        .tag "g" #[("class", "nng-map-level"), ("data-level", toString i)] <| .seq #[
          .tag "circle" #[("cx", fmt x), ("cy", fmt y), ("r", fmt levelRadius)] .empty,
          .tag "text" #[("x", fmt x), ("y", fmt y), ("text-anchor", "middle"),
            ("dominant-baseline", "central")] (.text true (toString i))
        ]
    groups := groups.push <| .tag "g" #[("class", "nng-map-world"), ("data-world", w.world),
        ("data-size", toString w.size), ("data-preds", ",".intercalate w.preds.toList)] <| .seq #[
      attrsWithLink w.world (.seq #[circle, label]),
      .seq levels
    ]
  let viewBox := s!"{fmt minX} {fmt minY} {fmt (maxX - minX)} {fmt (maxY - minY)}"
  .tag "div" #[("class", "nng-map")] <|
    .tag "svg" #[("viewBox", viewBox), ("xmlns", "http://www.w3.org/2000/svg"),
      ("style", s!"max-width: {fmt ((maxX - minX) * 0.8)}px")]
      (.seq (edges ++ groups))

block_extension Block.nngWorldMap (layout : String) (links : Json) where
  data := Json.mkObj [("layout", layout), ("links", links)]
  traverse _ data contents := do
    let layout := (data.getObjValAs? String "layout").toOption.getD "[]"
    let old := (data.getObjVal? "links").toOption.getD (Json.mkObj [])
    let new := pageLinks (← get)
    if old.compress == new.compress then pure none
    else pure <| some <| .other (Block.nngWorldMap layout new) contents
  extraJs := {JS.mk worldMapJs}
  extraCss := {CSS.mk worldMapCss}
  toHtml := some fun _ _ _ data _ => do
    let layout := (data.getObjValAs? String "layout").toOption.getD "[]"
    let links := (data.getObjVal? "links").toOption.getD (Json.mkObj [])
    let worlds : Array MapWorld := (Json.parse layout >>= fromJson?).toOption.getD #[]
    pure <| renderMap worlds links
  toTeX := none

/-- Draws the map of all worlds of the game. -/
@[directive]
def worldMap : DirectiveExpanderOf Unit
  | (), _ => do
    let game ← readGameData "game.json"
    let some nodes := (game.getObjVal? "worlds" >>= (·.getObjVal? "nodes")).toOption
      | throwError "No worlds in game data"
    let edges : Array (Array String) :=
      (game.getObjVal? "worlds" >>= (·.getObjValAs? (Array (Array String)) "edges")).toOption.getD #[]
    let some (.obj nodes) := some nodes | throwError "Unexpected world data"
    let catalogue ← loadTranslations
    let worlds := nodes.toArray.map fun (name, node) => {
      world := name
      title := translate catalogue <| (node.getObjValAs? String "title").toOption.getD name
      size := (game.getObjVal? "worldSize" >>= (·.getObjValAs? Nat name)).toOption.getD 0
      preds := edges.filterMap fun e => if e[1]? == some name then e[0]? else none
      : MapWorld }
    let layout := (toJson (layoutWorlds worlds)).compress
    ``(Verso.Doc.Block.other (Block.nngWorldMap $(quote layout) (Lean.Json.mkObj [])) #[])

end NNGSite
