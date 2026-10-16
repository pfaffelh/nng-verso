// Generic rules: add a block, then connect it by tapping (simulated phone).
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('pageerror', e => console.log('PAGEERROR', e.message))
await page.goto((process.env.BASE ?? 'http://127.0.0.1:8001/') + 'Logic___-Conjunction/')
await page.evaluate(() => localStorage.clear()); await page.reload()
await page.evaluate(() => document.querySelectorAll('.ipm-task').forEach(x => x.classList.remove('ipm-locked')))
const tap = async l => { await l.dispatchEvent('click'); await page.waitForTimeout(150) }
const state = async t => `${await t.locator('.ipm-status').innerText()} | candidates: ${await t.locator('.ipm-candidate').count()} | skulls: ${await t.locator('.ipm-skull').count()}`

// Task 9: A ∧ B ⊢ B ∧ A
const t = page.locator('.ipm-task').nth(8)
await tap(t.locator('.ipm-conclusion .ipm-port.ipm-in'))
console.log('sheet folded:', (await t.locator('.ipm-sheet').innerText()).replace(/\n/g, ' | '))
await tap(t.locator('.ipm-sheet-head'))
console.log('rules:', await t.locator('.ipm-sheet .ipm-option-main').allInnerTexts())
await tap(t.locator('.ipm-sheet .ipm-option').filter({ hasText: '∧I' }))
console.log('after adding ∧I:', await state(t))
await tap(t.locator('.ipm-rule .ipm-port.ipm-out').first())          // connect ∧I to the goal
console.log('after connecting ∧I:', await state(t))
await tap(t.locator('.ipm-assumption .ipm-port.ipm-out'))           // A ∧ B selected
await tap(t.locator('.ipm-sheet-head'))
await tap(t.locator('.ipm-sheet .ipm-option').filter({ hasText: '∧E' }))
await tap(t.locator('.ipm-rule').nth(1).locator('.ipm-port.ipm-in'))  // into ∧E
console.log('after feeding ∧E:', await state(t))
await t.screenshot({ path: 'ipm3-mid.png' })
// ∧I needs B then A: ∧E outputs are A (0) and B (1)
await tap(t.locator('.ipm-rule').nth(0).locator('.ipm-port.ipm-in').nth(0)); await tap(t.locator('.ipm-rule').nth(1).locator('.ipm-port.ipm-out').nth(1))
await tap(t.locator('.ipm-rule').nth(0).locator('.ipm-port.ipm-in').nth(1)); await tap(t.locator('.ipm-rule').nth(1).locator('.ipm-port.ipm-out').nth(0))
console.log('T9:', await state(t))
await t.screenshot({ path: 'ipm3-done.png' })
await browser.close()
