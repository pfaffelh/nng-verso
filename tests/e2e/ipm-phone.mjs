// Plays proof graph tasks of the prototype on a simulated phone (touch only). Usage: BASE=http://localhost:8001/ node ipm-phone.mjs
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('pageerror', e => console.log('PAGEERROR', e.message))
await page.goto((process.env.BASE ?? 'http://127.0.0.1:8001/') + 'Logic___-Conjunction/')
await page.evaluate(() => localStorage.clear()); await page.reload()
const task = i => page.locator('.ipm-task').nth(i)
const tapPort = async (t, sel, n = 0) => { await t.locator(sel).nth(n).tap(); await page.waitForTimeout(150) }
const options = async t => (await t.locator('.ipm-sheet .ipm-option').allInnerTexts()).map(x => x.replace(/\n/g, ' · '))
const choose = async (t, re) => { await t.locator('.ipm-sheet .ipm-option').filter({ hasText: re }).first().tap(); await page.waitForTimeout(150) }
const status = async t => `${await t.locator('.ipm-status').innerText()} | locked: ${await page.locator('.ipm-task.ipm-locked').count()}`
const waitUnlock = () => page.waitForTimeout(1600)

// Task 1: A ⊢ A
let t = task(0)
await tapPort(t, '.ipm-conclusion .ipm-port.ipm-in'); console.log('T1 options:', await options(t))
await choose(t, /Use A/); console.log('T1:', await status(t)); await waitUnlock()
// Task 2: A, B ⊢ A — first a wrong connection (☠), then fix it
t = task(1)
await tapPort(t, '.ipm-conclusion .ipm-port.ipm-in'); console.log('T2 options:', await options(t))
await choose(t, /Use B/); console.log('T2 after wrong:', await status(t), '| skulls:', await t.locator('.ipm-skull').count())
await t.locator('.ipm-skull').first().tap(); await page.waitForTimeout(150)
console.log('T2 skull says:', await t.locator('.ipm-sheet-title').innerText())
await choose(t, /Remove this connection/)
await tapPort(t, '.ipm-conclusion .ipm-port.ipm-in'); await choose(t, /Use A/); console.log('T2:', await status(t)); await waitUnlock()
// Task 3: A, B ⊢ B, A
t = task(2)
await tapPort(t, '.ipm-conclusion .ipm-port.ipm-in', 0); await choose(t, /Use B/)
await tapPort(t, '.ipm-conclusion .ipm-port.ipm-in', 1); await choose(t, /Use A/); console.log('T3:', await status(t)); await waitUnlock()
// Task 4: A, B ⊢ A ∧ B
t = task(3)
await tapPort(t, '.ipm-conclusion .ipm-port.ipm-in'); console.log('T4 options:', await options(t))
await choose(t, /∧I/)
await tapPort(t, '.ipm-rule .ipm-port.ipm-in.ipm-open', 0); await choose(t, /Use A/)
await tapPort(t, '.ipm-rule .ipm-port.ipm-in.ipm-open', 0); await choose(t, /Use B/); console.log('T4:', await status(t)); await waitUnlock()
await page.screenshot({ path: 'ipm-t4.png' })
// skip to task 9 by solving 5..8 quickly
t = task(4); await tapPort(t, '.ipm-conclusion .ipm-port.ipm-in'); await choose(t, /∧I/)
await tapPort(t, '.ipm-rule .ipm-port.ipm-in.ipm-open', 0); await choose(t, /Use A/)
await tapPort(t, '.ipm-rule .ipm-port.ipm-in.ipm-open', 0); await choose(t, /Use A/); console.log('T5:', await status(t)); await waitUnlock()
t = task(5); await tapPort(t, '.ipm-assumption .ipm-port.ipm-out'); console.log('T6 options (from output):', await options(t))
await choose(t, /∧E/); await tapPort(t, '.ipm-rule .ipm-port.ipm-out', 0); await choose(t, /Use for A/); console.log('T6:', await status(t)); await waitUnlock()
t = task(6); await tapPort(t, '.ipm-assumption .ipm-port.ipm-out'); await choose(t, /∧E/)
await tapPort(t, '.ipm-rule .ipm-port.ipm-out', 0); await choose(t, /Use for A/)
await tapPort(t, '.ipm-rule .ipm-port.ipm-out', 1); await choose(t, /Use for B/); console.log('T7:', await status(t)); await waitUnlock()
t = task(7); await tapPort(t, '.ipm-conclusion .ipm-port.ipm-in'); await choose(t, /Use A ∧ B/); console.log('T8:', await status(t)); await waitUnlock()
// Task 9: A ∧ B ⊢ B ∧ A, goal-directed
t = task(8)
await tapPort(t, '.ipm-conclusion .ipm-port.ipm-in'); await choose(t, /∧I/)
await tapPort(t, '.ipm-rule .ipm-port.ipm-in.ipm-open', 0); console.log('T9 tapped:', await t.locator('.ipm-sheet-title').innerText())
await choose(t, /∧E \?A ∧ B ⟹ B/)
await tapPort(t, '.ipm-rule .ipm-port.ipm-in.ipm-open', 0); console.log('T9 tapped:', await t.locator('.ipm-sheet-title').innerText(), await options(t))
await choose(t, /Use \?A/)
await tapPort(t, '.ipm-rule .ipm-port.ipm-in.ipm-open', 0); console.log('T9 tapped:', await t.locator('.ipm-sheet-title').innerText())
await choose(t, /Use A ∧ B/); console.log('T9:', await status(t))
await t.screenshot({ path: 'ipm-t9.png' })
await browser.close()
