import VersoManual
import NNGSite

open Verso.Genre Manual

def config : RenderConfig where
  emitTeX := false
  emitHtmlSingle := .no
  emitHtmlMulti := .immediately
  -- One page per world and per level.
  htmlDepth := 2

def main := manualMain (%doc NNGSite) (config := config)
