import Lean.Data.Json

/-!
# Translations

lean4game games are translated with the `lean-i18n` package: the catalogue
`.i18n/<lang>/Game.json` maps English texts to translations, where code spans (backticks) and math
(`$…$`, `$$…$$`) are replaced by placeholders `§0`, `§1`, … . The functions here mirror
`extractCodeBlocks` and `useGameTranslation` of the lean4game client.
-/

open Lean

namespace NNGSite

/-- Language of the generated site; `"en"` uses the game's original texts. -/
def language : String := "en"

/-- The translation catalogue of the game, relative to the site project. -/
def translationFile : System.FilePath := ".." / "nng4" / ".i18n" / language / "Game.json"

/-- Finds `delim` in `cs` at or after position `start`. -/
private def findDelim (cs : Array Char) (delim : Array Char) (start : Nat) : Option Nat := Id.run do
  let mut k := start
  while k + delim.size ≤ cs.size do
    if cs.extract k (k + delim.size) == delim then return some k
    k := k + 1
  return none

/--
Replaces code spans and math by `§n` and returns them. Equivalent to the regular expression
``/((?<!\\)(`+|\${1,2})([\s\S]*?)\2)/g`` used by the lean4game client.
-/
def extractCodeBlocks (s : String) : String × Array String := Id.run do
  let cs := s.toList.toArray
  let mut out := ""
  let mut blocks : Array String := #[]
  let mut i := 0
  while i < cs.size do
    let c := cs[i]!
    let escaped := i > 0 && cs[i - 1]! == '\\'
    if (c == '`' || c == '$') && !escaped then
      -- Longest run of delimiters first, as the regular expression is greedy there.
      let mut run := 0
      while i + run < cs.size && cs[i + run]! == c && (c == '`' || run < 2) do
        run := run + 1
      let mut found := false
      for len' in [0:run] do
        let len := run - len'
        let delim := cs.extract i (i + len)
        if let some k := findDelim cs delim (i + len) then
          blocks := blocks.push (String.mk (cs.extract i (k + len)).toList)
          out := out ++ s!"§{blocks.size - 1}"
          i := k + len
          found := true
          break
      if !found then
        out := out.push c
        i := i + 1
    else
      out := out.push c
      i := i + 1
  return (out, blocks)

/-- Puts the blocks back in place of unescaped placeholders `§n`. -/
def insertCodeBlocks (s : String) (blocks : Array String) : String := Id.run do
  let cs := s.toList.toArray
  let mut out := ""
  let mut i := 0
  while i < cs.size do
    let c := cs[i]!
    if c == '§' && !(i > 0 && cs[i - 1]! == '\\') then
      let mut j := i + 1
      while j < cs.size && cs[j]!.isDigit do j := j + 1
      match (String.mk (cs.extract (i + 1) j).toList).toNat? >>= (blocks[·]?) with
      | some block => out := out ++ block; i := j
      | none => out := out.push c; i := i + 1
    else
      out := out.push c
      i := i + 1
  return out

/-- Reads the translation catalogue, or an empty one for English. -/
def loadTranslations : IO Json := do
  if language == "en" || !(← translationFile.pathExists) then return Json.mkObj []
  match Json.parse (← IO.FS.readFile translationFile) with
  | .ok j => pure j
  | .error e => throw <| IO.userError s!"Cannot parse {translationFile}: {e}"

/-- Translates a text of the game, keeping it unchanged if no translation exists. -/
def translate (catalogue : Json) (s : String) : String :=
  let (key, blocks) := extractCodeBlocks s
  -- `lean-i18n` doubles backslashes outside code blocks in catalogue keys.
  let candidates := [key.replace "\\" "\\\\", key, s]
  match candidates.findSome? fun k => (catalogue.getObjValAs? String k).toOption.filter (· != "") with
  | some t => insertCodeBlocks t blocks
  | none => s

end NNGSite
