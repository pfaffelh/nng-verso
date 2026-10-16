import Game.MyNat
import Game.Authoring
import Game.Worlds.Tutorial
import Game.Worlds.Addition
import Game.Worlds.RwLesson
import Game.Blind

/-!
The game: its levels are defined in the Verso documents `Game.Worlds.*`, which run the game
server's commands while they are elaborated. `MakeGame` writes the game data to `.lake/gamedata`.
-/

Title "Verso Game Prototype"
Introduction "A small game whose levels are written in Verso documents."

Dependency Tutorial → Addition

MakeGame

-- How often random clicking solves each level (see `Game.Blind`).
MeasureBlindClicking
