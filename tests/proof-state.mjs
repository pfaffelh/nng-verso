// Prints goals per step and all diagnostics of a proof, as `Game.getProofState` reports them.
// Usage: RELAY=ws://… node proof-state.mjs <World> <level> <proof-file>
import fs from 'node:fs'
const [world, level, proofFile] = process.argv.slice(2)
const proof = fs.readFileSync(proofFile, 'utf8')
const ws = new WebSocket(process.env.RELAY ?? 'ws://localhost:8080/websocket/g/local/nng4')
let nextId = 0; const pending = new Map(); const uri = `file:///${world}/${level}.lean`
const send = m => ws.send(JSON.stringify({ jsonrpc: '2.0', ...m }))
const request = (method, params) => { const id = nextId++; send({ id, method, params }); return new Promise(r => pending.set(id, r)) }
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id !== undefined && pending.has(m.id) && !m.method) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id) } else if (m.id !== undefined && m.method) send({ id: m.id, result: null }) }
const tt = t => t.text ?? (t.append ? t.append.map(tt).join('') : t.tag ? tt(t.tag[1]) : '')
ws.onopen = async () => {
  await request('initialize', { processId: null, rootUri: null, capabilities: {}, initializationOptions: { difficulty: 1, inventory: [] } })
  send({ method: 'initialized', params: {} })
  send({ method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'lean4', version: 1, text: proof } } })
  const { sessionId } = await request('$/lean/rpc/connect', { uri })
  const pos = { line: 0, character: 0 }
  const st = await request('$/lean/rpc/call', { method: 'Game.getProofState', sessionId, textDocument: { uri }, position: pos, params: { textDocument: { uri }, position: pos, worldId: world, levelId: Number(level) } })
  console.log('completed', st.completed)
  for (const s of st.steps) console.log(' step line', s.line, 'goals', s.goals.map(g => g.goal.userName ?? '-').join(','), s.diags.map(d => `[L${d.range.start.line} ${d.severity} ${tt(d.message).split('\n')[0]}]`).join(' '))
  for (const d of st.diagnostics) console.log(' diag L' + d.range.start.line, d.severity, tt(d.message).split('\n')[0])
  process.exit(0)
}
