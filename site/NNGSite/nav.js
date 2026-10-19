// The map of the worlds in the table of contents, and the stage of a world page (as in the
// Incredible Proof Machine in Lean).
//
// * Map: a circle per world with its levels solved, lines from the worlds it builds on, the current
//   world marked; it replaces the list of the table of contents. The worlds come from `data-map`
//   (written by `:::worldIntro` and `:::worldMap`), the links from the table of contents.
// * Stage: a world page shows one level at a time. Above it on the right: a dot per level (solved,
//   current) and the switch between text input and click input (`nng-verso:mode`, the class
//   `nng-click` on the root element; `level.js` builds the board of the click input).
(function () {
  'use strict'

  const el = (tag, cls, text) => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text !== undefined) e.textContent = text
    return e
  }
  const svg = (tag, attrs = {}, text) => {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag)
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
    if (text !== undefined) e.textContent = text
    return e
  }
  const solved = (world, level) => {
    try { return JSON.parse(localStorage.getItem(`nng-verso:${world}:${level}`))?.completed === true } catch { return false }
  }
  const DE = document.documentElement.lang === 'de' || document.querySelector('.nng-level[data-lang="de"]')
  const tr = (en, de) => (DE ? de : en)

  // ---------------------------------------------------------------- mode

  let MODE = 'text'
  try { MODE = localStorage.getItem('nng-verso:mode') === 'click' ? 'click' : 'text' } catch {}
  const setMode = m => {
    MODE = m
    try { localStorage.setItem('nng-verso:mode', m) } catch {}
    document.documentElement.classList.toggle('nng-click', m === 'click')
    window.dispatchEvent(new CustomEvent('nng-mode', { detail: m }))
  }
  document.documentElement.classList.toggle('nng-click', MODE === 'click')

  // ---------------------------------------------------------------- map

  function worldMap() {
    const source = document.querySelector('[data-map]'), toc = document.querySelector('#toc')
    if (!source || !toc) return
    toc.querySelector('.nng-nav')?.remove()  // (drawn anew when a level is solved)
    let worlds
    try { worlds = JSON.parse(source.dataset.map) } catch { return }
    // links: the entries of the table of contents, by title
    const links = {}
    for (const a of toc.querySelectorAll('.split-toc a')) links[a.textContent.trim()] = a.getAttribute('href')
    const here = document.querySelector('.nng-world')?.dataset.world
    // rows: by layer, then from left to right; a column per world of a layer
    const layer = w => Math.round(w.y / 250)
    const rows = [...worlds].sort((a, b) => layer(a) - layer(b) || a.x - b.x)
    const col = {}
    for (const w of rows) col[w.world] = rows.filter(v => layer(v) === layer(w) && v.x < w.x).length
    const cols = Math.max(...Object.values(col)) + 1
    const dx = 26, dy = 50, x0 = 22, y0 = 22, r = 15
    const at = w => ({ x: x0 + col[w.world] * dx, y: y0 + rows.indexOf(w) * dy })
    const done = w => Array.from({ length: w.size }, (_, i) => solved(w.world, i + 1)).filter(x => x).length
    const finished = w => done(w) === w.size
    const width = 250, height = y0 + rows.length * dy
    const map = svg('svg', { class: 'nng-nav-map', viewBox: `0 0 ${width} ${height}`, width, height })
    for (const w of rows) for (const p of w.preds) {
      const a = at(worlds.find(v => v.world === p)), b = at(w)
      map.append(svg('path', { class: 'nng-nav-edge' + (finished(worlds.find(v => v.world === p)) ? ' nng-nav-done' : ''),
        d: a.x === b.x ? `M${a.x},${a.y}L${b.x},${b.y}` : `M${a.x},${a.y}C${a.x},${(a.y + b.y) / 2} ${b.x},${(a.y + b.y) / 2} ${b.x},${b.y}` }))
    }
    rows.forEach((w, i) => {
      const { x, y } = at(w), n = done(w), open = w.preds.every(p => finished(worlds.find(v => v.world === p)))
      const g = svg('a', { class: 'nng-nav-world' + (finished(w) ? ' nng-nav-done' : open ? ' nng-nav-open' : '') + (w.world === here ? ' nng-nav-here' : '') })
      if (links[w.title]) g.setAttribute('href', links[w.title])
      g.append(svg('title', {}, w.title))
      g.append(svg('circle', { cx: x, cy: y, r, class: 'nng-nav-disc' }))
      // the levels solved: a ring around the circle
      if (n > 0 && n < w.size) {
        const c = 2 * Math.PI * (r + 4)
        g.append(svg('circle', { cx: x, cy: y, r: r + 4, class: 'nng-nav-ring', 'stroke-dasharray': `${c * n / w.size} ${c}`, transform: `rotate(-90 ${x} ${y})` }))
      }
      g.append(svg('text', { x, y: y + 5, 'text-anchor': 'middle', class: 'nng-nav-num' }, String(i + 1)))
      const lx = x0 + cols * dx + 4
      g.append(svg('text', { x: lx, y: y - 1, class: 'nng-nav-title' }, w.title.replace(/ World$/, '').replace(/^Welt /, '')))
      g.append(svg('text', { x: lx, y: y + 13, class: 'nng-nav-count' }, `${n}/${w.size}`))
      map.append(g)
    })
    const box = el('div', 'nng-nav')
    box.append(el('div', 'nng-nav-head', tr('Worlds', 'Welten')), map)
    toc.querySelector('.split-tocs')?.before(box)
    toc.classList.add('nng-has-map')
  }

  // ---------------------------------------------------------------- stage

  function stage() {
    const levels = [...document.querySelectorAll('.nng-level')]
    if (!levels.length) return
    const sections = levels.map(l => l.closest('section'))
    const world = document.querySelector('.nng-world')
    const h1 = world?.closest('section')?.querySelector('h1')
    // the line above the level: the switch and the dots
    const top = el('div', 'nng-top'), dots = el('div', 'nng-dots'), modes = el('div', 'nng-modes')
    for (const [m, label] of [['text', tr('Text', 'Text')], ['click', tr('Click', 'Klick')]]) {
      const b = el('button', 'nng-mode' + (MODE === m ? ' nng-mode-current' : ''), label)
      b.type = 'button'
      b.addEventListener('click', () => { setMode(m); modes.querySelectorAll('button').forEach(x => x.classList.toggle('nng-mode-current', x === b)) })
      modes.append(b)
    }
    top.append(modes, dots)
    h1?.after(top)
    // the introduction of the world: folded away once a level of it was solved
    if (world) {
      const intro = el('details', 'nng-world-intro')
      intro.append(el('summary', '', tr('About this world', 'Über diese Welt')), ...[...world.childNodes])
      intro.open = !levels.some(l => solved(l.dataset.world, Number(l.dataset.level)))
      world.append(intro)
    }
    let current = 0
    const refresh = () => {
      dots.replaceChildren()
      levels.forEach((l, k) => {
        const d = el('button', 'nng-dot' + (solved(l.dataset.world, Number(l.dataset.level)) ? ' nng-dot-done' : '') + (k === current ? ' nng-dot-current' : ''))
        d.type = 'button'
        d.title = sections[k]?.querySelector('h2')?.textContent.replace('🔗', '').trim() ?? `Level ${k + 1}`
        d.addEventListener('click', () => show(k))
        dots.append(d)
      })
    }
    const show = k => {
      current = Math.max(0, Math.min(levels.length - 1, k))
      sections.forEach((s, i) => { if (s) s.hidden = i !== current })
      history.replaceState(null, '', `${location.pathname}${location.search}#level-${current + 1}`)
      refresh()
      // (a moment later: level.js may not have made its levels yet)
      setTimeout(() => window.dispatchEvent(new CustomEvent('nng-show', { detail: levels[current] })))
    }
    // a level solved: the dots, and "Next"
    const watch = new MutationObserver(() => { refresh(); worldMap() })
    levels.forEach(l => watch.observe(l, { attributes: true, attributeFilter: ['class'] }))
    levels.forEach((l, k) => {
      const next = el('button', 'nng-next', k === levels.length - 1 ? tr('Back to the map', 'Zurück zur Karte') : tr('Next level ›', 'Nächstes Level ›'))
      next.type = 'button'
      next.addEventListener('click', () => { if (k === levels.length - 1) location.href = document.querySelector('#toc .toc-title')?.getAttribute('href') || './'; else show(k + 1) })
      l.querySelector('.nng-conclusion')?.after(next)
    })
    const fromHash = () => Number(/^#level-(\d+)$/.exec(location.hash)?.[1] ?? 0) - 1
    let start = fromHash()
    if (start < 0) start = Math.max(0, levels.findIndex(l => !solved(l.dataset.world, Number(l.dataset.level))))
    document.documentElement.classList.add('nng-staged')
    show(start)
    window.addEventListener('hashchange', () => { if (fromHash() >= 0 && fromHash() !== current) show(fromHash()) })
  }

  function init() {
    worldMap()
    stage()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
