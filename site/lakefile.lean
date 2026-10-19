import Lake
open Lake DSL

require verso from git "https://github.com/leanprover/verso.git" @ "v4.35.0"

package «nng-site» where

-- Browser code embedded with `include_str`; listed so that changes trigger a rebuild.
input_file levelJs where
  path := "NNGSite/level.js"

input_file levelCss where
  path := "NNGSite/level.css"

input_file navJs where
  path := "NNGSite/nav.js"

input_file navCss where
  path := "NNGSite/nav.css"

input_file worldMapJs where
  path := "NNGSite/worldmap.js"

input_file worldMapCss where
  path := "NNGSite/worldmap.css"

input_file translations where
  path := "../nng4/.i18n/de/Game.json"

lean_lib NNGSite where
  roots := #[`NNGSite]
  needs := #[levelJs, levelCss, navJs, navCss, worldMapJs, worldMapCss, translations]

@[default_target]
lean_exe «nng-site» where
  root := `NNGSiteMain
