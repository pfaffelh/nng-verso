// Colours the world map (`Block.nngWorldMap`) according to the progress that `level.js` stores in
// localStorage: green = solved, blue = playable, grey = not yet unlocked.
(function () {
  'use strict'

  function solved(world, level) {
    try {
      return JSON.parse(localStorage.getItem(`nng-verso:${world}:${level}`))?.completed === true
    } catch { return false }
  }

  function init() {
    for (const map of document.querySelectorAll('.nng-map')) {
      const worlds = [...map.querySelectorAll('.nng-map-world')]
      const done = {}
      for (const w of worlds) {
        const size = Number(w.dataset.size)
        done[w.dataset.world] = Array.from({ length: size }, (_, i) => solved(w.dataset.world, i + 1)).every(x => x)
      }
      for (const w of worlds) {
        const name = w.dataset.world
        const preds = w.dataset.preds ? w.dataset.preds.split(',') : []
        const unlocked = preds.every(p => done[p])
        w.classList.toggle('done', done[name])
        w.classList.toggle('unlocked', unlocked)
        for (const l of w.querySelectorAll('.nng-map-level')) {
          const n = Number(l.dataset.level)
          l.classList.toggle('done', solved(name, n))
          l.classList.toggle('unlocked', n === 1 ? unlocked : solved(name, n - 1))
        }
      }
      for (const e of map.querySelectorAll('.nng-map-edge')) e.classList.toggle('done', done[e.dataset.from])
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
  // Progress may change in another tab.
  window.addEventListener('storage', init)
})()
