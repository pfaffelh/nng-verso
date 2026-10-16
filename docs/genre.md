# A Verso genre for Lean games

Design notes for a dedicated Verso genre for lean4game games. Nothing here is implemented yet; the
site on `main` and the prototype on `levels-in-verso` use Verso's `Manual` genre with extensions.

## Where we are

* `main`: the levels of NNG4 rendered as a book with the `Manual` genre. Directives (`:::level`,
  `:::worldMap`) add the game parts; the page layout is Manual's: header, table of contents on the
  left, text in the middle, previous/next links.
* `levels-in-verso`: levels are *written* in Verso documents, which also define them for the game
  server (`proto/`).

`Manual` is built to be extended, and small layout changes work through the CSS and JavaScript that
extensions may bring along. Structural changes do not: Manual imposes the page skeleton of a book.

## What the game should look like

### Large screens

* **Vertical split** of the window into columns, for example

  ```
  +----------------+----------------------+-------------+
  | text, task     | editor               | map         |
  | (scrolls)      | goals, hints, errors | inventory   |
  +----------------+----------------------+-------------+
  ```

* **Expanders**: columns or panels can be collapsed, e.g. the text once it has been read, or the
  inventory.
* **Navigation always visible**: a (mini) world map or level list stays on screen, with the current
  level highlighted; it does not scroll away with the text.

### Mobile

The columns do not fit; they are stacked or shown one at a time (text / editor / goals), switched
by tabs.

**Navigation through a fixed bottom bar**, a common pattern on mobile sites:

* below a breakpoint (e.g. 768px) a bar is fixed to the bottom edge, about 80px high;
* a few equal-width items, each an icon with a short label, e.g. *Map*, *Level*, *Inventory*,
  *Menu*;
* *Menu* opens a full-width panel sliding in from the side, with the list of worlds and levels;
* the top navigation is hidden on mobile, and the page gets bottom padding so that the bar does not
  cover content.

## What a genre adds

A Verso genre consists of a few types and a renderer. For a game they would be:

| Genre part | For a game |
| --- | --- |
| `PartMetadata` | world, level number, title, dependencies between worlds |
| `Block`, `Inline` | statement, hint, solution, introduction of a new tactic or theorem |
| `TraverseContext` | the current world and level |
| `TraverseState` | the inventory: which tactics and theorems have been introduced up to a level (today computed by lean4game's `MakeGame`) |
| HTML rendering | page templates and navigation |

With its own genre the game gets:

* **Own page templates per page type**: start page = large world map, world page = overview of its
  levels, level page = the game view described above, without the book frame where it gets in the
  way.
* **Navigation by game logic** instead of chapter order: "next unlocked level", locked worlds
  greyed out, progress from the browser.
* **Checks at build time**: a level without a statement, a hint mentioning a tactic that is not yet
  available, or a cycle in the world dependencies fail the build.

The cost: features that `Manual` provides would have to be reused or rebuilt: multi-page output,
search, cross-references, table of contents, KaTeX math. Verso's example of a custom genre is
`test-projects/custom-genre` in the Verso repository (about 400 lines, one page).

## Relation to the game server

A genre changes the authoring and the frontend, not the runtime. Players' proofs are still checked
by a Lean server running the lean4game engine (`GameServer`): it decides which tactics are
available, matches hints against the player's goals and reports the proof state. The genre would
produce the pages and the level modules the engine loads, as on `levels-in-verso`.

The lean4game backend is being redesigned with a documented API, which should make alternative
frontends easier. The current client depends on details of today's relay (range edits after
`didOpen`, goals of an unfinished `·` block read from error messages, unknown identifiers not being
reported); a game genre should target the new API once it exists.

## Suggested steps

1. Try the layout on top of `Manual` with CSS and JavaScript: wider game view, a mini world map
   fixed in a corner, collapsible panels, the bottom bar on mobile. This shows quickly whether the
   layout works.
2. Collect what does not fit Manual's skeleton (page types, navigation).
3. Move to a genre once structure has to change, keeping the blocks from the `Manual` extensions
   (level, statement, conclusion, world map).

## Open questions

* Should the game remain readable as a book (with a book view next to the game view), or is the
  game view enough?
* Is the table of contents still needed when the world map is always visible?
* What does the mobile game view look like: tabs for text / editor / goals, or the editor with the
  goals as an overlay?
* Where does progress live when the same game is embedded in lecture notes as well?
