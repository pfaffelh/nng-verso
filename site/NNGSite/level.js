// Client for the lean4game relay, embedded into Verso pages by `Block.nngLevel`.
//
// Each `.nng-level` element is one playable level. The page keeps one WebSocket connection to the
// relay; since the relay maps every document to the same file on the server, only one level is
// open on the server at a time. Activating another level closes the previous document.
//
// Protocol (see lean4game `relay/src/serverProcess.ts`): plain LSP JSON-RPC, one message per
// WebSocket frame. The document URI `file:///<World>/<Level>.lean` tells the relay which level to
// load; the document text is just the player's tactic proof. Goals, hints and diagnostics come
// from the RPC method `Game.getProofState`.
//
// For beginners, the page also offers: a palette that inserts tactics and theorems, clickable
// hypothesis names, highlighting of what the current line changed, explanations of common error
// messages, and translated hints.

(function () {
  'use strict'

  // Set at render time via `NNG_RELAY_URL` (as `data-relay`); a path refers to the page's own host.
  function relayUrl() {
    const url = window.nngRelayUrl ?? document.querySelector('.nng-level')?.dataset.relay ??
      `ws://${location.hostname || 'localhost'}:8080/websocket/g/local/nng4`
    if (!url.startsWith('/')) return url
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${url}`
  }

  // ---------------------------------------------------------------- connection

  class Connection {
    constructor(url) {
      this.url = url
      this.nextId = 0
      this.pending = new Map()
      this.ready = this.open()
    }

    open() {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(this.url)
        this.ws = ws
        ws.onmessage = ev => this.receive(JSON.parse(ev.data))
        ws.onerror = () => reject(new Error(`Cannot connect to ${this.url}`))
        ws.onclose = () => {
          for (const p of this.pending.values()) p.reject(new Error('Connection closed'))
          this.pending.clear()
          this.closed = true
        }
        ws.onopen = async () => {
          try {
            await this.request('initialize', {
              processId: null, rootUri: null, capabilities: {},
              // An empty inventory means: exactly what the level data marks as unlocked.
              initializationOptions: { difficulty: 1, inventory: [] },
            })
            this.notify('initialized', {})
            resolve()
          } catch (e) { reject(e) }
        }
      })
    }

    send(msg) { this.ws.send(JSON.stringify({ jsonrpc: '2.0', ...msg })) }
    notify(method, params) { this.send({ method, params }) }

    request(method, params) {
      const id = this.nextId++
      this.send({ id, method, params })
      return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
    }

    receive(msg) {
      if (msg.id !== undefined && !msg.method) {
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        msg.error ? p.reject(msg.error) : p.resolve(msg.result)
      } else if (msg.id !== undefined) {
        // Requests from the server (e.g. capability registration) need an answer.
        this.send({ id: msg.id, result: null })
      }
    }
  }

  let connection = null
  let activeLevel = null

  async function getConnection() {
    if (!connection || connection.closed) connection = new Connection(relayUrl())
    await connection.ready
    return connection
  }

  // ---------------------------------------------------------------- translations

  // Same lookup as `NNGSite.translate` and lean4game's `useGameTranslation`: code spans and math
  // are replaced by placeholders `§n` before looking up the text in the catalogue.
  let catalogue = null
  function loadCatalogue(lang) {
    if (lang === 'en') return Promise.resolve({})
    catalogue ??= fetch(new URL('-verso-data/nng-i18n.json', document.baseURI))
      .then(r => r.ok ? r.json() : {})
      .catch(() => ({}))
    return catalogue
  }

  function translate(cat, text) {
    const blocks = []
    const key = text.replace(/((?<!\\)(`+|\${1,2})([\s\S]*?)\2)/g, m => {
      blocks.push(m)
      return `§${blocks.length - 1}`
    })
    const t = [key.replace(/\\/g, '\\\\'), key, text].map(k => cat[k]).find(x => x)
    return t ? t.replace(/(?<!\\)§(\d+)/g, (_, n) => blocks[Number(n)] ?? n) : text
  }

  // Hints contain placeholders `«{x}»` for variable names chosen by the player.
  function hintText(cat, hint) {
    if (!hint.rawText) return hint.text
    return translate(cat, hint.rawText).replace(/«\{(.*?)\}»/g, (_, v) =>
      hint.varNames.find(x => x[0] === v)?.[1] ?? v)
  }

  // ---------------------------------------------------------------- explaining errors

  // Lean's messages are precise but terse; these explain the most common ones to beginners.
  const explanations = [
    [/unexpected identifier; expected '\['/,
      'With `rw`, the equations go in square brackets, for example `rw [h]`.'],
    [/expected '\]'/, 'The closing bracket `]` is missing.'],
    [/Did not find an occurrence of the pattern|did not find instance of the pattern/i,
      '`rw` could not find the left-hand side of the equation in the goal. Does it appear exactly like this? ' +
      'To rewrite in the other direction, write `rw [← …]`.'],
    [/Tactic `rfl` failed|The rfl tactic failed/,
      '`rfl` only works if both sides are exactly the same. Rewrite the goal with `rw` first.'],
    [/No goals to be solved|no goals to be proved/i,
      'Everything is already proved here – this line is not needed and can be removed.'],
    [/unknown tactic/, 'Lean does not know this tactic. A typo? The available tactics are listed above.'],
    [/You have not unlocked the tactic '(.+?)'/, 'The tactic `$1` is not available yet in this level.'],
    [/The tactic '(.+?)' is disabled in this level/, 'The tactic `$1` is disabled in this level.'],
    [/unknown (?:identifier|constant) '(.+?)'/i, 'Lean does not know the name `$1`. A typo?'],
    [/expected command/,
      'Wrong indentation: a tactic must be indented exactly as far as the line before it.'],
    [/Type mismatch/i, 'This expression does not have the form the goal requires.'],
    [/unexpected token|unexpected end of input/, 'Lean cannot read this line (syntax error).'],
  ]

  function explain(message) {
    for (const [re, text] of explanations) {
      const m = message.match(re)
      if (m) return text.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? '')
    }
    return null
  }

  // ---------------------------------------------------------------- rendering helpers

  const el = (tag, cls, text) => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text !== undefined) e.textContent = text
    return e
  }

  // Flatten Lean's `TaggedText` (interactive code) into a plain string.
  const taggedText = t =>
    t == null ? '' :
    typeof t === 'string' ? t :
    t.text !== undefined ? t.text :
    t.append ? t.append.map(taggedText).join('') :
    t.tag ? taggedText(t.tag[1]) : ''

  // A small Markdown subset for hints and explanations: `code`, $math$ and line breaks.
  function renderText(text, cls) {
    const div = el('div', cls)
    text.split(/(`[^`]+`|\$[^$]+\$)/).forEach(part => {
      if (/^`[^`]+`$/.test(part)) div.appendChild(el('code', null, part.slice(1, -1)))
      else if (/^\$[^$]+\$$/.test(part)) div.appendChild(el('span', 'nng-math', part.slice(1, -1)))
      else div.appendChild(document.createTextNode(part))
    })
    return div
  }

  // Goals as Lean prints them in messages ("case x", hypotheses "a b : ℕ", "⊢ target").
  function parseGoals(text) {
    return text.split(/\n\s*\n/).filter(block => block.trim()).map(block => {
      const goal = { hyps: [], goalPrefix: '⊢ ', type: { text: '' } }
      let inTarget = false
      for (const line of block.split('\n')) {
        if (!inTarget && line.startsWith('case ')) goal.userName = line.slice(5).trim()
        else if (line.startsWith('⊢')) { goal.type.text = line.slice(1).trim(); inTarget = true }
        else if (inTarget) goal.type.text += ' ' + line.trim()
        else {
          const m = line.match(/^(.+?) : (.*)$/)
          if (m) goal.hyps.push({ names: m[1].split(' '), type: { text: m[2] } })
          else if (goal.hyps.length) goal.hyps[goal.hyps.length - 1].type.text += ' ' + line.trim()
        }
      }
      return { goal, hints: [] }
    })
  }

  // Tokens of a goal, for highlighting what a step changed.
  const tokenize = s => s.match(/\s+|[()]|[^\s()]+/g) ?? []

  // Marks the tokens of `cur` that are not part of a longest common subsequence with `prev`.
  function changedTokens(prev, cur) {
    const a = tokenize(prev), b = tokenize(cur)
    const n = a.length, m = b.length
    const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
    const changed = new Array(m).fill(true)
    for (let i = 0, j = 0; i < n && j < m;) {
      if (a[i] === b[j]) { changed[j] = false; i++; j++ }
      else if (L[i + 1][j] >= L[i][j + 1]) i++
      else j++
    }
    return b.map((t, j) => [t, changed[j] && t.trim() !== ''])
  }

  function renderExpr(text, previous) {
    const span = el('span', 'nng-expr')
    if (previous === undefined || previous === text) {
      span.textContent = text
      return span
    }
    for (const [t, changed] of changedTokens(previous, text))
      span.appendChild(changed ? el('mark', 'nng-changed', t) : document.createTextNode(t))
    return span
  }

  // Lean's abbreviations for the most common symbols in the game.
  const abbreviations = {
    l: '←', '<-': '←', r: '→', to: '→', '->': '→', ne: '≠', le: '≤', ge: '≥',
    N: 'ℕ', and: '∧', or: '∨', not: '¬', '.': '·', forall: '∀', exists: '∃', iff: '↔',
  }

  // What the palette inserts for a tactic; `|` marks the position of the cursor afterwards.
  const tacticTemplates = {
    rw: 'rw [|]', nth_rewrite: 'nth_rewrite 1 [|]', repeat: 'repeat rw [|]',
    induction: 'induction | with d hd', cases: 'cases |', exact: 'exact |', apply: 'apply |',
    intro: 'intro |', use: 'use |', have: 'have h : | := ', contrapose: 'contrapose! |',
  }

  // ---------------------------------------------------------------- one level

  class Level {
    constructor(root) {
      this.root = root
      this.world = root.dataset.world
      this.level = Number(root.dataset.level)
      this.lang = root.dataset.lang ?? 'en'
      this.uri = `file:///${this.world}/${this.level}.lean`
      this.storageKey = `nng-verso:${this.world}:${this.level}`
      this.version = 0
      this.lastState = null
      this.catalogue = {}
      loadCatalogue(this.lang).then(c => { this.catalogue = c; this.renderState() })

      this.editor = root.querySelector('.nng-editor')
      this.status = root.querySelector('.nng-status')
      this.goals = root.querySelector('.nng-goals')
      this.hints = root.querySelector('.nng-hints')
      this.messages = root.querySelector('.nng-messages')
      this.conclusion = root.querySelector('.nng-conclusion')
      // Theorems with their statements, which decide between `rw`, `apply` and `exact`.
      this.lemmaTypes = new Map([...root.querySelectorAll('.nng-lemma')]
        .map(b => [b.dataset.insert, b.dataset.type ?? '']))
      this.lemmas = new Set(this.lemmaTypes.keys())
      this.undoStack = []
      this.lastTyped = 0
      this.lastEditWasDelete = false

      const saved = this.load()
      this.editor.value = saved.code ?? ''
      if (saved.completed) this.markCompleted()

      this.editor.addEventListener('focus', () => this.activate())
      this.editor.addEventListener('beforeinput', ev => {
        // Typing is undone in bursts: remember the text before a pause.
        if (Date.now() - this.lastTyped > 1500) this.pushUndo()
        this.lastTyped = Date.now()
        this.lastEditWasDelete = ev.inputType.startsWith('delete')
      })
      this.editor.addEventListener('input', () => this.onInput())
      this.editor.addEventListener('keydown', ev => this.onKeyDown(ev))
      this.editor.addEventListener('keyup', () => this.renderState())
      this.editor.addEventListener('click', () => this.renderState())
      for (const b of root.querySelectorAll('.nng-insert, .nng-undo, .nng-newline')) {
        // Keep the cursor in the editor when clicking a button.
        b.addEventListener('mousedown', ev => ev.preventDefault())
        b.addEventListener('click', () => {
          this.lastEditWasDelete = false
          // A typed abbreviation such as `\l` counts, even without the space after it.
          this.expandAbbreviation(true)
          if (b.classList.contains('nng-undo')) this.undo()
          else if (b.classList.contains('nng-newline')) this.insertNewline()
          else if (b.classList.contains('nng-tactic')) this.insertTactic(this.template(b.dataset.insert))
          else if (b.classList.contains('nng-lemma')) this.insertName(b.dataset.insert, b.dataset.type ?? '')
          else if (b.dataset.insert === '←') this.insertArrow()
          else if (b.dataset.insert === '·') this.insertBullet()
          else if (b.dataset.insert === 'at') this.insertAt()
        })
      }
    }

    load() {
      try { return JSON.parse(localStorage.getItem(this.storageKey)) ?? {} } catch { return {} }
    }
    save(patch) {
      try { localStorage.setItem(this.storageKey, JSON.stringify({ ...this.load(), ...patch })) } catch {}
    }

    setStatus(text, cls) {
      this.status.textContent = text
      this.status.className = 'nng-status' + (cls ? ' ' + cls : '')
    }

    // ------------------------------------------------------------ editing

    // Changes made by the page are not in the browser's undo history, so we keep our own.
    pushUndo() {
      const v = this.editor.value
      if (this.undoStack[this.undoStack.length - 1] !== v) this.undoStack.push(v)
      if (this.undoStack.length > 200) this.undoStack.shift()
    }

    undo() {
      const v = this.undoStack.pop()
      if (v === undefined) return
      const ed = this.editor
      ed.value = v
      ed.focus()
      ed.selectionStart = ed.selectionEnd = v.replace(/\s*$/, '').length
      // Do not immediately re-add structure the player just removed.
      this.lastEditWasDelete = true
      this.onInput()
    }

    // The current line: its start, end and text.
    currentLine() {
      const ed = this.editor, value = ed.value
      const start = value.lastIndexOf('\n', ed.selectionStart - 1) + 1
      let end = value.indexOf('\n', ed.selectionStart)
      if (end < 0) end = value.length
      return { start, end, text: value.slice(start, end) }
    }

    // Replaces the selection by `text`; a `|` in `text` marks where the cursor ends up.
    insertAtCursor(text) {
      const ed = this.editor
      this.pushUndo()
      const caret = text.indexOf('|')
      const clean = text.replace('|', '')
      const start = ed.selectionStart, end = ed.selectionEnd
      ed.value = ed.value.slice(0, start) + clean + ed.value.slice(end)
      const pos = start + (caret >= 0 ? caret : clean.length)
      ed.focus()
      ed.selectionStart = ed.selectionEnd = pos
      this.onInput()
    }

    // Keeps an empty line at the end, so that Lean reports the goals left at the end of the
    // proof there and not on the last tactic (see `autoStructure`).
    ensureTrailingNewline() {
      const ed = this.editor
      if (ed.value.endsWith('\n')) return
      const pos = ed.selectionStart
      ed.value += '\n'
      ed.selectionStart = ed.selectionEnd = pos
    }

    // Inserts a tactic on the current line if it is empty, else on a new line below. Indentation
    // matters in Lean: a `·` block continues with the indentation of its content.
    insertTactic(template) {
      const ed = this.editor
      const { start, end, text } = this.currentLine()
      const indentOf = l => l.match(/^\s*(?:·\s*)?/)[0].replace('·', ' ')
      ed.focus()
      if (/^\s*·\s*$/.test(text)) {
        // A bullet without tactic: continue on the same line.
        ed.selectionStart = ed.selectionEnd = end
        this.insertAtCursor((text.endsWith(' ') ? '' : ' ') + template)
      } else if (text.trim() === '') {
        const above = ed.value.slice(0, start).split('\n').reverse().find(l => l.trim() !== '') ?? ''
        ed.selectionStart = start
        ed.selectionEnd = end
        this.insertAtCursor(indentOf(above) + template)
      } else {
        ed.selectionStart = ed.selectionEnd = end
        this.insertAtCursor('\n' + indentOf(text) + template)
      }
      this.ensureTrailingNewline()
    }

    // Names of hypotheses in the goal currently shown.
    shownNames() {
      return new Set([...this.goals.querySelectorAll('.nng-hyp-name')].map(b => b.textContent))
    }

    // The template of a tactic; `induction` gets names that are not in use yet.
    template(tactic, variable = '|') {
      if (tactic === 'induction') {
        const used = this.shownNames()
        const n = ['d', 'e', 'f', 'k', 'm', 'p', 'q'].find(x => !used.has(x) && !used.has('h' + x)) ?? 'd'
        return `induction ${variable} with ${n} h${n}`
      }
      return tacticTemplates[tactic] ?? tactic
    }

    // Inserts the name of a theorem or hypothesis. On an empty line, it becomes a whole tactic:
    // `rw [h]` for an equation, `apply h` for an implication, `exact h` otherwise. Inside `[...]`
    // names are separated by commas.
    insertName(name, type = '') {
      const ed = this.editor
      const { start } = this.currentLine()
      const lineBefore = ed.value.slice(start, ed.selectionStart)
      const before = ed.value.slice(0, ed.selectionStart)
      const openBracket = before.lastIndexOf('['), closeBracket = before.lastIndexOf(']')
      const inBrackets = openBracket > closeBracket && !before.slice(openBracket).includes('\n')
      // Is the cursor where a tactic expects a name? Otherwise the name starts a new tactic.
      const expectsName = inBrackets ||
        /(^|\s)(exact|apply|intro|use|cases|induction|at|have|contrapose!?)\s+$/.test(lineBefore)
      if (!expectsName) {
        // The statement after the last top-level ` : ` (theorems carry their parameters).
        let depth = 0, cut = 0
        for (let i = 0; i < type.length; i++) {
          if ('([{'.includes(type[i])) depth++
          else if (')]}'.includes(type[i])) depth--
          else if (depth === 0 && type.startsWith(' : ', i)) cut = i + 3
        }
        const statement = type.slice(cut)
        // A natural number: start an induction on it, if that is available.
        if (statement.trim() === 'ℕ') {
          if (this.root.querySelector('.nng-tactic[data-insert="induction"]'))
            return this.insertTactic(this.template('induction', name))
          return this.insertAtCursor(name)
        }
        const tactic = /→/.test(statement) ? `apply ${name}`
          : /(^|[^≠<>≤≥!])=/.test(statement) ? `rw [${name}]` : `exact ${name}`
        return this.insertTactic(tactic)
      }
      let insert = name
      if (inBrackets && !/[\[,]\s*(←\s*)?$/.test(before)) insert = ', ' + name
      else if (!inBrackets && /\S$/.test(before) && !/[\[(]$/.test(before)) insert = ' ' + name
      this.insertAtCursor(insert)
    }

    // `←` for a rewrite rule: at the end of a rule it starts the next one (`, ← `); inside or
    // before a rule it reverses that rule. Behind `rw [...]` it adds a rule at the end.
    insertArrow() {
      const ed = this.editor
      const { start, end, text } = this.currentLine()
      let before = ed.value.slice(0, ed.selectionStart)
      let inBrackets = before.lastIndexOf('[') > before.lastIndexOf(']') &&
        !before.slice(before.lastIndexOf('[')).includes('\n')
      const closing = text.lastIndexOf(']')
      if (!inBrackets && closing >= 0 && ed.selectionStart >= start + closing + 1) {
        // Behind the brackets: continue inside them.
        ed.selectionStart = ed.selectionEnd = start + closing
        before = ed.value.slice(0, ed.selectionStart)
        inBrackets = true
      }
      if (!inBrackets) return this.insertAtCursor('← ')
      const itemStart = Math.max(before.lastIndexOf('['), before.lastIndexOf(',')) + 1
      const item = before.slice(itemStart)
      const after = ed.value.slice(ed.selectionStart, end)
      if (item.trim() === '') return this.insertAtCursor(/\s$/.test(before) || before.endsWith('[') ? '← ' : ' ← ')
      if (/^\s*[\],]/.test(after) || after.trim() === '') return this.insertAtCursor(', ← ')
      // Inside a rule: reverse it, unless it is reversed already.
      if (/^\s*←/.test(item)) return
      const caretFromEnd = ed.value.length - ed.selectionStart
      ed.selectionStart = ed.selectionEnd = itemStart + item.match(/^\s*/)[0].length
      this.insertAtCursor('← ')
      ed.selectionStart = ed.selectionEnd = ed.value.length - caretFromEnd
    }

    // Like the Enter key: a new line with the indentation of the current line's tactic.
    insertNewline() {
      const ed = this.editor
      const { start } = this.currentLine()
      const lineBefore = ed.value.slice(start, ed.selectionStart)
      this.insertAtCursor('\n' + lineBefore.match(/^\s*(?:·\s*)?/)[0].replace('·', ' '))
    }

    // A new `·` line: on the current empty line, or below the current line.
    insertBullet() {
      const ed = this.editor
      const { start, end, text } = this.currentLine()
      const indent = l => l.match(/^\s*/)[0]
      if (text.trim() === '') {
        const above = ed.value.slice(0, start).split('\n').reverse().find(l => l.trim() !== '') ?? ''
        ed.selectionStart = start
        ed.selectionEnd = end
        this.insertAtCursor(indent(above) + '· ')
      } else if (!/^\s*·\s*$/.test(text)) {
        ed.selectionStart = ed.selectionEnd = end
        this.insertAtCursor('\n' + indent(text) + '· ')
      }
    }

    // ` at ` at the end of the current line, e.g. for `rw [h] at h2`.
    insertAt() {
      const ed = this.editor
      const { end, text } = this.currentLine()
      ed.selectionStart = ed.selectionEnd = end
      this.insertAtCursor(/\sat\s*$/.test(text) ? '' : (text.endsWith(' ') ? 'at ' : ' at '))
    }

    // Brackets close themselves.
    onKeyDown(ev) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return
      const ed = this.editor
      const pairs = { '[': ']', '(': ')' }
      const s = ed.selectionStart, e = ed.selectionEnd, next = ed.value[s], prev = ed.value[s - 1]
      if (pairs[ev.key] && s === e) {
        ev.preventDefault()
        this.lastEditWasDelete = false
        this.insertAtCursor(ev.key + '|' + pairs[ev.key])
      } else if ((ev.key === ']' || ev.key === ')') && s === e && next === ev.key) {
        ev.preventDefault()
        ed.selectionStart = ed.selectionEnd = s + 1
      } else if (ev.key === 'Backspace' && s === e && pairs[prev] && next === pairs[prev]) {
        ev.preventDefault()
        this.lastEditWasDelete = true
        ed.selectionStart = s - 1
        ed.selectionEnd = s + 1
        this.insertAtCursor('')
      }
    }

    // Replaces `\l` etc. before the cursor once a space or bracket follows; with `pending`, also
    // without (before a button inserts something).
    expandAbbreviation(pending = false) {
      const pos = this.editor.selectionStart
      const before = this.editor.value.slice(0, pos)
      const m = before.match(pending ? /\\([A-Za-z]+|<-|->|\.)()$/ : /\\([A-Za-z]+|<-|->|\.)([\s\],)])$/)
      if (!m || !(m[1] in abbreviations)) return
      const replacement = abbreviations[m[1]] + (m[2] || (pending ? ' ' : ''))
      const start = pos - m[0].length
      this.editor.value = before.slice(0, start) + replacement + this.editor.value.slice(pos)
      this.editor.selectionStart = this.editor.selectionEnd = start + replacement.length
    }

    onInput() {
      this.expandAbbreviation()
      this.save({ code: this.editor.value })
      clearTimeout(this.debounce)
      this.debounce = setTimeout(() => this.sendChange(), 400)
    }

    // ------------------------------------------------------------ talking to Lean

    async activate() {
      if (activeLevel === this) return
      const previous = activeLevel
      activeLevel = this
      this.setStatus('Connecting to Lean …', 'nng-busy')
      try {
        const conn = await getConnection()
        if (previous && previous.opened) {
          conn.notify('textDocument/didClose', { textDocument: { uri: previous.uri } })
          previous.opened = false
          previous.setStatus('Paused – click into the editor to continue.')
        }
        this.version = 1
        this.sentText = this.editor.value
        conn.notify('textDocument/didOpen', {
          textDocument: { uri: this.uri, languageId: 'lean4', version: this.version, text: this.sentText },
        })
        this.opened = true
        const { sessionId } = await conn.request('$/lean/rpc/connect', { uri: this.uri })
        this.sessionId = sessionId
        clearInterval(this.keepAlive)
        this.keepAlive = setInterval(() => {
          if (this.opened && !conn.closed)
            conn.notify('$/lean/rpc/keepAlive', { uri: this.uri, sessionId })
        }, 10000)
        await this.check()
      } catch (e) {
        activeLevel = null
        this.setStatus(`No connection to the Lean server (${e.message ?? e}).`, 'nng-error')
      }
    }

    async sendChange() {
      if (activeLevel !== this || !this.opened) return this.activate()
      const conn = await getConnection()
      // The relay prepends a header to the document on `didOpen` and shifts all line numbers,
      // so changes must replace a range of the proof instead of the whole document.
      const oldLines = this.sentText.split('\n')
      const end = { line: oldLines.length - 1, character: oldLines[oldLines.length - 1].length }
      this.sentText = this.editor.value
      this.version += 1
      conn.notify('textDocument/didChange', {
        textDocument: { uri: this.uri, version: this.version },
        contentChanges: [{ range: { start: { line: 0, character: 0 }, end }, text: this.sentText }],
      })
      await this.check()
    }

    async check() {
      const conn = await getConnection()
      const version = this.version
      this.setStatus('Lean is checking …', 'nng-busy')
      const pos = { line: 0, character: 0 }
      let state
      try {
        state = await conn.request('$/lean/rpc/call', {
          method: 'Game.getProofState', sessionId: this.sessionId,
          textDocument: { uri: this.uri }, position: pos,
          params: { textDocument: { uri: this.uri }, position: pos, worldId: this.world, levelId: this.level },
        })
      } catch (e) {
        this.setStatus(`Request failed: ${e.message ?? JSON.stringify(e)}`, 'nng-error')
        return
      }
      if (version !== this.version || !state) return // outdated answer
      this.lastState = state
      if (state.completed) {
        this.setStatus('Level solved! 🎉', 'nng-done')
        this.markCompleted()
        this.save({ completed: true })
      } else {
        this.setStatus('')
      }
      this.renderState()
      this.autoStructure(state)
    }

    // ------------------------------------------------------------ automatic `·` structure

    // Called with each new proof state. When the last tactic split a goal into several cases,
    // starts a `·` line for the first case; when a case is solved, starts the next one.
    //
    // What the game server reports: an unfinished `·` block gets an "unsolved goals" error on its
    // `·` line listing the goals left in it (one `⊢` each); goals left at the end of the proof are
    // reported on the last line, which is kept empty for this reason (`ensureTrailingNewline`). The
    // number of cases of a group of `·` blocks is the number of goals right before its first `·`.
    autoStructure(state) {
      const ed = this.editor
      if (state.completed || this.lastEditWasDelete || document.activeElement !== ed) return
      if (!ed.value.endsWith('\n')) return
      const lines = ed.value.split('\n')
      let last = lines.length - 1
      while (last >= 0 && lines[last].trim() === '') last--
      if (last < 0 || /^\s*·\s*$/.test(lines[last])) return
      // Only when the player is working at the end of the proof.
      if (ed.value.slice(0, ed.selectionStart).split('\n').length - 1 < last) return

      const indent = l => l.match(/^\s*/)[0].length
      const content = l => l.match(/^\s*(?:·\s*)?/)[0].length
      const isBullet = l => /^\s*·/.test(l)
      const diags = [...state.diagnostics, ...state.steps.flatMap(s => s.diags)]
      const unsolved = d => /^unsolved goals/.test(taggedText(d.message))
      // A real error (not just open goals) means the player has something to fix first.
      if (diags.some(d => d.severity === 1 && !unsolved(d))) return
      const openGoalsAt = j => Math.max(0, ...diags.filter(d => d.range.start.line === j && unsolved(d))
        .map(d => (taggedText(d.message).match(/⊢/g) ?? []).length))
      const goalsBefore = j => {
        let g = state.steps[0]?.goals.length ?? 0
        for (const s of state.steps) if (s.line <= j) g = s.goals.length
        return g
      }
      // The `·` line opening the block whose content starts in column `col`, searching up from j.
      const opener = (j, col) => {
        for (let i = j; i >= 0; i--) {
          const l = lines[i]
          if (l.trim() === '') continue
          if (isBullet(l) && content(l) === col) return i
          if (indent(l) < col) return -1
        }
        return -1
      }
      const append = text => {
        this.pushUndo()
        ed.value = ed.value.replace(/\s*$/, '') + text
        ed.selectionStart = ed.selectionEnd = ed.value.length
        this.onInput()
      }

      let b = isBullet(lines[last]) ? last : opener(last, indent(lines[last]))
      if (b < 0) {
        // Top level: the last tactic created several goals.
        if (goalsBefore(last + 1) > Math.max(1, goalsBefore(last)))
          append('\n' + ' '.repeat(content(lines[last])) + '· ')
        return
      }
      for (;;) {
        const open = openGoalsAt(b)
        if (open >= 2) return append('\n' + ' '.repeat(content(lines[b])) + '· ')
        if (open === 1) return
        // This case is solved. Count the cases of its group and the `·` blocks so far.
        let first = b
        for (let i = b - 1; i >= 0; i--) {
          const l = lines[i]
          if (l.trim() === '' || indent(l) > indent(lines[b])) continue
          if (isBullet(l) && indent(l) === indent(lines[b])) { first = i; continue }
          break
        }
        const cases = goalsBefore(first)
        const done = lines.slice(first, b + 1).filter(l => isBullet(l) && indent(l) === indent(lines[b])).length
        if (done < cases) return append('\n' + ' '.repeat(indent(lines[b])) + '· ')
        // All cases of the group are solved, and with them the enclosing case.
        b = opener(first - 1, indent(lines[b]))
        if (b < 0) return
      }
    }

    markCompleted() {
      this.root.classList.add('nng-completed')
      if (this.conclusion) this.conclusion.hidden = false
    }

    // ------------------------------------------------------------ rendering

    renderGoal(g, previous) {
      const box = el('div', 'nng-goal')
      if (g.userName) box.appendChild(el('div', 'nng-case', `case ${g.userName}`))
      const oldHyps = new Map()
      for (const h of previous?.hyps ?? [])
        for (const n of h.names) oldHyps.set(n, taggedText(h.type))
      for (const h of g.hyps) {
        const type = taggedText(h.type)
        const row = el('div', 'nng-hyp')
        h.names.forEach((n, i) => {
          if (i > 0) row.appendChild(document.createTextNode(' '))
          const b = el('button', 'nng-hyp-name', n)
          b.type = 'button'
          b.title = 'Click to insert'
          b.addEventListener('mousedown', ev => ev.preventDefault())
          b.addEventListener('click', () => { this.lastEditWasDelete = false; this.insertName(n, type) })
          row.appendChild(b)
        })
        row.appendChild(document.createTextNode(' : '))
        const old = h.names.map(n => oldHyps.get(n)).find(t => t !== undefined)
        if (previous && old === undefined) row.classList.add('nng-new-hyp')
        row.appendChild(renderExpr(type, previous ? old : undefined))
        box.appendChild(row)
      }
      const target = el('div', 'nng-target', g.goalPrefix ?? '⊢ ')
      target.appendChild(renderExpr(taggedText(g.type), previous ? taggedText(previous.type) : undefined))
      box.appendChild(target)
      return box
    }

    // If the cursor is at the end of a `·` block that is not finished, the goals left in it,
    // parsed from the "unsolved goals" error on its `·` line.
    openBlockGoals(state, cursorLine) {
      const lines = this.editor.value.split('\n')
      const indent = l => l.match(/^\s*/)[0].length
      const content = l => l.match(/^\s*(?:·\s*)?/)[0].length
      const isBullet = l => /^\s*·/.test(l)
      let j = Math.min(cursorLine, lines.length - 1)
      while (j > 0 && lines[j].trim() === '') j--
      let b = -1
      if (isBullet(lines[j])) b = j
      else for (let i = j; i >= 0; i--) {
        if (lines[i].trim() === '') continue
        if (isBullet(lines[i]) && content(lines[i]) === indent(lines[j])) { b = i; break }
        if (indent(lines[i]) < indent(lines[j])) break
      }
      if (b < 0) return null
      for (let i = j + 1; i < lines.length; i++) {
        if (lines[i].trim() === '') continue
        if (indent(lines[i]) >= content(lines[b])) return null
        break
      }
      const d = [...state.diagnostics, ...state.steps.flatMap(s => s.diags)]
        .find(d => d.range.start.line === b && /^unsolved goals/.test(taggedText(d.message)))
      if (!d) return null
      return { goals: parseGoals(taggedText(d.message).replace(/^unsolved goals\n?/, '')), lastLine: j }
    }

    // Names used in `rw [...]`, `exact`, `apply` that Lean will not know. The game server does
    // not report unknown identifiers in rewrites, so we check them here.
    unknownNames(steps) {
      const known = new Set(this.lemmas)
      for (const s of steps)
        for (const g of s.goals)
          for (const h of g.goal.hyps) h.names.forEach(n => known.add(n))
      const unknown = []
      this.editor.value.split('\n').forEach((line, i) => {
        const names = []
        const rw = line.match(/\b(?:rw|rewrite|nth_rewrite\s+\d+|repeat\s+rw)\s*\[([^\]]*)\]/)
        if (rw) names.push(...rw[1].split(',').map(x => x.replace('←', '').trim().split(/\s+/)[0]))
        const ex = line.match(/\b(?:exact|apply)\s+([A-Za-z_][\w.']*)/)
        if (ex) names.push(ex[1])
        for (const n of names)
          if (n && /^[A-Za-z_]/.test(n) && !known.has(n) && !known.has(n.replace(/^MyNat\./, '')))
            unknown.push({ line: i, name: n })
      })
      return unknown
    }

    // Show the state after the line containing the cursor.
    renderState() {
      const state = this.lastState
      if (!state || activeLevel !== this) return
      const cursorLine = this.editor.value.slice(0, this.editor.selectionStart).split('\n').length - 1
      const steps = state.steps
      // `steps[k].line` is one past the proof line that produced it; step 0 is the initial goal.
      let k = 0
      steps.forEach((s, i) => { if (s.line <= cursorLine + 1) k = i })
      if (cursorLine >= steps.length - 1) k = steps.length - 1
      // After an error Lean may report no goals for a step; then show the last known ones.
      while (k > 0 && steps[k].goals.length === 0 && !state.completed) k--
      let step = steps[k]
      let before = k > 0 ? steps[k - 1].goals.map(g => g.goal) : []
      // At the end of an unfinished `·` block the server already reports the goals after the
      // block; the goals in the block are listed in its "unsolved goals" error instead.
      const blockGoals = this.openBlockGoals(state, cursorLine)
      if (blockGoals) {
        step = { goals: blockGoals.goals }
        before = (steps.filter(s => s.line <= blockGoals.lastLine).pop()?.goals ?? []).map(g => g.goal)
      }
      // Compare with the same goal before this step: the one with the same case name, if any.
      const main = step.goals[0]?.goal
      const prev = main?.userName ? before.find(g => g.userName === main.userName) ?? before.find(g => !g.userName && before.length === 1) : before[0]

      this.goals.replaceChildren()
      if (step.goals.length === 0) {
        this.goals.appendChild(el('div', 'nng-no-goals', state.completed ? 'No goals left.' : 'No goals.'))
      } else {
        step.goals.forEach((g, i) => {
          const wrap = el('div', 'nng-goal-wrap' + (i === 0 ? ' nng-main-goal' : ''))
          if (i === 0 && step.goals.length > 1)
            wrap.appendChild(el('div', 'nng-goal-label', `Current goal (of ${step.goals.length})`))
          wrap.appendChild(this.renderGoal(g.goal, i === 0 ? prev : undefined))
          this.goals.appendChild(wrap)
        })
      }

      this.hints.replaceChildren()
      for (const h of step.goals[0]?.hints ?? []) {
        const box = el('div', 'nng-hint' + (h.hidden ? ' nng-hidden-hint' : ''))
        const text = renderText(hintText(this.catalogue, h), 'nng-hint-text')
        if (h.hidden) {
          const btn = el('button', 'nng-show-hint', 'Show more help!')
          btn.type = 'button'
          text.hidden = true
          btn.addEventListener('click', () => { text.hidden = false; btn.remove() })
          box.append(btn, text)
        } else {
          box.appendChild(text)
        }
        this.hints.appendChild(box)
      }

      // An empty `·` line at the end waits for a tactic; its syntax error is no news.
      const lines = this.editor.value.split('\n')
      let lastLine = lines.length - 1
      while (lastLine > 0 && lines[lastLine].trim() === '') lastLine--
      const pendingBullet = /^\s*·\s*$/.test(lines[lastLine] ?? '') ? lastLine : -1

      // Diagnostics appear both in `state.diagnostics` and in the individual steps.
      this.messages.replaceChildren()
      const seen = new Set()
      const diags = [...state.diagnostics, ...steps.flatMap(s => s.diags)]
        .sort((a, b) => a.range.start.line - b.range.start.line)
      for (const d of diags) {
        const text = taggedText(d.message)
        if (pendingBullet >= 0 && d.range.start.line >= pendingBullet) continue
        // Open goals are shown above anyway.
        if (/level completed|intermediate goal solved|^unsolved goals/.test(text)) continue
        const key = `${d.range.start.line}:${text}`
        if (seen.has(key)) continue
        seen.add(key)
        const sev = d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : 'info'
        this.messages.appendChild(this.renderMessage(sev, d.range.start.line, text))
      }
      for (const u of this.unknownNames(steps))
        this.messages.appendChild(this.renderMessage('warning', u.line,
          null, `Lean does not know the name \`${u.name}\` here. A typo? ` +
            'You can click the available theorems and hypotheses.'))
    }

    renderMessage(sev, line, leanText, ownText) {
      const m = el('div', `nng-msg nng-${sev}`)
      const head = el('div', 'nng-msg-head')
      head.appendChild(el('span', 'nng-msg-line', `Line ${line + 1}: `))
      const explanation = ownText ?? explain(leanText)
      head.appendChild(explanation ? renderText(explanation, 'nng-msg-text') : el('pre', null, leanText))
      m.appendChild(head)
      if (explanation && leanText) {
        const details = el('details', 'nng-msg-details')
        details.appendChild(el('summary', null, 'Message from Lean'))
        details.appendChild(el('pre', null, leanText))
        m.appendChild(details)
      }
      return m
    }
  }

  function init() {
    document.querySelectorAll('.nng-level').forEach(root => new Level(root))
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
