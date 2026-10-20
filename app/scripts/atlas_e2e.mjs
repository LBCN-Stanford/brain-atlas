/* End-to-end check of the BUILT atlas (dist/), in a real browser.

   Usage:  npm run build && node scripts/atlas_e2e.mjs [--base http://127.0.0.1:4317]
   With no --base it serves dist/ itself with `vite preview` and stops it afterwards.

   What it proves, each as a hard failure:
     - the page loads with no console error and no failed request, and says how many stimulations
       it holds
     - the first view arrives within the transfer budget (bytes before the brain is drawn)
     - picking an area by search opens the reading panel with its reports
     - the address is always the root with the state in the query; a legacy hash link, an old
       /v2.html path, and a route of the earlier app all land on the atlas
     - "Smooth" works (the inflated surfaces load after the brain)
     - the reports download is a zip that holds reports.csv, README.txt and the citation files
     - the area list reaches every report without the 3D canvas
     - experience search turns a word into a map with sham alongside, and the sham explorer opens
     - a real mouse click on the canvas selects the area under it, with Electrodes on and with a
       deep structure selected (the cortex was unclickable in both, validation H1)
     - at phone width nothing overlaps the brain and Download stays reachable
     - axe finds no serious or critical accessibility violation on the page */

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d }
let BASE = arg('--base', null)
const BUDGET_FIRST_VIEW = 12 * 1024 * 1024 // bytes on the wire before the brain is drawn

let server = null
if (!BASE) {
  const port = 4317
  server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'pipe' })
  BASE = `http://127.0.0.1:${port}`
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/')).ok) break } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200))
  }
}

