// A tap-based proof graph editor in the style of the Incredible Proof Machine
// (https://incredible.pm, Joachim Breitner, MIT license), for natural deduction.
//
// Each `.ipm-task` element is a task: given assumptions, prove the conclusions by connecting rule
// blocks. Everything is checked in the browser: every connection is checked by unification, in the
// order the connections were made, so a conflict is blamed on the newest connection (☠).
//
// Interaction works by tapping, so it also works on phones: tap a port to see what can be connected
// to it — existing ports or new rule blocks whose propositions fit — and tap an option.

(function () {
  'use strict'

  // ---------------------------------------------------------------- formulas

  // Formulas: {t: 'atom', n} | {t: 'and'|'or'|'imp', a, b} | {t: 'not', a} | {t: 'bot'} | {t: 'meta', id}
  function parse(src) {
    const tokens = src.match(/[A-Za-z][\w']*|∧|∨|→|¬|⊥|\(|\)|->|\/\\|\\\/|~/g) ?? []
    let i = 0
    const eat = t => { if (tokens[i] === t) { i++; return true } return false }
    const norm = { '/\\': '∧', '\\/': '∨', '->': '→', '~': '¬' }
    tokens.forEach((t, k) => { tokens[k] = norm[t] ?? t })
    // As in Lean, →, ∨ and ∧ are right-associative (the Incredible Proof Machine reads ∧ and ∨
    // to the left), and ∧ binds more strongly than ∨, which binds more strongly than →.
    const imp = () => { const a = or(); return eat('→') ? { t: 'imp', a, b: imp() } : a }
    const or = () => { const a = and(); return eat('∨') ? { t: 'or', a, b: or() } : a }
    const and = () => { const a = un(); return eat('∧') ? { t: 'and', a, b: and() } : a }
    const un = () => {
      if (eat('¬')) return { t: 'not', a: un() }
      if (eat('⊥')) return { t: 'bot' }
      if (eat('(')) { const a = imp(); eat(')'); return a }
      const n = tokens[i++]
      if (!n) throw new Error(`Cannot parse ${src}`)
      return { t: 'atom', n }
    }
    const f = imp()
    if (i < tokens.length) throw new Error(`Cannot parse ${src}`)
    return f
  }

  const prec = { imp: 1, or: 2, and: 3, not: 4 }
  function show(f, s = {}, ctx = 0) {
    f = resolve(f, s)
    const wrap = (p, txt) => (p < ctx ? `(${txt})` : txt)
    switch (f.t) {
      case 'atom': return f.n
      case 'bot': return '⊥'
      case 'meta': return '?' + metaNumber(f.id.split('.').pop())
      case 'not': return wrap(4, '¬' + show(f.a, s, 4))
      case 'and': return wrap(3, `${show(f.a, s, 4)} ∧ ${show(f.b, s, 3)}`)
      case 'or': return wrap(2, `${show(f.a, s, 3)} ∨ ${show(f.b, s, 2)}`)
      case 'imp': return wrap(1, `${show(f.a, s, 2)} → ${show(f.b, s, 1)}`)
    }
  }

  // Rule variables A, B, C, … are shown as ?1, ?2, ?3, … while undetermined.
  const metaNumber = v => (/^[A-Z]$/.test(v) ? v.charCodeAt(0) - 64 : v)

  function resolve(f, s) {
    while (f.t === 'meta' && s[f.id]) f = s[f.id]
    return f
  }

  const occurs = (id, f, s) => {
    f = resolve(f, s)
    if (f.t === 'meta') return f.id === id
    return ['a', 'b'].some(k => f[k] && occurs(id, f[k], s))
  }

  // Unifies `x` and `y` under substitution `s`; returns the extended substitution or null.
  function unify(x, y, s) {
    x = resolve(x, s); y = resolve(y, s)
    if (x.t === 'meta' && y.t === 'meta' && x.id === y.id) return s
    if (x.t === 'meta') return occurs(x.id, y, s) ? null : { ...s, [x.id]: y }
    if (y.t === 'meta') return unify(y, x, s)
    if (x.t !== y.t) return null
    if (x.t === 'atom') return x.n === y.n ? s : null
    if (x.t === 'bot') return s
    if (x.t === 'not') return unify(x.a, y.a, s)
    const s1 = unify(x.a, y.a, s)
    return s1 && unify(x.b, y.b, s1)
  }

  // Replaces the rule's variables by metavariables private to one block.
  function instantiate(f, vars, block) {
    if (f.t === 'atom' && vars.includes(f.n)) return { t: 'meta', id: `${block}.${f.n}` }
    if (f.t === 'atom' || f.t === 'bot') return f
    const g = { ...f }
    if (f.a) g.a = instantiate(f.a, vars, block)
    if (f.b) g.b = instantiate(f.b, vars, block)
    return g
  }

  // ---------------------------------------------------------------- rules

  const RULES = {
    conjI: { label: '∧I', name: '∧-introduction', vars: ['A', 'B'], inputs: ['A', 'B'], outputs: ['A∧B'] },
    conjE: { label: '∧E', name: '∧-elimination', vars: ['A', 'B'], inputs: ['A∧B'], outputs: ['A', 'B'] },
  }

  // ---------------------------------------------------------------- the proof state

  class Proof {
    constructor(assumptions, conclusions) {
      this.blocks = []
      this.connections = []
      this.next = 0
      for (const a of assumptions) this.addBlock({ kind: 'assumption', inputs: [], outputs: [parse(a)] })
      for (const c of conclusions) this.addBlock({ kind: 'conclusion', inputs: [parse(c)], outputs: [] })
    }

    addBlock(b) {
      b.id = `b${this.next++}`
      this.blocks.push(b)
      return b
    }

    addRule(name) {
      const r = RULES[name], id = `b${this.next}`
      return this.addBlock({
        kind: 'rule', rule: name,
        inputs: r.inputs.map(p => instantiate(parse(p), r.vars, id)),
        outputs: r.outputs.map(p => instantiate(parse(p), r.vars, id)),
      })
    }

    connect(from, to) {
      // An input takes one connection.
      this.connections = this.connections.filter(c => !(c.to.block === to.block && c.to.port === to.port))
      this.connections.push({ id: `c${this.next++}`, from, to })
    }

    block(id) { return this.blocks.find(b => b.id === id) }

    removeBlock(id) {
      this.blocks = this.blocks.filter(b => b.id !== id)
      if (this.moved) delete this.moved[id]
      this.connections = this.connections.filter(c => c.from.block !== id && c.to.block !== id)
    }

    // `moved` holds the positions of blocks the player has dragged.
    snapshot() { return JSON.stringify({ b: this.blocks, c: this.connections, n: this.next, m: this.moved ?? {} }) }
    restore(snap) { const o = JSON.parse(snap); this.blocks = o.b; this.connections = o.c; this.next = o.n; this.moved = o.m ?? {} }

    // Whether connecting the output of `from` to `to` closes a cycle.
    createsCycle(from, to) {
      const succ = id => this.connections.filter(c => c.from.block === id).map(c => c.to.block)
      const seen = new Set(), stack = [to]
      while (stack.length) {
        const x = stack.pop()
        if (x === from) return true
        if (seen.has(x)) continue
        seen.add(x)
        stack.push(...succ(x))
      }
      return false
    }

    // Checks all connections in the order they were made.
    analyze() {
      let s = {}
      const status = {}
      for (const c of this.connections) {
        const out = this.block(c.from.block).outputs[c.from.port]
        const inp = this.block(c.to.block).inputs[c.to.port]
        const s1 = unify(out, inp, s)
        if (s1) { s = s1; status[c.id] = 'ok' } else status[c.id] = 'fail'
      }
      const openInputs = []
      for (const b of this.blocks)
        b.inputs.forEach((_, i) => {
          if (!this.connections.some(c => c.to.block === b.id && c.to.port === i && status[c.id] === 'ok'))
            openInputs.push({ block: b.id, port: i })
        })
      const failed = this.connections.some(c => status[c.id] === 'fail')
      const goalsDone = this.blocks.filter(b => b.kind === 'conclusion')
        .every(b => !openInputs.some(o => o.block === b.id))
      return { s, status, openInputs, qed: !failed && openInputs.length === 0 && goalsDone }
    }
  }

  // ---------------------------------------------------------------- rendering

  const SVG = 'http://www.w3.org/2000/svg'
  const svg = (tag, attrs = {}, text) => {
    const e = document.createElementNS(SVG, tag)
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
    if (text !== undefined) e.textContent = text
    return e
  }
  const el = (tag, cls, text) => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text !== undefined) e.textContent = text
    return e
  }
  const charW = 8.4, layerH = 104, portGap = 18

  // The line from output position `a` down to input position `b`.
  function curve(a, b) {
    const dy = Math.max(30, Math.abs(b.y - a.y) / 2)
    return `M${a.x},${a.y} C${a.x},${a.y + dy} ${b.x},${b.y - dy} ${b.x},${b.y}`
  }

  // Size of a block, from its labels.
  function blockSize(b, s) {
    const texts = [...b.inputs, ...b.outputs].map(f => show(f, s))
    const label = b.kind === 'rule' ? RULES[b.rule].label : ''
    const inW = b.inputs.reduce((w, f) => w + show(f, s).length * charW + portGap, 0)
    const outW = b.outputs.reduce((w, f) => w + show(f, s).length * charW + portGap, 0)
    return { w: Math.max(56, inW, outW, label.length * 12 + 24, ...texts.map(t => t.length * charW + 20)),
             h: b.kind === 'rule' ? 62 : 34 }
  }

  // Where port `i` (kind 'in' or 'out') of block `b` at position `q` sits.
  function portAt(q, b, kind, i) {
    const n = kind === 'in' ? b.inputs.length : b.outputs.length
    return { x: q.x + q.w * (i + 1) / (n + 1), y: kind === 'in' ? q.y : q.y + q.h }
  }

  // Draws block `b` at `q` = {x, y, w, h}. The same drawing is used on the board and in the list of
  // rules. `portClass(kind, i)` adds classes to the ports; ports carry `data-kind` and `data-i`.
  function drawBlock(b, q, s, extraClass = '', portClass = () => '') {
    const g = svg('g', { class: `ipm-block ipm-${b.kind} ${extraClass}` })
    g.append(svg('rect', { x: q.x, y: q.y, width: q.w, height: q.h, rx: 8 }))
    if (b.kind === 'rule') {
      g.append(svg('text', { x: q.x + q.w / 2, y: q.y + q.h / 2 + 6, class: 'ipm-rule-label', 'text-anchor': 'middle' }, RULES[b.rule].label))
      b.inputs.forEach((f, i) => g.append(svg('text', { x: portAt(q, b, 'in', i).x, y: q.y + 17, 'text-anchor': 'middle', class: 'ipm-port-label' }, show(f, s))))
      b.outputs.forEach((f, i) => g.append(svg('text', { x: portAt(q, b, 'out', i).x, y: q.y + q.h - 8, 'text-anchor': 'middle', class: 'ipm-port-label' }, show(f, s))))
    } else {
      const f = b.kind === 'assumption' ? b.outputs[0] : b.inputs[0]
      g.append(svg('text', { x: q.x + q.w / 2, y: q.y + q.h / 2 + 5, 'text-anchor': 'middle', class: 'ipm-prop' }, show(f, s)))
    }
    for (const kind of ['in', 'out'])
      (kind === 'in' ? b.inputs : b.outputs).forEach((_, i) => {
        const xy = portAt(q, b, kind, i)
        const port = svg('g', { class: `ipm-port ipm-${kind} ${portClass(kind, i)}`, 'data-kind': kind, 'data-i': i })
        port.append(svg('circle', { cx: xy.x, cy: xy.y, r: 16, class: 'ipm-hit' }), svg('circle', { cx: xy.x, cy: xy.y, r: 6 }))
        g.append(port)
      })
    return g
  }

  // A rule as a small picture: exactly the block that gets added to the board.
  function rulePicture(name) {
    const r = RULES[name]
    const b = { kind: 'rule', rule: name,
      inputs: r.inputs.map(x => instantiate(parse(x), r.vars, 'rule')),
      outputs: r.outputs.map(x => instantiate(parse(x), r.vars, 'rule')) }
    const size = blockSize(b, {})
    const q = { x: 18, y: 18, ...size }
    const pic = svg('svg', { viewBox: `0 0 ${size.w + 36} ${size.h + 36}`, class: 'ipm-rule-picture',
      width: size.w + 36, height: size.h + 36 })
    pic.append(drawBlock(b, q, {}, '', kind => (kind === 'in' ? 'ipm-open' : '')))
    return pic
  }

  class Task {
    constructor(root, index) {
      this.root = root
      this.key = `ipm-verso:${location.pathname}:${index}`
      this.assumptions = JSON.parse(root.dataset.assumptions)
      this.conclusions = JSON.parse(root.dataset.conclusions)
      this.rules = JSON.parse(root.dataset.rules)
      this.proof = new Proof(this.assumptions, this.conclusions)
      this.undoStack = []
      try {
        const saved = JSON.parse(localStorage.getItem(this.key))
        if (saved?.proof) this.proof.restore(saved.proof)
      } catch {}

      this.canvas = el('div', 'ipm-canvas')
      this.status = el('div', 'ipm-status')
      const tools = el('div', 'ipm-tools')
      const undo = el('button', 'ipm-button', '↶ Undo')
      undo.type = 'button'
      undo.addEventListener('click', () => this.undo())
      const reset = el('button', 'ipm-button', 'Start over')
      reset.type = 'button'
      reset.addEventListener('click', () => { this.change(() => { this.proof = new Proof(this.assumptions, this.conclusions) }) })
      const tidy = el('button', 'ipm-button', 'Tidy up')
      tidy.type = 'button'
      tidy.title = 'Arrange the blocks automatically again'
      tidy.addEventListener('click', () => { this.change(() => { this.proof.moved = {} }) })
      tools.append(undo, reset, tidy, this.status)
      this.sheet = el('div', 'ipm-sheet')
      this.sheet.hidden = true
      root.querySelector('.ipm-board').append(this.canvas, tools, this.sheet)
      this.render()
    }

    change(act) {
      this.undoStack.push(this.proof.snapshot())
      act()
      this.selected = null
      this.closeSheet(false)
      this.render()
    }

    undo() {
      const snap = this.undoStack.pop()
      if (!snap) return
      this.proof.restore(snap)
      this.selected = null
      this.closeSheet(false)
      this.render()
    }

    // ------------------------------------------------------------ layout and drawing

    layout() {
      const p = this.proof
      const layer = {}
      const order = p.blocks.filter(b => b.kind !== 'conclusion')
      for (const b of p.blocks) if (b.kind === 'assumption') layer[b.id] = 0
      // Longest path from the assumptions; unconnected rule blocks go to layer 1.
      for (let round = 0; round < p.blocks.length; round++)
        for (const b of order) {
          if (b.kind === 'assumption') continue
          const preds = p.connections.filter(c => c.to.block === b.id).map(c => layer[c.from.block] ?? 0)
          layer[b.id] = 1 + Math.max(0, ...preds)
        }
      const last = 1 + Math.max(0, ...order.map(b => layer[b.id]))
      for (const b of p.blocks) if (b.kind === 'conclusion') layer[b.id] = Math.max(last, 2)
      const s = this.analysis.s
      const pos = {}
      const rows = {}
      for (const b of p.blocks) (rows[layer[b.id]] ??= []).push(b)
      let width = 320
      const sizes = {}
      for (const b of p.blocks) sizes[b.id] = blockSize(b, s)
      for (const row of Object.values(rows)) width = Math.max(width, row.reduce((w, b) => w + sizes[b.id].w + 24, 24))
      for (const [l, row] of Object.entries(rows)) {
        const total = row.reduce((w, b) => w + sizes[b.id].w, 0) + 24 * (row.length - 1)
        let x = (width - total) / 2
        for (const b of row) {
          pos[b.id] = { x, y: 20 + Number(l) * layerH, ...sizes[b.id] }
          x += sizes[b.id].w + 24
        }
      }
      for (const [id, m] of Object.entries(p.moved ?? {})) if (pos[id]) Object.assign(pos[id], m)
      // The picture covers all blocks, wherever they were dragged.
      const qs = Object.values(pos)
      const minX = Math.min(0, ...qs.map(q => q.x - 20)), minY = Math.min(0, ...qs.map(q => q.y - 20))
      const maxX = Math.max(width, ...qs.map(q => q.x + q.w + 20))
      const maxY = Math.max(20 + (Math.max(...Object.keys(rows).map(Number)) + 1) * layerH, ...qs.map(q => q.y + q.h + 20))
      return { pos, view: [minX, minY, maxX - minX, maxY - minY] }
    }

    portXY(pos, b, kind, i) { return portAt(pos[b.id], b, kind, i) }

    // Blocks can be dragged with mouse, finger or pen. A movement of a few pixels or less counts
    // as a tap. While dragging, the lines at the block follow it; the new position is kept.
    makeDraggable(g, b, pos, paths, tap) {
      // On touch screens the browser would take a drag on a block for scrolling (it ignores
      // `touch-action` on SVG elements). Prevent that; then there is no click either, so a touch
      // without movement is handled as a tap below.
      g.addEventListener('touchstart', e => { if (!e.target.closest('.ipm-port')) e.preventDefault() }, { passive: false })
      g.addEventListener('pointerdown', ev => {
        if (ev.target.closest('.ipm-port') || ev.button > 0) return
        const toSvg = e => {
          const pt = this.svgRoot.createSVGPoint()
          pt.x = e.clientX; pt.y = e.clientY
          return pt.matrixTransform(this.svgRoot.getScreenCTM().inverse())
        }
        const start = toSvg(ev), q = pos[b.id]
        let moved = false, d = { x: 0, y: 0 }
        try { g.setPointerCapture(ev.pointerId) } catch {}
        const move = e => {
          const now = toSvg(e)
          d = { x: now.x - start.x, y: now.y - start.y }
          if (!moved && Math.hypot(d.x, d.y) < 6) return
          moved = true
          g.classList.add('ipm-dragging')
          g.setAttribute('transform', `translate(${d.x},${d.y})`)
          for (const { path, c, a, b: to } of paths) {
            const from = c.from.block === b.id ? { x: a.x + d.x, y: a.y + d.y } : a
            const dest = c.to.block === b.id ? { x: to.x + d.x, y: to.y + d.y } : to
            if (from !== a || dest !== to) path.setAttribute('d', curve(from, dest))
          }
        }
        const up = e => {
          g.removeEventListener('pointermove', move)
          g.removeEventListener('pointerup', up)
          g.removeEventListener('pointercancel', up)
          if (!moved) {
            if (ev.pointerType === 'touch' && e.type === 'pointerup') tap()
            return
          }
          this.justDragged = true
          setTimeout(() => { this.justDragged = false }, 0)
          this.undoStack.push(this.proof.snapshot())
          this.proof.moved = { ...(this.proof.moved ?? {}), [b.id]: { x: q.x + d.x, y: q.y + d.y } }
          this.render()
        }
        g.addEventListener('pointermove', move)
        g.addEventListener('pointerup', up)
        g.addEventListener('pointercancel', up)
      })
    }

    render() {
      const p = this.proof
      this.analysis = p.analyze()
      const { pos, view } = this.layout()
      const s = this.analysis.s
      const root = svg('svg', { viewBox: view.join(' '), class: 'ipm-svg' })
      this.svgRoot = root
      const paths = []  // connection paths, to follow a dragged block
      // connections
      for (const c of p.connections) {
        const a = this.portXY(pos, p.block(c.from.block), 'out', c.from.port)
        const b = this.portXY(pos, p.block(c.to.block), 'in', c.to.port)
        const st = this.analysis.status[c.id]
        const g = svg('g', { class: `ipm-conn ipm-${st}` })
        const path = svg('path', { d: curve(a, b) })
        paths.push({ path, c, a, b })
        g.append(path)
        if (st === 'fail') {
          const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
          const skull = svg('text', { x: m.x, y: m.y + 7, class: 'ipm-skull', 'text-anchor': 'middle' }, '☠')
          skull.addEventListener('click', () => this.explain(c))
          g.append(skull)
        }
        root.append(g)
      }
      // blocks
      const sel = this.selected
      for (const b of p.blocks) {
        const proved = b.kind === 'conclusion' && !this.analysis.openInputs.some(o => o.block === b.id)
        const portClass = (kind, i) => {
          const at = { block: b.id, port: i }
          if (kind === 'in') {
            const open = this.analysis.openInputs.some(o => o.block === b.id && o.port === i)
            return (open ? 'ipm-open ' : '') +
              (sel?.kind === 'in' && sel.block === b.id && sel.port === i ? 'ipm-selected ' : '') +
              (sel?.kind === 'out' && open && this.fits(sel, at) ? 'ipm-candidate' : '')
          }
          return (sel?.kind === 'out' && sel.block === b.id && sel.port === i ? 'ipm-selected ' : '') +
            (sel?.kind === 'in' && this.fits(at, sel) ? 'ipm-candidate' : '')
        }
        const g = drawBlock(b, pos[b.id], s, proved ? 'ipm-proved' : '', portClass)
        for (const port of g.querySelectorAll('.ipm-port')) {
          const i = Number(port.dataset.i)
          port.addEventListener('click', () => port.dataset.kind === 'in' ? this.tapInput(b, i) : this.tapOutput(b, i))
        }
        // Tapping an assumption or a goal is tapping its only port.
        const tap = () => {
          if (b.kind === 'assumption') this.tapOutput(b, 0)
          else if (b.kind === 'conclusion') this.tapInput(b, 0)
          else this.tapBlock(b)
        }
        this.makeDraggable(g, b, pos, paths, tap)
        g.addEventListener('click', ev => {
          if (this.justDragged) { this.justDragged = false; return }
          if (ev.target.closest('.ipm-port')) return
          tap()
        })
        root.append(g)
      }
      this.canvas.replaceChildren(root)
      const qed = this.analysis.qed
      this.root.classList.toggle('ipm-solved', qed)
      const n = this.analysis.openInputs.length
      this.status.textContent = qed ? 'Proof complete ✓' :
        this.selected?.kind === 'in' ? 'Now tap a glowing green dot (or its box)' :
        this.selected?.kind === 'out' ? 'Now tap a glowing green circle' :
        `${n} red circle${n === 1 ? '' : 's'} left — tap one`
      try { localStorage.setItem(this.key, JSON.stringify({ proof: this.proof.snapshot(), solved: qed })) } catch {}
      if (qed) this.onSolved?.()
    }

    // ------------------------------------------------------------ tapping

    // Whether output `o` fits input `i` (both {block, port}) without a cycle.
    fits(o, i) {
      const p = this.proof
      if (o.block === i.block || p.createsCycle(o.block, i.block)) return false
      return !!unify(p.block(o.block).outputs[o.port], p.block(i.block).inputs[i.port], this.analysis.s)
    }

    // Draws a line from output `o` to input `i`; one that does not fit gets a ☠.
    link(o, i) {
      if (o.block === i.block || this.proof.createsCycle(o.block, i.block)) {
        this.status.textContent = 'That would go round in a circle.'
        return
      }
      this.selected = null
      this.change(() => this.proof.connect(o, i))
    }

    tapInput(b, i) {
      const sel = this.selected
      if (sel?.kind === 'out') return this.link(sel, { block: b.id, port: i })
      if (sel?.kind === 'in' && sel.block === b.id && sel.port === i) return this.closeSheet()
      this.selected = { kind: 'in', block: b.id, port: i }
      this.render()
      this.inputMenu(b, i)
    }

    tapOutput(b, j) {
      const sel = this.selected
      if (sel?.kind === 'in') return this.link({ block: b.id, port: j }, sel)
      if (sel?.kind === 'out' && sel.block === b.id && sel.port === j) return this.closeSheet()
      this.selected = { kind: 'out', block: b.id, port: j }
      this.render()
      this.outputMenu(b, j)
    }

    // A rule block: completes a pending selection with its fitting port, or offers to remove it.
    tapBlock(b) {
      const sel = this.selected
      if (sel?.kind === 'in') {
        const j = b.outputs.findIndex((_, j) => this.fits({ block: b.id, port: j }, sel))
        return this.link({ block: b.id, port: Math.max(j, 0) }, sel)
      }
      if (sel?.kind === 'out') {
        const open = this.analysis.openInputs.filter(o => o.block === b.id)
        const target = open.find(o => this.fits(sel, o)) ?? open[0] ?? { block: b.id, port: 0 }
        return this.link(sel, target)
      }
      this.blockMenu(b)
    }

    // ------------------------------------------------------------ menus

    closeSheet(rerender = true) {
      this.sheet.hidden = true
      this.sheet.replaceChildren()
      if (this.selected) {
        this.selected = null
        if (rerender) this.render()
      }
    }

    // The sheet shows one line (title, number of new blocks) and folds out on tap. It starts
    // unfolded only when `unfold` is set, i.e. when nothing in the picture fits.
    openSheet(title, options, hint, unfold = true) {
      const n = options.filter(o => /block$/.test(o.detail ?? '')).length
      const head = el('div', 'ipm-sheet-head')
      const toggle = el('span', 'ipm-sheet-toggle')
      head.append(el('div', 'ipm-sheet-title', title), toggle)
      const body = el('div', 'ipm-sheet-body')
      if (hint) body.append(el('div', 'ipm-sheet-hint', hint))
      for (const o of options) {
        if (o.section) { body.append(el('div', 'ipm-sheet-section', o.section)); continue }
        const b = el('button', 'ipm-option' + (o.bad ? ' ipm-bad' : '') + (o.picture ? ' ipm-option-picture' : ''))
        b.type = 'button'
        if (o.picture) { b.append(o.picture); b.title = o.label }
        else b.append(el('span', 'ipm-option-main', o.label))
        if (o.detail) b.append(el('span', 'ipm-option-detail', o.detail))
        b.addEventListener('click', o.act)
        body.append(b)
      }
      const close = el('button', 'ipm-option ipm-close', 'Cancel')
      close.type = 'button'
      close.addEventListener('click', () => this.closeSheet())
      body.append(close)
      const setFolded = folded => {
        this.sheet.classList.toggle('ipm-folded', folded)
        toggle.textContent = folded ? `${n ? `${n} rule${n === 1 ? '' : 's'} ` : 'more '}▸` : 'less ▾'
      }
      head.addEventListener('click', () => setFolded(!this.sheet.classList.contains('ipm-folded')))
      this.sheet.replaceChildren(head, body)
      setFolded(!unfold)
      this.sheet.hidden = false
      this.sheet.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }

    // The rules, shown generically (`∧I  ?1, ?2 ⟹ ?1 ∧ ?2`) so that they do not give anything away.
    // Choosing one only adds the block; the player then connects it, and the current selection stays.
    ruleOptions() {
      return this.rules.map(name => {
        const r = RULES[name]
        const generic = x => show(instantiate(parse(x), r.vars, 'rule'))
        return {
          picture: rulePicture(name),
          label: `${r.label}  ${r.inputs.map(generic).join(', ')} ⟹ ${r.outputs.map(generic).join(', ')}`,
          detail: `${r.name} block`,
          act: () => {
            this.undoStack.push(this.proof.snapshot())
            this.proof.addRule(name)
            this.sheet.hidden = true
            this.render()
          },
        }
      })
    }

    inputMenu(b, i) {
      const p = this.proof, s = this.analysis.s
      const options = this.ruleOptions()
      const connected = p.connections.find(c => c.to.block === b.id && c.to.port === i)
      if (connected) options.push({ label: 'Disconnect', act: () => { this.selected = null; this.change(() => { p.connections = p.connections.filter(c => c !== connected) }) } })
      this.openSheet(`Prove ${show(b.inputs[i], s)}`, options,
        'Tap a blue dot in the picture, or add a block and connect it:', false)
    }

    outputMenu(b, j) {
      const s = this.analysis.s
      this.openSheet(`Use ${show(b.outputs[j], s)}`, this.ruleOptions(),
        'Tap a red circle in the picture, or add a block and connect it:', false)
    }

    blockMenu(b) {
      this.openSheet(RULES[b.rule].name, [
        { label: 'Remove this block', act: () => this.change(() => this.proof.removeBlock(b.id)) },
      ])
    }

    explain(c) {
      const p = this.proof, s = this.analysis.s
      const out = p.block(c.from.block).outputs[c.from.port], inp = p.block(c.to.block).inputs[c.to.port]
      this.openSheet(`☠ ${show(out, s)} does not fit ${show(inp, s)}`, [
        { label: 'Remove this connection', act: () => this.change(() => { p.connections = p.connections.filter(x => x !== c) }) },
      ])
    }
  }

  // Tasks on a page are revealed one at a time, like the steps of a lesson.
  function init() {
    const tasks = [...document.querySelectorAll('.ipm-task')].map((root, i) => new Task(root, i))
    tasks.forEach((t, i) => t.root.prepend(el('div', 'ipm-task-label', `Task ${i + 1} of ${tasks.length}`)))
    const update = scroll => {
      const open = tasks.findIndex(t => !t.root.classList.contains('ipm-solved'))
      tasks.forEach((t, i) => t.root.classList.toggle('ipm-locked', open >= 0 && i > open))
      if (scroll && open >= 0) tasks[open].root.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    tasks.forEach(t => {
      t.onSolved = () => {
        if (t.reported) return
        t.reported = true
        setTimeout(() => update(true), 1200)
      }
      if (t.root.classList.contains('ipm-solved')) t.reported = true
    })
    update(false)
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
