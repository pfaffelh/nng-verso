import Lake
open Lake DSL

/-
Prototype: a lean4game game whose levels are written in Verso documents.
The same Lean modules define the levels for the game server and render as pages.
Verso and the game server must use the same Lean version (v4.31.0).
-/

require GameServer from git "https://github.com/leanprover-community/lean4game.git" @ "v4.31.0" / "server"
require verso from git "https://github.com/leanprover/verso.git" @ "v4.31.0"

package VersoGame where
  -- As in lean4game games: linter warnings would confuse players.
  leanOptions := #[⟨`linter.all, false⟩, ⟨`tactic.hygienic, false⟩,
    -- `succ d` rather than `d.succ` in goals
    ⟨`pp.fieldNotation, false⟩]
  moreServerOptions := #[⟨`trace.debug, true⟩]

-- The JS and CSS of the level pages, embedded with `include_str`.
input_file levelJs where
  path := "../site/NNGSite/level.js"

input_file levelCss where
  path := "../site/NNGSite/level.css"

-- The proof graph editor (`Game/Ipm.lean`).
input_file ipmJs where
  path := "Game/ipm.js"

input_file ipmCss where
  path := "Game/ipm.css"

@[default_target]
lean_lib Game where
  needs := #[levelJs, levelCss, ipmJs, ipmCss]

-- The site: imports the game, so the game data exists when it is rendered.
lean_lib Site

lean_exe «game-site» where
  root := `SiteMain
