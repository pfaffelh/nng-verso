// Drags blocks with the mouse (desktop) and with a finger (phone, real touch events via CDP).
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true })
const base = (process.env.BASE ?? 'http://127.0.0.1:8001/') + 'Logic___-Conjunction/'
const box = async l => { const b = await l.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
const report = async (t, label) => {
  const r = await t.locator('.ipm-block.ipm-assumption rect').first().boundingBox()
  const conns = await t.locator('.ipm-conn path').evaluateAll(ps => ps.map(p => p.getAttribute('d').split(' ')[0]))
  console.log(`${label}: assumption at (${Math.round(r.x)}, ${Math.round(r.y)}) | lines start at ${conns.join(' ')} | ${await t.locator('.ipm-status').innerText()}`)
}

// Desktop, mouse
let page = await (await browser.newContext({ viewport: { width: 1300, height: 900 } })).newPage()
page.on('pageerror', e => console.log('PAGEERROR', e.message))
await page.goto(base); await page.evaluate(() => localStorage.clear()); await page.reload()
let t = page.locator('.ipm-task').nth(0)
await t.locator('.ipm-conclusion .ipm-port.ipm-in').click(); await t.locator('.ipm-assumption rect').click({ force: true })
await t.scrollIntoViewIfNeeded()
await report(t, 'mouse, before')
let c = await box(t.locator('.ipm-assumption rect'))
await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x + 60, c.y + 20, { steps: 8 }); await page.mouse.move(c.x + 120, c.y + 30, { steps: 8 }); await page.mouse.up()
await page.waitForTimeout(200); await report(t, 'mouse, after drag')
console.log('  sheet opened by the drag?', await t.locator('.ipm-sheet').isVisible())
await page.reload(); await page.waitForTimeout(300); t = page.locator('.ipm-task').nth(0); await report(t, 'mouse, after reload')
await t.locator('.ipm-button', { hasText: 'Tidy up' }).click(); await report(t, 'mouse, after Tidy up')

// Phone, finger
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
page = await ctx.newPage()
page.on('pageerror', e => console.log('PAGEERROR', e.message))
await page.goto(base); await page.evaluate(() => localStorage.clear()); await page.reload()
t = page.locator('.ipm-task').nth(0); await t.scrollIntoViewIfNeeded()
await report(t, 'touch, before')
const cdp = await ctx.newCDPSession(page)
c = await box(t.locator('.ipm-assumption rect'))
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
await touch('touchStart', c.x, c.y)
for (let k = 1; k <= 10; k++) await touch('touchMove', c.x - 6 * k, c.y + 4 * k)
await touch('touchEnd'); await page.waitForTimeout(300)
await report(t, 'touch, after drag (expected -60, +40)')
// a tap with the finger on the goal box, then on the assumption box: connects them
const tapAt = async l => { const q = await box(l); await touch('touchStart', q.x, q.y); await touch('touchEnd') ; await page.waitForTimeout(250) }
await tapAt(t.locator('.ipm-conclusion rect')); console.log('  after finger tap on goal:', await t.locator('.ipm-status').innerText())
await tapAt(t.locator('.ipm-assumption rect')); console.log('  after finger tap on assumption:', await t.locator('.ipm-status').innerText())
console.log('  page scrolled by the drag?', await page.evaluate(() => window.scrollY))
await browser.close()
