// Protocol smoke test: talk to the lean4game relay like a browser client would.
// Usage: RELAY=ws://… node proto-test.mjs <World> <level> <proof-file>  (HOLD=1 keeps the session 15 s)
import fs from 'node:fs'

const [world, level, proofFile] = process.argv.slice(2)
const proof = fs.readFileSync(proofFile, 'utf8')
const ws = new WebSocket(process.env.RELAY ?? 'ws://localhost:8080/websocket/g/local/nng4')
let nextId = 0
const pending = new Map()
const uri = `file:///${world}/${level}.lean`

function send(msg) { ws.send(JSON.stringify({ jsonrpc: '2.0', ...msg })) }
function request(method, params) {
  const id = nextId++
  send({ id, method, params })
  return new Promise((res, rej) => pending.set(id, { res, rej }))
}

ws.onmessage = ev => {
  const msg = JSON.parse(ev.data)
  if (msg.id !== undefined && pending.has(msg.id)) {
    const p = pending.get(msg.id); pending.delete(msg.id)
    msg.error ? p.rej(msg.error) : p.res(msg.result)
  } else if (msg.method === 'textDocument/publishDiagnostics') {
    console.log('DIAG', JSON.stringify(msg.params.diagnostics.map(d => [d.range.start.line, d.severity, d.message])))
  } else if (msg.method === '$/lean/fileProgress') {
    if (msg.params.processing.length === 0) console.log('PROGRESS done')
  } else if (msg.id !== undefined && msg.method) {
    send({ id: msg.id, result: null }) // answer server->client requests
  }
}

ws.onopen = async () => {
  const t0 = Date.now()
  await request('initialize', {
    processId: null, rootUri: null, capabilities: {},
    initializationOptions: { difficulty: 1, inventory: [] },
  })
  send({ method: 'initialized', params: {} })
  send({ method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'lean4', version: 1, text: proof } } })
  const { sessionId } = await request('$/lean/rpc/connect', { uri })
  console.log('session', sessionId, 'after', Date.now() - t0, 'ms')
  const pos = { line: 0, character: 0 }
  const state = await request('$/lean/rpc/call', {
    method: 'Game.getProofState', sessionId, textDocument: { uri }, position: pos,
    params: { textDocument: { uri }, position: pos, worldId: world, levelId: Number(level) },
  })
  console.log('took', Date.now() - t0, 'ms')
  const tt = t => t.text ?? (t.append ? t.append.map(tt).join('') : t.tag ? tt(t.tag[1]) : '')
  console.log('completed', state.completed, state.completedWithWarnings,
    'diags', JSON.stringify(state.diagnostics.map(d => [d.range.start.line, d.severity, tt(d.message)])))
  for (const s of state.steps)
    console.log('STEP', s.line, JSON.stringify(s.command), '|', s.goals.map(g =>
      g.goal.hyps.map(h => h.names.join(' ') + ' : ' + tt(h.type)).join('; ') + ' ⊢ ' + tt(g.goal.type)
      + (g.hints.length ? '  HINTS: ' + g.hints.map(h => (h.hidden ? '(hidden) ' : '') + h.text.slice(0, 50)).join(' / ') : '')
    ).join(' ‖ '), s.diags.length ? 'DIAGS ' + s.diags.map(d => tt(d.message)).join(' / ') : '')
  if (process.env.HOLD) await new Promise(r => setTimeout(r, 15000))
  ws.close(1000)
  process.exit(0)
}
ws.onerror = e => { console.error('WS error', e.message); process.exit(1) }
