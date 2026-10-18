// Plays proof graph tasks on a simulated phone by tapping in the picture. Usage: BASE=http://localhost:8001/ node ipm-phone.mjs
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('pageerror', e => console.log('PAGEERROR', e.message))
await page.goto((process.env.BASE ?? 'http://127.0.0.1:8001/') + 'Logic___-Conjunction/')
await page.evaluate(() => localStorage.clear()); await page.reload()
const task = i => page.locator('.ipm-task').nth(i)
const tap = async loc => { await loc.dispatchEvent('click'); await page.waitForTimeout(150) }
const state = async t => `${await t.locator('.ipm-status').innerText()} | candidates: ${await t.locator('.ipm-candidate').count()} | skulls: ${await t.locator('.ipm-skull').count()}`
const sheet = async t => (await t.locator('.ipm-sheet').isVisible()) ? (await t.locator('.ipm-sheet').innerText()).replace(/\n/g, ' | ') : '(no sheet)'

let t = task(0)
await tap(t.locator('.ipm-conclusion .ipm-port.ipm-in')); console.log('T1 after red:', await state(t)); console.log('   sheet:', await sheet(t))
await tap(t.locator('.ipm-assumption rect')); console.log('T1 after tapping the box A:', await state(t))
await page.waitForTimeout(1600)
t = task(1)
await tap(t.locator('.ipm-conclusion .ipm-port.ipm-in')); console.log('T2 after red:', await state(t))
await tap(t.locator('.ipm-assumption .ipm-port.ipm-out').nth(1)); console.log('T2 after tapping B (wrong):', await state(t))
await tap(t.locator('.ipm-undo, .ipm-button').first()); console.log('T2 after undo:', await state(t))
await tap(t.locator('.ipm-assumption .ipm-port.ipm-out').nth(0)); console.log('T2 blue first, then red:', await state(t))
await tap(t.locator('.ipm-conclusion .ipm-port.ipm-in')); console.log('T2:', await state(t))
await page.waitForTimeout(1600)
t = task(2)
await tap(t.locator('.ipm-conclusion rect').nth(0)); await tap(t.locator('.ipm-assumption rect').nth(1))
await tap(t.locator('.ipm-conclusion rect').nth(1)); await tap(t.locator('.ipm-assumption rect').nth(0)); console.log('T3:', await state(t))
await page.waitForTimeout(1600)
t = task(3)  // A, B ⊢ A ∧ B: new block from the sheet, then direct taps
await tap(t.locator('.ipm-conclusion .ipm-port.ipm-in')); console.log('T4 sheet:', await sheet(t))
await tap(t.locator('.ipm-sheet .ipm-option').filter({ hasText: /∧I/ }).first())
await tap(t.locator('.ipm-rule .ipm-port.ipm-in.ipm-open').nth(0)); await tap(t.locator('.ipm-assumption rect').nth(0))
await tap(t.locator('.ipm-rule .ipm-port.ipm-in.ipm-open').nth(0)); await tap(t.locator('.ipm-assumption rect').nth(1)); console.log('T4:', await state(t))
await t.screenshot({ path: 'ipm2-t4.png' })
await browser.close()
