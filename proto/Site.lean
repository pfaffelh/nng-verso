import VersoManual
import Game

open Verso.Genre Manual

#doc (Manual) "Verso Game Prototype" =>

This prototype shows a Lean game whose levels are written directly in Verso. Each world below is a
Verso document that also defines the levels for the lean4game server: statement, hints and solution
are part of the document, and the server loads the same module when you play.

{include 1 Game.Worlds.Tutorial}

{include 1 Game.Worlds.Addition}
