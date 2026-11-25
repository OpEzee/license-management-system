/*
 * Unit tests for the POC search helpers (client/src/services/clientSearch.js).
 *
 *   npm run test:client        (also part of npm test)
 *
 * Loaded through Vite's SSR loader, like dashboardStats.test.mjs.
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
  optimizeDeps: { noDiscovery: true, entries: [] },
})

try {
  const { matchClients, highlightParts } = await vite.ssrLoadModule('/src/services/clientSearch.js')

  const ravi1 = { id: 'a', clientName: 'Ravi Kumar', username: 'ravi@acme.in', companyName: 'Acme' }
  const ravi2 = { id: 'b', clientName: 'Ravi Kumar', username: 'ravi@globex.in', companyName: 'Globex' }
  const meena = { id: 'c', clientName: 'Meena', username: 'meena@initech.in', companyName: 'Initech' }
  const all = [ravi1, ravi2, meena]

  console.log('\n-- matching --')
  check('empty query matches nothing', matchClients(all, '').length === 0)
  check('whitespace query matches nothing', matchClients(all, '   ').length === 0)
  check('matches name, case-insensitive', matchClients(all, 'rAvI').length === 2)
  check('matches inside the name', matchClients(all, 'kum').length === 2)
  check('matches username', matchClients(all, 'globex.in')[0] === ravi2)
  check('matches company', matchClients(all, 'initech')[0] === meena)
  check('no match is empty', matchClients(all, 'zzz').length === 0)
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, clientName: `Client ${i}` }))
  check('caps at 8 by default', matchClients(many, 'client').length === 8)
  check('one row per client id', matchClients([ravi1, ravi1, meena], 'a').length === 2)
  check('skips clients without a name', matchClients([{ id: 'z', username: 'a@b.c' }], 'a').length === 0)

  console.log('\n-- ranking --')
  const names = (list) => list.map((c) => c.clientName)
  const pool = [
    { id: 'e', clientName: 'Zed', username: 'anil@zed.in', companyName: 'Zed Co' }, // email only
    { id: 'd', clientName: 'Vikram', username: 'v@x.in', companyName: 'Anil Traders' }, // company
    { id: 'c', clientName: 'Shanil', username: 's@x.in', companyName: 'X' }, // name contains
    { id: 'b', clientName: 'Anil Rao', username: 'ar@x.in', companyName: 'X' }, // starts with
    { id: 'a', clientName: 'anil Bose', username: 'ab@x.in', companyName: 'X' }, // starts with
  ]
  const ranked = names(matchClients(pool, 'anil'))
  check(
    'starts-with, then contains, then company, then email',
    JSON.stringify(ranked) === JSON.stringify(['anil Bose', 'Anil Rao', 'Shanil', 'Vikram', 'Zed']),
    ranked
  )
  const twins = [
    { id: 't2', clientName: 'Ravi', username: 'r2@x.in', companyName: 'Globex' },
    { id: 't1', clientName: 'Ravi', username: 'r1@x.in', companyName: 'Acme' },
  ]
  check('same names sort by company', matchClients(twins, 'ravi')[0].id === 't1')
  // All 20 "Client N" contain "en"; only the last one starts with it.
  const late = [...many, { id: 'late', clientName: 'Endo' }]
  check(
    'ranks before the cap, so a late starts-with match still shows',
    matchClients(late, 'en')[0].id === 'late'
  )

  console.log('\n-- highlighting --')
  const parts = highlightParts('Ravi Kumar', 'ku')
  check(
    'splits around the match',
    JSON.stringify(parts) ===
      JSON.stringify([
        { text: 'Ravi ', match: false },
        { text: 'Ku', match: true },
        { text: 'mar', match: false },
      ]),
    parts
  )
  check('marks every occurrence', highlightParts('aXaXa', 'a').filter((p) => p.match).length === 3)
  check('no query is one plain part', highlightParts('Acme', '').length === 1)
  check('empty text is no parts', highlightParts('', 'a').length === 0)
} catch (err) {
  failed++
  console.error('\n  ERROR', err.stack || err.message)
} finally {
  await vite.close()
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
