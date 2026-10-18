// Plays the rw lesson of the prototype by clicks only. Usage: BASE=http://localhost:8001/ node lesson.mjs
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } })
page.on('pageerror', e => console.log('PAGEERROR', e.message))
await page.goto((process.env.BASE ?? 'http://127.0.0.1:8001/') + 'Lesson___-The-rw-Tactic/')
await page.evaluate(() => localStorage.clear()); await page.reload()
const steps = page.locator('.nng-step')
const locked = async () => (await steps.evaluateAll(ls => ls.map(l => l.classList.contains('nng-locked') ? '🔒' : l.classList.contains('nng-completed') ? '✓' : '·'))).join(' ')
const idle = async s => {
  for (let i = 0; i < 2; i++) {
    await page.waitForTimeout(900)
    await page.waitForFunction(el => !/Connecting|checking/.test(el.querySelector('.nng-status').textContent), await s.elementHandle(), { timeout: 180000 })
  }
}
const sub = (s, where, re) => s.locator(`${where} .nng-sub`).filter({ hasText: re }).first()
const suggest = async (s, want = /./) => {
  await s.locator('.nng-suggestion').first().waitFor()
  const all = await s.locator('.nng-suggestion').allInnerTexts()
  const b = s.locator('.nng-suggestion').filter({ hasText: want }).first()
  const t = await b.innerText(); await b.click(); return `${t}   (offered: ${all.join(' | ')})`
}
const report = async (i, s) => console.log(`step ${i}: ${JSON.stringify(await s.locator('.nng-editor').inputValue())} | ${await s.locator('.nng-status').textContent()} | steps: ${await locked()}`)

console.log('start steps:', await locked())
let s = steps.nth(0); await s.locator('.nng-editor').click(); await idle(s)
await s.locator('.nng-tactic[data-insert="rw"]').click(); await s.locator('.nng-hyp-name', { hasText: 'h' }).click(); await idle(s); await report(1, s)
await page.waitForTimeout(2000)
s = steps.nth(1); await s.locator('.nng-editor').click(); await idle(s)
await s.locator('.nng-lemma[data-insert="add_zero"]').click(); await idle(s); await report(2, s)
await page.waitForTimeout(2000)
s = steps.nth(2); await s.locator('.nng-editor').click(); await idle(s)
await sub(s, '.nng-target', /^\(?b \+ 0\)?$/).dispatchEvent('click'); console.log('  suggestion:', await suggest(s)); await idle(s); await report(3, s)
await page.waitForTimeout(2000)
s = steps.nth(3); await s.locator('.nng-editor').click(); await idle(s)
await sub(s, '.nng-target', /^y$/).dispatchEvent('click'); console.log('  suggestion:', await suggest(s)); await idle(s)
await sub(s, '.nng-target', /^x$/).dispatchEvent('click'); console.log('  suggestion:', await suggest(s, /h₂/)); await idle(s); await report(4, s)
await page.waitForTimeout(2000)
s = steps.nth(4); await s.locator('.nng-editor').click(); await idle(s)
await sub(s, '.nng-hyp', /^a \+ 0$/).dispatchEvent('click'); console.log('  suggestion:', await suggest(s)); await idle(s)
await s.locator('.nng-hyp-name', { hasText: /^h$/ }).click(); await idle(s); await report(5, s)
await page.waitForTimeout(2000)
await page.screenshot({ path: 'lesson.png', fullPage: true })
await browser.close()
