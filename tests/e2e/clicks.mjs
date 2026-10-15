// Solves Addition level 1 (zero_add) by clicks only, in headless Chrome.
// Usage: BASE=http://localhost:8000/ CHROME=/usr/bin/google-chrome node clicks.mjs
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1300, height: 1100 } })
page.on('pageerror', e => console.log('PAGEERROR', e.message))
await page.goto((process.env.BASE ?? 'http://127.0.0.1:8000/') + 'Addition-World/Level-1___--zero_add/')
await page.evaluate(() => localStorage.clear()); await page.reload()
const idle = async () => {
  await page.waitForTimeout(800)
  await page.waitForFunction(() => !/Connecting|checking/.test(document.querySelector('.nng-status').textContent), null, { timeout: 120000 })
  await page.waitForTimeout(900) // auto structure may trigger another check
  await page.waitForFunction(() => !/Connecting|checking/.test(document.querySelector('.nng-status').textContent), null, { timeout: 120000 })
}
const show = async label => console.log(`--- ${label}\n${(await page.inputValue('.nng-editor')).replace(/\n/g, '⏎\n')}\n  GOAL: ${JSON.stringify(await page.innerText('.nng-goals'))}  MSGS: ${JSON.stringify(await page.innerText('.nng-messages'))}  STATUS: ${await page.textContent('.nng-status')}`)
const hyp = name => page.click(`.nng-hyp-name >> text="${name}"`)
const lemma = name => page.click(`.nng-lemma[data-insert="${name}"]`)
const tactic = name => page.click(`.nng-tactic[data-insert="${name}"]`)

await page.click('.nng-editor'); await idle()
await hyp('n'); await idle(); await show('click n')
await lemma('add_zero'); await idle(); await show('click add_zero')
await tactic('rfl'); await idle(); await show('click rfl')
await lemma('add_succ'); await idle(); await show('click add_succ')
await hyp('hd'); await idle(); await show('click hd')
await tactic('rfl'); await idle(); await show('click rfl')
await page.click('.nng-undo'); await idle(); await show('undo')
await page.locator('.nng-level').screenshot({ path: 'clicks.png' })
await browser.close()
