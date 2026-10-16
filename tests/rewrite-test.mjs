// Asks the game server for rewrite suggestions on each subterm of a level's initial goal.
// Usage: RELAY=ws://… node rewrite-test.mjs <World> <level> "cand1 cand2 …"
const [world, level, cands] = process.argv.slice(2)
const ws = new WebSocket(process.env.RELAY ?? 'ws://localhost:8080/websocket/g/local/proto')
let nextId = 0; const pending = new Map(); const uri = `file:///${world}/${level}.lean`
const send = m => ws.send(JSON.stringify({ jsonrpc: '2.0', ...m }))
const request = (method, params) => { const id = nextId++; send({ id, method, params }); return new Promise(r => pending.set(id, r)) }
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id !== undefined && pending.has(m.id) && !m.method) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id) } else if (m.id !== undefined && m.method) send({ id: m.id, result: null }) }
const tt = t => t.text ?? (t.append ? t.append.map(tt).join('') : t.tag ? tt(t.tag[1]) : '')
const subterms = (t, out = []) => { if (t.tag) { out.push([tt(t.tag[1]), t.tag[0].subexprPos]); subterms(t.tag[1], out) } else if (t.append) t.append.forEach(x => subterms(x, out)); return out }
ws.onopen = async () => {
  await request('initialize', { processId: null, rootUri: null, capabilities: {}, initializationOptions: { difficulty: 1, inventory: [] } })
  send({ method: 'initialized', params: {} })
  send({ method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'lean4', version: 1, text: '' } } })
  const { sessionId } = await request('$/lean/rpc/connect', { uri })
  const pos = { line: 0, character: 0 }
  const call = (method, params) => request('$/lean/rpc/call', { method, sessionId, textDocument: { uri }, position: pos, params })
  const st = await call('Game.getProofState', { textDocument: { uri }, position: pos, worldId: world, levelId: Number(level) })
  const goal = st.steps[0].goals[0].goal
  console.log('goal:', tt(goal.type))
  const ask = async (hyp, type) => {
    for (const [text, pos] of subterms(type)) {
      const res = await call('Game.rewriteSuggestions', { ctx: goal.ctx, mvarId: goal.mvarId, hyp, pos, candidates: cands.split(' ') })
      console.log(`  ${(hyp ? hyp + ': ' : '⊢ ') + text}`.padEnd(24), '→', Array.isArray(res) ? res.map(s => `${s.tactic}  ⇒ ${s.result}`).join(' | ') || '–' : JSON.stringify(res))
    }
  }
  await ask(undefined, goal.type)
  for (const h of goal.hyps) if (/=/.test(tt(h.type))) await ask(h.names[0], h.type)
  process.exit(0)
}