const failures = []
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`); if (!ok) failures.push(what) }

const browser = await chromium.launch()
try {
  /* ---- desktop: load, first-view budget, console --------------------------------------- */
  // bypassCSP only so axe can be injected below; the legacy-link context keeps the page's policy
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, bypassCSP: true })
  const page = await ctx.newPage()
  const errors = []
  const failed = []
  let bytes = 0
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`))
  page.on('response', async (r) => {
    if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) failed.push(`${r.status()} ${r.url()}`)
    const len = Number(r.headers()['content-length'] ?? 0)
    if (len) bytes += len
    else { try { bytes += (await r.body()).length } catch { /* streamed */ } }
  })
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.atlas-canvas canvas', { timeout: 60000 })
  const firstView = bytes
  await page.waitForFunction(() => /stimulations ·/.test(document.querySelector('.atlas-status')?.textContent ?? ''), null, { timeout: 60000 })
  check(firstView <= BUDGET_FIRST_VIEW, `first view within budget: ${(firstView / 1048576).toFixed(1)} MB of ${(BUDGET_FIRST_VIEW / 1048576).toFixed(0)} MB`)
  const status = await page.textContent('.atlas-status')
  check(/\d[\d,]* stimulations · \d+ people/.test(status ?? ''), `status line: "${status?.trim()}"`)
  check(/^\/(\?|$)/.test(new URL(page.url()).pathname + new URL(page.url()).search.slice(0, 1)), `address is the root: ${page.url()}`)
  check(new URL(page.url()).searchParams.get('release') !== null, 'the address names the data release')

  /* ---- pick an area by search ----------------------------------------------------------- */
  await page.fill('input[aria-label="Find a brain area"]', 'insula')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.atlas-panel', { timeout: 10000 })
  const panel = await page.textContent('.atlas-panel')
  check(/stimulations? in this area, from \d+/.test(panel ?? ''), 'reading panel opens with a count of people')
  check((await page.locator('.atlas-report').count()) > 0, 'reports are listed')
  check(new URL(page.url()).searchParams.get('sel')?.includes('insula') ?? false, 'the selection is in the address')

  /* ---- one area at a time; compare is opt-in; subregions ------------------------------------- */
  check(/\d+ parts \(Destrieux\)\. Pick one on the brain/.test((await page.textContent('.atlas-panel')) ?? ''), 'the insula says its subregions can be picked on the brain')
  // a person is one block; selecting it narrows the panel to them
  const firstPerson = page.locator('.atlas-personhead').first()
  await firstPerson.click()
  await page.waitForTimeout(300)
  check(await page.locator('.atlas-personblock.on').isVisible(), 'a person block selects that person')
  check((await page.locator('.atlas-personblock').count()) === 1, 'with a person selected, only their block is listed')
  await page.getByRole('button', { name: 'Show everyone', exact: true }).click()
  check((await page.locator('.atlas-personblock').count()) > 1, 'clearing the person lists everyone again')
  check((await page.locator('.atlas-dl dt', { hasText: 'Record' }).count()) === 0, 'no record ids in the report details')
  check(await page.getByLabel('Opacity').isVisible(), 'the opacity slider is back')
  await page.fill('input[aria-label="Find a brain area"]', 'precentral')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  check((new URL(page.url()).searchParams.get('sel') ?? '').split(',').length === 1, 'a second pick replaces the first (one area at a time)')
  await page.getByLabel('Compare areas').check()
  await page.fill('input[aria-label="Find a brain area"]', 'insula')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  check((new URL(page.url()).searchParams.get('sel') ?? '').split(',').length === 2 && new URL(page.url()).searchParams.get('compare') === '1', 'with Compare areas on, picks add up')
  await page.getByLabel('Compare areas').uncheck()
  await page.waitForTimeout(300)
  check((new URL(page.url()).searchParams.get('sel') ?? '').split(',').length === 1, 'turning Compare off keeps only the last area')
  check((await page.getByRole('button', { name: /^(Left|Right|Top|Below|Front|Back)$/ }).count()) === 0, 'no Left/Right/Top/Below/Front/Back buttons')

  /* ---- smooth ----------------------------------------------------------------------------- */
  await page.getByLabel('Smooth').check()
  await page.waitForTimeout(1500)
  check(new URL(page.url()).searchParams.get('smooth') === '1', '"Smooth" is applied and kept in the address')

  /* ---- download ------------------------------------------------------------------------- */
  await page.getByRole('button', { name: /Download/ }).first().click()
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: /Reports/ }).click()])
  const zip = readFileSync(await dl.path())
  const names = []
  for (let i = 0; i + 30 < zip.length; i++) {
    if (zip.readUInt32LE(i) === 0x04034b50) { const n = zip.readUInt16LE(i + 26); names.push(zip.subarray(i + 30, i + 30 + n).toString()); i += 29 + n }
  }
  for (const f of ['reports.csv', 'README.txt', 'CITATION.bib', 'dataset_description.json', 'SHA256SUMS']) check(names.includes(f), `reports zip holds ${f}`)

  /* ---- the area list (no 3D needed) --------------------------------------------------------- */
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^Areas/ }).click()
  await page.waitForSelector('[aria-label="All areas"]', { timeout: 5000 })
  check((await page.locator('[aria-label="All areas"] button[aria-pressed]').count()) > 30, 'the area list names every area as a button')
  await page.keyboard.press('Escape')

  /* ---- experience search and the sham explorer (17 Oct) ------------------------------------ */
  await page.goto(BASE + '/?atlas=dk', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => /stimulations ·/.test(document.querySelector('.atlas-status')?.textContent ?? ''), null, { timeout: 60000 })
  await page.fill('input[aria-label="Find a brain area"]', 'tingl')
  await page.locator('.atlas-search-say').dispatchEvent('mousedown')
  await page.waitForTimeout(800)
  const legendText = (await page.textContent('.atlas-legend')) ?? ''
  check(new URL(page.url()).searchParams.get('say') === 'tingl' && /Under stimulation/.test(legendText) && /under sham/.test(legendText),
    'experience search: a typed word becomes a map, in the link, with sham alongside in the legend')
  await page.goto(BASE + '/?atlas=dk&sel=ctx:lh.precentral', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.atlas-panel', { timeout: 60000 })
  await page.getByRole('button', { name: /Sham trials, no current delivered/ }).click()
  await page.getByLabel('Side by side with real stimulation').check()
  await page.waitForTimeout(300)
  check((await page.locator('.atlas-shamcmp').count()) > 0, 'sham explorer: sham trials sit beside the same person\'s real stimulations')

  /* ---- a click on the brain (M21: nothing clicked the canvas before) ------------------------ */
  // the visible cortex is clickable whatever is switched on: find a screen point the engine
  // resolves to a left cortical area, click it with the mouse, and read the selection back
  for (const [what, q] of [['Electrodes on', '?atlas=dk&dots=1&test=1'], ['a deep structure selected', '?atlas=dk&sel=deep:Left-Hippocampus&test=1']]) {
    await page.goto(BASE + '/' + q, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__atlasEngine && /stimulations ·/.test(document.querySelector('.atlas-status')?.textContent ?? ''), null, { timeout: 60000 })
    await page.waitForTimeout(1500)
    const target = await page.evaluate(() => {
      const e = window.__atlasEngine, c = document.querySelector('.atlas-canvas canvas').getBoundingClientRect()
      for (let j = 4; j < 16; j++) for (let i = 4; i < 26; i++) {
        const x = c.left + (c.width * i) / 30, y = c.top + (c.height * j) / 20
        const id = e.debugPick(x, y)
        if (id && id.startsWith('ctx:lh.')) return { x, y, id }
      }
      return null
    })
    if (!target) { check(false, `${what}: a point on the left cortex resolves to an area`); continue }
    await page.mouse.click(target.x, target.y)
    await page.waitForTimeout(500)
    const got = new URL(page.url()).searchParams.get('sel') ?? ''
    check(got.split(',').includes(target.id), `${what}: clicking the cortex selects ${target.id} (got ${got || 'nothing'})`)
  }

  /* ---- accessibility -------------------------------------------------------------------- */
  const require = createRequire(import.meta.url)
  let axePath = null
  try { axePath = require.resolve('axe-core/axe.min.js') } catch { /* not installed */ }
  if (axePath) {
    await page.addScriptTag({ path: axePath })
    const res = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.length}`))
    check(res.length === 0, `axe: no serious or critical violations${res.length ? ` (${res.join(', ')})` : ''}`)
  } else check(false, 'axe-core is installed')

  // Stanford's global footer is complete (its links may not be altered or dropped)
  const su = await page.locator('nav[aria-label="Stanford University"] a').allInnerTexts()
  const want = ['Stanford Home', 'Maps & Directions', 'Search Stanford', 'Emergency Info', 'Terms of Use', 'Privacy', 'Copyright', 'Trademarks', 'Non-Discrimination', 'Accessibility']
  check(want.every((w) => su.includes(w)) && /© Stanford University\. Stanford, California 94305\./.test((await page.textContent('nav[aria-label="Stanford University"]')) ?? ''), `Stanford's global footer is complete (${su.length} of ${want.length} links)`)
  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
  check(failed.length === 0, `no failed requests${failed.length ? `: ${failed.slice(0, 3).join(' | ')}` : ''}`)
  await ctx.close()

  /* ---- legacy links ----------------------------------------------------------------------- */
  const legacy = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const lp = await legacy.newPage()
  const legacyErrors = []
  lp.on('console', (m) => { if (m.type() === 'error') legacyErrors.push(m.text()) })
  lp.on('pageerror', (e) => legacyErrors.push(String(e)))
  await lp.goto(BASE + '/#atlas=dk&sel=ctx:lh.insula&map=coverage', { waitUntil: 'domcontentloaded' })
  await lp.waitForSelector('.atlas-panel', { timeout: 60000 })
  const u = new URL(lp.url())
  check(u.hash === '' && u.searchParams.get('sel') === 'ctx:lh.insula' && u.searchParams.get('map') === 'coverage', `a hash link becomes the query: ${lp.url()}`)
  await lp.goto(BASE + '/index.html#/brain3d', { waitUntil: 'domcontentloaded' })
  await lp.waitForSelector('.atlas-canvas canvas', { timeout: 60000 })
  check(new URL(lp.url()).pathname === '/' && !new URL(lp.url()).hash, `a route of the earlier app opens the atlas at the root: ${lp.url()}`)
  const v2 = await lp.goto(BASE + '/v2.html', { waitUntil: 'domcontentloaded' })
  await lp.waitForSelector('.atlas-canvas canvas', { timeout: 60000 })
  check(new URL(lp.url()).pathname === '/', `/v2.html lands on the root (${v2?.status()}): ${lp.url()}`)
  check(legacyErrors.length === 0, `under the page's own Content-Security-Policy, no console errors${legacyErrors.length ? `: ${legacyErrors.slice(0, 2).join(' | ')}` : ''}`)
  await legacy.close()

  /* ---- phone width -------------------------------------------------------------------------- */
  const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })
  const pp = await phone.newPage()
  await pp.goto(BASE + '/?atlas=dk&sel=ctx:lh.insula', { waitUntil: 'domcontentloaded' })
  await pp.waitForSelector('.atlas-panel', { timeout: 60000 })
  const dlBox = await pp.getByRole('button', { name: /Download/ }).first().boundingBox()
  check(!!dlBox && dlBox.x >= 0 && dlBox.x + dlBox.width <= 375, 'phone: Download is on screen')
  // on screen is not enough: the reading sheet once covered the whole header (U5)
  const dlReach = await pp.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Download')
    if (!b) return false
    const r = b.getBoundingClientRect()
    return b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))
  })
  check(dlReach, 'phone: Download can be tapped while an area is open')
  const overflow = await pp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  check(!overflow, 'phone: no sideways scroll')
  await pp.getByRole('button', { name: /Back to the brain/ }).click()
  const canvasVisible = await pp.locator('.atlas-canvas canvas').isVisible()
  const panelGone = !(await pp.locator('.atlas-panel').isVisible())
  check(canvasVisible && panelGone, 'phone: Back lowers the reading sheet to the brain')
  check(new URL(pp.url()).searchParams.get('sel') === 'ctx:lh.insula', 'phone: Back keeps the selection, so the area stays highlighted')
  await pp.getByRole('button', { name: /Read the reports/ }).click()
  check(await pp.locator('.atlas-panel').isVisible(), 'phone: the reading sheet comes back')
  // a tap on the brain selects the area and nothing the sheet then puts under the finger (U1:
  // the tap also clicked the first person block, or focused the report search)
  await pp.goto(BASE + '/?atlas=dk', { waitUntil: 'domcontentloaded' })
  await pp.waitForSelector('.atlas-canvas canvas', { timeout: 60000 })
  await pp.waitForFunction(() => /stimulations ·/.test(document.querySelector('.atlas-status')?.textContent ?? ''), null, { timeout: 60000 })
  await pp.waitForTimeout(1500)
  let tapped = 0, ghost = 0
  for (const [x, y] of [[120, 360], [150, 380], [200, 340], [170, 400]]) {
    await pp.goto(BASE + '/?atlas=dk', { waitUntil: 'domcontentloaded' })
    await pp.waitForFunction(() => /stimulations ·/.test(document.querySelector('.atlas-status')?.textContent ?? ''), null, { timeout: 60000 })
    await pp.waitForTimeout(800)
    await pp.touchscreen.tap(x, y)
    await pp.waitForTimeout(600)
    if (!(await pp.locator('.atlas-panel').isVisible())) continue
    tapped++
    const t = (await pp.textContent('.atlas-panel')) ?? ''
    const focused = await pp.evaluate(() => document.activeElement?.className ?? '')
    if (/Showing one person/.test(t) || /atlas-filter/.test(focused)) ghost++
  }
  check(tapped > 0 && ghost === 0, `phone: a tap on the brain selects only the area (${tapped} taps opened an area, ${ghost} also clicked the sheet)`)
  await phone.close()
} finally {
  await browser.close()
  server?.kill()
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed')
process.exit(failures.length ? 1 : 0)
