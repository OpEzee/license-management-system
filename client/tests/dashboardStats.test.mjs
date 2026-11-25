/*
 * Unit tests for the Dashboard's pure helpers (client/src/services/dashboardStats.js).
 *
 *   npm run test:client        (also part of npm test)
 *
 * The client is ESM that Vite compiles (import.meta.env, extensionless
 * imports), so plain Node cannot load it. The module is loaded through Vite's
 * own SSR loader instead: no extra test framework, and no browser. "now" is
 * fixed in every test, so nothing depends on today's date.
 */
import { createServer } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}`, extra !== undefined ? JSON.stringify(extra) : '')
  }
}

const vite = await createServer({
  configFile: path.join(root, 'vite.config.mjs'),
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
  // Only the SSR loader is used. Without this, Vite 6 starts pre-bundling the
  // browser dependencies in the background, and closing the server mid-scan
  // floods the output with "server is being closed" errors.
  optimizeDeps: { noDiscovery: true, entries: [] },
})

try {
  const s = await vite.ssrLoadModule('/src/services/dashboardStats.js')
  const { formatShortDate } = await vite.ssrLoadModule('/src/services/format.js')

  const NOW = new Date('2026-06-01T00:00:00.000Z')
  const DAY = s.DAY_MS
  const at = (ms) => new Date(NOW.getTime() + ms).toISOString()
  let seq = 0
  const lic = (over = {}) => ({
    id: `l${++seq}`,
    licenseKey: `K${seq}`,
    clientName: `Client ${seq}`,
    clientUserId: `client${seq}@test.com`,
    productName: 'Kiosk',
    status: 'active',
    expiryDate: at(365 * DAY),
    createdAt: at(-seq * DAY),
    maxScreens: 1,
    claimedMachines: [],
    ...over,
  })
  const machines = (n) => Array.from({ length: n }, (_, i) => ({ machineNumber: `pc-${i}` }))

  console.log('\n-- percentages --')
  const none = s.statusBreakdown([])
  check('0 licenses: total 0 and active share 0%', none.total === 0 && none.activePercent === 0, none)
  check('0 licenses: every segment is 0%, not NaN',
    none.segments.every((x) => x.percent === 0 && x.count === 0), none.segments)
  check('percent() of nothing is 0', s.percent(5, 0) === 0)

  const mix = [
    ...Array.from({ length: 9 }, () => lic({ status: 'active' })),
    lic({ status: 'deactivated' }), lic({ status: 'deactivated' }),
    lic({ status: 'pending' }),
    lic({ status: 'expired' }),
  ]
  const b = s.statusBreakdown(mix)
  check('9 of 13 active rounds to 69%', b.activePercent === 69, b.activePercent)
  check('counts per status', b.counts.active === 9 && b.counts.deactivated === 2 &&
    b.counts.pending === 1 && b.counts.expired === 1, b.counts)
  check('segments are drawn active, deactivated, pending, expired',
    b.segments.map((x) => x.status).join() === 'active,deactivated,pending,expired')
  check('segment shares add up to 100%',
    Math.abs(b.segments.reduce((sum, x) => sum + x.percent, 0) - 100) < 1e-9)
  check('100% when every license is active', s.statusBreakdown([lic(), lic()]).activePercent === 100)

  console.log('\n-- clients with active licenses --')
  check('distinct by user ID, ignoring case, active only',
    s.clientsWithActiveLicenses([
      lic({ clientUserId: 'A@test.com' }), lic({ clientUserId: 'a@test.com' }),
      lic({ clientUserId: 'b@test.com' }), lic({ clientUserId: 'c@test.com', status: 'expired' }),
    ]) === 2)
  check('none when there are no licenses', s.clientsWithActiveLicenses([]) === 0)

  console.log('\n-- expiring in 60 days --')
  const exactlyNow = lic({ expiryDate: at(0) })
  const justAfter = lic({ expiryDate: at(1) })
  const day60 = lic({ expiryDate: at(60 * DAY) })
  const pastDay60 = lic({ expiryDate: at(60 * DAY + 1) })
  const day10 = lic({ expiryDate: at(10 * DAY) })
  const pendingSoon = lic({ status: 'pending', expiryDate: at(5 * DAY) })
  const deactivatedSoon = lic({ status: 'deactivated', expiryDate: at(5 * DAY) })
  const soon = s.expiringSoon(
    [day60, pastDay60, exactlyNow, day10, justAfter, pendingSoon, deactivatedSoon], NOW
  )
  const ids = soon.map((l) => l.id)
  check('lower boundary: expiring exactly now is excluded', !ids.includes(exactlyNow.id))
  check('lower boundary: 1 ms from now is included, with 1 day left',
    ids.includes(justAfter.id) && soon.find((l) => l.id === justAfter.id).daysLeft === 1)
  check('upper boundary: exactly 60 days is included, with 60 days left',
    ids.includes(day60.id) && soon.find((l) => l.id === day60.id).daysLeft === 60)
  check('upper boundary: 60 days + 1 ms is excluded', !ids.includes(pastDay60.id))
  check('only active licenses count', !ids.includes(pendingSoon.id) && !ids.includes(deactivatedSoon.id))
  check('sorted soonest first', ids.join() === [justAfter.id, day10.id, day60.id].join(), ids)
  check('a different window can be asked for', s.expiringSoon([day10, day60], NOW, 30).length === 1)
  check('a license with no expiry date is ignored', s.expiringSoon([lic({ expiryDate: null })], NOW).length === 0)

  console.log('\n-- licenses by product --')
  const products = s.productBreakdown([
    lic({ productName: 'Kiosk' }), lic({ productName: ' kiosk ' }), lic({ productName: 'KIOSK' }),
    lic({ productName: 'Game' }),
    lic({ productName: 'Showcase' }), lic({ productName: 'Showcase' }),
    lic({ productName: 'Arcade' }),
  ])
  check('names group trimmed and case-insensitively, first spelling shown',
    products[0].name === 'Kiosk' && products[0].count === 3, products)
  check('sorted by count, highest first, then by name',
    products.map((p) => p.name).join() === 'Kiosk,Showcase,Arcade,Game', products.map((p) => p.name))
  check('bars scale to the largest product',
    products[0].percentOfMax === 100 && Math.round(products[1].percentOfMax) === 67, products)
  check('no products when there are no licenses', s.productBreakdown([]).length === 0)

  console.log('\n-- machines (Digital Diya excluded) --')
  const fleet = [
    lic({ maxScreens: 3, claimedMachines: machines(2) }),
    lic({ maxScreens: 5, claimedMachines: machines(1) }),
    lic({ productName: 'Digital Diya', maxScreens: 50, claimedMachines: machines(40) }),
    lic({ productName: '  digital diya ', maxScreens: 10, claimedMachines: machines(10) }),
    lic({ maxScreens: undefined, claimedMachines: undefined }), // a license from before max screens
  ]
  const usage = s.machineUsage(fleet)
  check('Digital Diya, in any spelling, is left out of the machines in use', usage.used === 3, usage)
  check('...and out of the slots (a missing maxScreens counts as 1)', usage.slots === 9, usage)
  check('...and out of the license count', usage.licenses === 3, usage)
  check('no licenses: all zero', JSON.stringify(s.machineUsage([])) === '{"used":0,"slots":0,"licenses":0}')

  console.log('\n-- machine slots: closest to the limit --')
  const full = lic({ clientName: 'Full Co', maxScreens: 2, claimedMachines: machines(2) })
  const fullBigger = lic({ clientName: 'Full Big', maxScreens: 4, claimedMachines: machines(4) })
  const half = lic({ clientName: 'Half Co', maxScreens: 4, claimedMachines: machines(2) })
  const low = lic({ clientName: 'Low Co', maxScreens: 10, claimedMachines: machines(1) })
  const lowTwin = lic({ clientName: 'Aaa Co', maxScreens: 10, claimedMachines: machines(1) })
  const unused = lic({ clientName: 'Unused', maxScreens: 3, claimedMachines: [] })
  const diyaFull = lic({ clientName: 'Diya', productName: 'Digital Diya', maxScreens: 1, claimedMachines: machines(1) })
  const top = s.closestToLimit([low, half, unused, full, diyaFull, lowTwin, fullBigger], 4)
  check('sorted by ratio, then machines in use, then client name',
    top.map((r) => r.clientName).join() === 'Full Big,Full Co,Half Co,Aaa Co', top.map((r) => r.clientName))
  check('at most 4 rows', top.length === 4)
  check('licenses with no machines are left out', !top.some((r) => r.clientName === 'Unused'))
  check('Digital Diya is left out', !s.closestToLimit([diyaFull]).length)
  check('levels: full at 100%, high from 50%, low below',
    top[0].level === 'full' && top[2].level === 'high' && top[3].level === 'low', top.map((r) => r.level))
  check('nothing qualifies when no machine has checked in', s.closestToLimit([unused, lic()]).length === 0)

  console.log('\n-- recently issued --')
  const older = lic({ createdAt: at(-10 * DAY) })
  const newest = lic({ createdAt: at(-1 * DAY) })
  const middle = lic({ createdAt: at(-5 * DAY) })
  const undated = lic({ createdAt: null })
  const recent = s.recentlyIssued([older, undated, newest, middle], 5)
  check('newest first, undated last', recent.map((l) => l.id).join() ===
    [newest.id, middle.id, older.id, undated.id].join(), recent.map((l) => l.id))
  check('at most 5', s.recentlyIssued(Array.from({ length: 8 }, () => lic()), 5).length === 5)
  const given = [older, newest, middle]
  s.recentlyIssued(given, 5)
  check('does not reorder the list it was given',
    given[0] === older && given[1] === newest && given[2] === middle)

  console.log('\n-- labels --')
  check('updated just now', s.updatedLabel(NOW, new Date(NOW.getTime() + 59 * 1000)) === 'Updated just now')
  check('updated N min ago', s.updatedLabel(NOW, new Date(NOW.getTime() + 3 * 60000)) === 'Updated 3 min ago')
  check('updated N h ago', s.updatedLabel(NOW, new Date(NOW.getTime() + 125 * 60000)) === 'Updated 2 h ago')
  check('short date "20 Nov" (UTC)', formatShortDate('2026-11-20T23:30:00Z') === '20 Nov')
  check('short date of nothing is a dash', formatShortDate(null) === '-')
} catch (err) {
  failed++
  console.error('\n  ERROR', err.stack || err.message)
} finally {
  await vite.close()
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
