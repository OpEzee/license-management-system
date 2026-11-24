/*
 * End-to-end API tests. Runs the real Express app, routes, validators and
 * service layer against a throwaway database on the local MongoDB server
 * (created fresh and dropped afterwards). Run with: npm test
 */
process.env.NODE_ENV = 'test'
process.env.CORS_ORIGIN = 'http://localhost:5173'
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-the-check'

// Force email off. Without this, a configured .env would make the
// suite send real messages through the live SMTP provider.
process.env.SMTP_HOST = ''
process.env.SMTP_USER = ''
process.env.SMTP_PASS = ''
process.env.CLIENT_PIN = '1968'

const path = require('path')
const BACKEND = path.resolve(__dirname, '..')

// ---- database ---------------------------------------------------------------
// A throwaway database on the local MongoDB server, dropped when the run ends.
// Override the server with MONGODB_URI if it is not on the default port.
process.env.MONGODB_DB = `opezee_licenses_test_${process.pid}_${Date.now()}`

const db = require(path.join(BACKEND, 'config/db.js'))

async function dropTestDb() {
  try {
    await db.getDb().dropDatabase()
  } catch (e) {
    console.error('  could not drop test database:', e.message)
  }
  await db.closeDb().catch(() => {})
}

const adminService = require(path.join(BACKEND, 'services/adminService.js'))
const app = require(path.join(BACKEND, 'server.js'))

// ---- tiny test runner -------------------------------------------------------
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

const ADMIN = { email: 'admin@test.com', password: 'SuperSecret123' }

// Smallest valid PNG, used for the branding tests.
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const server = app.listen(0, async () => {
  try {
    await db.initDb()
  } catch (e) {
    console.error('\nCannot reach MongoDB for the tests:', e.message, '\n')
    process.exit(1)
  }
  const base = `http://127.0.0.1:${server.address().port}`
  let token = null

  const call = async (method, url, body, opts = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      Origin: opts.origin || 'http://localhost:5173',
    }
    if (opts.auth !== false && token) headers.Authorization = `Bearer ${token}`
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`
    // The app trusts one proxy hop, so this sets req.ip. Tests that make many
    // public calls use it to get their own rate-limit bucket.
    if (opts.ip) headers['X-Forwarded-For'] = opts.ip
    const res = await fetch(base + url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: res.status, body: await res.json(), headers: res.headers }
  }

  const newLicense = (over = {}) => ({
    clientName: 'John Doe',
    companyName: 'ABC Pvt Ltd',
    clientUserId: 'john.doe',
    productName: 'My Product',
    soldBy: 'Alex Seller',
    duration: '1_year',
    startDate: '2020-01-01',
    ...over,
  })

  try {
    console.log('\n-- health --')
    check('health ok', (await call('GET', '/health')).status === 200)

    console.log('\n-- authentication --')
    await adminService.upsertAdmin({ email: ADMIN.email, password: ADMIN.password })
    check('admin list requires a token', (await call('GET', '/api/licenses')).status === 401)
    check('products require a token', (await call('GET', '/api/products')).status === 401)
    check('settings require a token', (await call('GET', '/api/admin/emails')).status === 401)
    check(
      'a garbage token is rejected',
      (await call('GET', '/api/licenses', null, { token: 'not.a.jwt' })).status === 401
    )

    const badLogin = await call('POST', '/api/admin/login', { ...ADMIN, password: 'wrong' })
    check('wrong password -> 401', badLogin.status === 401, badLogin.body)
    check('login error does not reveal which field was wrong',
      badLogin.body.message === 'Invalid email or password')
    check(
      'unknown email -> 401',
      (await call('POST', '/api/admin/login', { email: 'nobody@test.com', password: 'whatever' }))
        .status === 401
    )

    const login = await call('POST', '/api/admin/login', ADMIN)
    check('correct credentials -> 200 with token', login.status === 200 && Boolean(login.body.token))
    check('login response omits the password hash', !JSON.stringify(login.body).includes('passwordHash'))
    token = login.body.token

    const me = await call('GET', '/api/admin/me')
    check('token identifies the admin', me.body.admin.email === ADMIN.email, me.body)

    console.log('\n-- products --')
    const prod = await call('POST', '/api/products', { name: 'My Product', description: 'Test' })
    check('creates a product', prod.status === 201, prod.body)
    check(
      'rejects a duplicate product name',
      (await call('POST', '/api/products', { name: 'my product' })).status === 409
    )
    check('rejects a nameless product', (await call('POST', '/api/products', {})).status === 400)
    const prodList = await call('GET', '/api/products')
    check('lists products', prodList.body.products.length === 1)
    const prodUpd = await call('PUT', `/api/products/${prod.body.product.id}`, {
      description: 'Updated',
    })
    check('updates a product', prodUpd.body.product.description === 'Updated', prodUpd.body)

    console.log('\n-- license durations --')
    const yearly = await call('POST', '/api/licenses', newLicense())
    check('creates a license', yearly.status === 201, yearly.body)
    const lic = yearly.body.license
    check('key is 6 characters, letters and numbers', /^[A-Z0-9]{6}$/.test(lic.licenseKey) && /[A-Z]/.test(lic.licenseKey) && /[0-9]/.test(lic.licenseKey), lic.licenseKey)
    check('start date stored at start of day UTC', lic.startDate === '2020-01-01T00:00:00.000Z', lic.startDate)
    check('1 year computes the expiry', lic.expiryDate === '2021-01-01T23:59:59.999Z', lic.expiryDate)

    const m1 = await call('POST', '/api/licenses', newLicense({ duration: '1_month', startDate: '2020-01-31' }))
    check('1 month from 31 Jan clamps to 29 Feb',
      m1.body.license.expiryDate === '2020-02-29T23:59:59.999Z', m1.body.license.expiryDate)

    const m3 = await call('POST', '/api/licenses', newLicense({ duration: '3_months', startDate: '2020-01-01' }))
    check('3 months computes the expiry', m3.body.license.expiryDate === '2020-04-01T23:59:59.999Z')

    const m6 = await call('POST', '/api/licenses', newLicense({ duration: '6_months', startDate: '2020-01-01' }))
    check('6 months computes the expiry', m6.body.license.expiryDate === '2020-07-01T23:59:59.999Z')

    const custom = await call('POST', '/api/licenses', newLicense({
      duration: 'custom', startDate: '2020-01-01', expiryDate: '2030-06-15',
    }))
    check('custom uses the supplied expiry',
      custom.body.license.expiryDate === '2030-06-15T23:59:59.999Z', custom.body.license.expiryDate)

    const badPeriod = await call('POST', '/api/licenses', newLicense({
      duration: 'custom', startDate: '2030-01-01', expiryDate: '2029-01-01',
    }))
    check('rejects expiry before start', badPeriod.status === 400, badPeriod.body)
    check('rejects a custom duration with no expiry',
      (await call('POST', '/api/licenses', newLicense({ duration: 'custom', expiryDate: undefined }))).status === 400)
    check('rejects an unknown duration',
      (await call('POST', '/api/licenses', newLicense({ duration: '99_years' }))).status === 400)
    // A form posts an untouched field as '', not as undefined. The optional
    // fields have to tolerate that, or the form cannot submit at all.
    const blankUserId = await call('POST', '/api/licenses', newLicense({ clientUserId: '' }))
    check('accepts a blank client user id', blankUserId.status === 201, blankUserId.body)
    await call('DELETE', `/api/licenses/${blankUserId.body.license.id}`)
    check('rejects a blank client name',
      (await call('POST', '/api/licenses', newLicense({ clientName: '' }))).status === 400)
    check('rejects a license with no client name at all',
      (await call('POST', '/api/licenses', {
        clientUserId: 'ghost.user', productName: 'My Product', soldBy: 'Alex Seller',
        duration: '1_year', startDate: '2020-01-01',
      })).status === 400)

    console.log('\n-- sold by --')
    check('records who sold the license', lic.soldBy === 'Alex Seller', lic.soldBy)
    check('rejects a license with no seller',
      (await call('POST', '/api/licenses', newLicense({ soldBy: '' }))).status === 400)
    check('the seller is not exposed to the product',
      !('soldBy' in (await call('POST', '/api/licenses/verify',
        { licenseKey: lic.licenseKey }, { auth: false })).body.license))

    console.log('\n-- derived status --')
    check('ongoing period is active', custom.body.license.status === 'active')
    check('finished period is expired', m3.body.license.status === 'expired', m3.body.license.status)
    const future = await call('POST', '/api/licenses', newLicense({
      clientUserId: 'future.user', duration: '3_months', startDate: '2090-01-01',
    }))
    check('future start date is pending', future.body.license.status === 'pending', future.body.license.status)

    console.log('\n-- verification --')
    const active = custom.body.license
    const v1 = await call('POST', '/api/licenses/verify',
      { licenseKey: active.licenseKey, productName: 'My Product' }, { auth: false })
    check('valid key -> 200 valid:true', v1.status === 200 && v1.body.valid === true, v1.body)
    check('verify needs no token', !v1.headers.get('www-authenticate'))
    check('valid response carries startDate', v1.body.license.startDate === active.startDate)
    check('valid response carries expiryDate', v1.body.license.expiryDate === active.expiryDate)
    check('valid response hides the client user id and id',
      !('clientUserId' in v1.body.license) && !('id' in v1.body.license))

    const v2 = await call('POST', '/api/licenses/verify', { licenseKey: 'OPEZ-0000-0000-0000' }, { auth: false })
    check('unknown key -> 404 invalid', v2.status === 404 && v2.body.valid === false, v2.body)

    const v3 = await call('POST', '/api/licenses/verify', { licenseKey: m3.body.license.licenseKey }, { auth: false })
    check('expired key -> 200 valid:false', v3.status === 200 && v3.body.valid === false)
    check('expired message', v3.body.message === 'License has expired')
    check('expired response carries the expiry date', Boolean(v3.body.license.expiryDate))

    const v4 = await call('POST', '/api/licenses/verify', { licenseKey: future.body.license.licenseKey }, { auth: false })
    check('not-yet-started key -> valid:false, pending',
      v4.body.valid === false && v4.body.license.status === 'pending', v4.body)

    const v5 = await call('POST', '/api/licenses/verify',
      { licenseKey: active.licenseKey, productName: 'Other Product' }, { auth: false })
    check('wrong product -> not valid',
      v5.body.valid === false && v5.body.message === 'License is not valid for this product')

    const v6 = await call('POST', '/api/licenses/verify',
      { licenseKey: active.licenseKey.toLowerCase().replace(/-/g, ' ') }, { auth: false })
    check('key normalization (lowercase/spaces)', v6.body.valid === true)
    check('empty key -> 400',
      (await call('POST', '/api/licenses/verify', { licenseKey: '' }, { auth: false })).status === 400)

    console.log('\n-- sync --')
    const s1 = await call('POST', '/api/licenses/sync',
      { licenseKey: active.licenseKey, productName: 'My Product' }, { auth: false })
    check('sync returns validity and status', s1.body.valid === true && s1.body.status === 'active', s1.body)
    check('sync returns startDate and expiryDate',
      s1.body.startDate === active.startDate && s1.body.expiryDate === active.expiryDate)
    check('sync returns checkedAt', !Number.isNaN(Date.parse(s1.body.checkedAt)))
    check('sync needs no token', s1.status === 200)

    const s2 = await call('POST', '/api/licenses/sync', { licenseKey: m3.body.license.licenseKey }, { auth: false })
    check('sync reports an expired license', s2.body.valid === false && s2.body.status === 'expired')
    check('sync on unknown key -> 404',
      (await call('POST', '/api/licenses/sync', { licenseKey: 'OPEZ-0000-0000-0000' }, { auth: false })).status === 404)

    console.log('\n-- deactivation --')
    const live = custom.body.license // active: 2020-01-01 -> 2030-06-15
    check('a license starts active', live.status === 'active' && live.deactivated === false)
    check('rejects a non-boolean flag',
      (await call('PUT', `/api/licenses/${live.id}/status`, { deactivated: 'maybe' })).status === 400)
    check('deactivating requires a token',
      (await call('PUT', `/api/licenses/${live.id}/status`, { deactivated: true },
        { auth: false, token: 'bad.token' })).status === 401)
    check('deactivating an unknown license -> 404',
      (await call('PUT', '/api/licenses/nope/status', { deactivated: true })).status === 404)

    const off = await call('PUT', `/api/licenses/${live.id}/status`, { deactivated: true })
    check('deactivates the license', off.status === 200 && off.body.license.status === 'deactivated', off.body)
    check('the dates are left untouched',
      off.body.license.expiryDate === live.expiryDate && off.body.license.startDate === live.startDate)

    const vOff = await call('POST', '/api/licenses/verify',
      { licenseKey: live.licenseKey, productName: 'My Product' }, { auth: false })
    check('a deactivated key is NOT valid', vOff.status === 200 && vOff.body.valid === false, vOff.body)
    check('verify explains why', vOff.body.message === 'License has been deactivated')
    check('verify reports the deactivated status', vOff.body.license.status === 'deactivated')

    const sOff = await call('POST', '/api/licenses/sync', { licenseKey: live.licenseKey }, { auth: false })
    check('sync also reports it as not valid',
      sOff.body.valid === false && sOff.body.status === 'deactivated', sOff.body)

    const statsOff = await call('GET', '/api/licenses/stats')
    check('stats count it as deactivated, not expired',
      statsOff.body.stats.deactivatedLicenses === 1, statsOff.body.stats)

    const on = await call('PUT', `/api/licenses/${live.id}/status`, { deactivated: false })
    check('reactivates the license', on.body.license.status === 'active', on.body)
    check('the key verifies again',
      (await call('POST', '/api/licenses/verify',
        { licenseKey: live.licenseKey }, { auth: false })).body.valid === true)

    console.log('\n-- no machine lock --')
    // Its own IP, so these calls do not eat the shared verify rate limit.
    const MACHINE_TEST_IP = '203.0.113.7'
    // A key is not tied to a machine: whoever holds it can use it, on as many
    // installations as they like.
    const anywhere = (await call('POST', '/api/licenses', newLicense({
      duration: 'custom', startDate: '2020-01-01', expiryDate: '2099-01-01',
    }))).body.license
    check('a license carries no machine number', !('machineNumber' in anywhere), anywhere)

    const first = await call('POST', '/api/licenses/verify',
      { licenseKey: anywhere.licenseKey, productName: 'My Product' },
      { auth: false, ip: MACHINE_TEST_IP })
    check('a key verifies without a machine number',
      first.status === 200 && first.body.valid === true, first.body)
    check('the answer names no machine', !('machineNumber' in first.body.license), first.body)

    // Products built before the change still send one; it is ignored.
    const pcA = await call('POST', '/api/licenses/verify',
      { licenseKey: anywhere.licenseKey, productName: 'My Product', machineNumber: 'PC-ALPHA-01' },
      { auth: false, ip: MACHINE_TEST_IP })
    const pcB = await call('POST', '/api/licenses/verify',
      { licenseKey: anywhere.licenseKey, productName: 'My Product', machineNumber: 'PC-BETA-02' },
      { auth: false, ip: MACHINE_TEST_IP })
    check('the same key verifies on two machines',
      pcA.body.valid === true && pcB.body.valid === true, [pcA.body, pcB.body])
    check('a machine number sent by an older product is not stored',
      !('machineNumber' in (await call('GET', `/api/licenses/${anywhere.id}`)).body.license))

    const syncAny = await call('POST', '/api/licenses/sync',
      { licenseKey: anywhere.licenseKey, machineNumber: 'PC-GAMMA-03' }, { auth: false, ip: MACHINE_TEST_IP })
    check('sync answers for any machine', syncAny.body.valid === true, syncAny.body)
    check('sync names no machine', !('machineNumber' in syncAny.body), syncAny.body)

    await call('DELETE', `/api/licenses/${anywhere.id}`)

    console.log('\n-- digital diya validate --')
    const DD_IP = '203.0.113.11'
    const DD_URL = '/api/licenses/digital-diya/validate'
    const ddLive = (await call('POST', '/api/licenses', newLicense({
      productName: 'Digital Diya', duration: 'custom', startDate: '2020-01-01', expiryDate: '2099-01-01',
    }))).body.license
    const ddOld = (await call('POST', '/api/licenses', newLicense({
      productName: 'Digital Diya', duration: 'custom', startDate: '2020-01-01', expiryDate: '2020-02-01',
    }))).body.license
    const otherProduct = (await call('POST', '/api/licenses', newLicense({
      duration: 'custom', startDate: '2020-01-01', expiryDate: '2099-01-01',
    }))).body.license

    const ddOk = await call('POST', DD_URL, { licenseKey: ddLive.licenseKey }, { auth: false, ip: DD_IP })
    check('a live Digital Diya key is valid, with no token',
      ddOk.status === 200 && ddOk.body.valid === true && ddOk.body.status === 'active', ddOk.body)
    check('the answer carries the license',
      ddOk.body.license.licenseKey === ddLive.licenseKey && ddOk.body.license.productName === 'Digital Diya', ddOk.body)
    check('… with the POC and their email, for the status page',
      ddOk.body.license.clientName === ddLive.clientName && ddOk.body.license.clientUserId === ddLive.clientUserId &&
        Boolean(ddLive.clientUserId), ddOk.body.license)

    check('the key is normalized before lookup',
      (await call('POST', DD_URL, { licenseKey: ' ' + ddLive.licenseKey.toLowerCase() + ' ' },
        { auth: false, ip: DD_IP })).body.valid === true)

    const ddExpired = await call('POST', DD_URL, { licenseKey: ddOld.licenseKey }, { auth: false, ip: DD_IP })
    check('an expired Digital Diya key is not valid',
      ddExpired.status === 200 && ddExpired.body.valid === false && ddExpired.body.status === 'expired', ddExpired.body)

    await call('PUT', `/api/licenses/${ddLive.id}/status`, { deactivated: true })
    const ddOff = await call('POST', DD_URL, { licenseKey: ddLive.licenseKey }, { auth: false, ip: DD_IP })
    check('a deactivated Digital Diya key is not valid',
      ddOff.body.valid === false && ddOff.body.status === 'deactivated', ddOff.body)
    await call('PUT', `/api/licenses/${ddLive.id}/status`, { deactivated: false })

    const ddOther = await call('POST', DD_URL, { licenseKey: otherProduct.licenseKey }, { auth: false, ip: DD_IP })
    check('a key for another product is refused',
      ddOther.status === 403 && ddOther.body.valid === false && ddOther.body.status === 'invalid', ddOther.body)

    const ddProductSent = await call('POST', DD_URL,
      { licenseKey: otherProduct.licenseKey, productName: 'My Product' }, { auth: false, ip: DD_IP })
    check('a productName in the body cannot widen it to another product', ddProductSent.status === 403, ddProductSent.body)

    const ddUnknown = await call('POST', DD_URL, { licenseKey: 'ZZZZ99' }, { auth: false, ip: DD_IP })
    check('an unknown key is 404', ddUnknown.status === 404 && ddUnknown.body.valid === false, ddUnknown.body)

    check('a missing key is 400',
      (await call('POST', DD_URL, {}, { auth: false, ip: DD_IP })).status === 400)

    check('the other products still verify as before',
      (await call('POST', '/api/licenses/verify', { licenseKey: otherProduct.licenseKey, productName: 'My Product' },
        { auth: false, ip: DD_IP })).body.valid === true)

    // The auto-sync endpoint: same checks, flat shape, always a checkedAt.
    const DD_SYNC_IP = '203.0.113.12'
    const DD_SYNC = '/api/licenses/digital-diya/sync'
    const ddsOk = await call('POST', DD_SYNC, { licenseKey: ddLive.licenseKey }, { auth: false, ip: DD_SYNC_IP })
    check('sync: a live Digital Diya key is valid',
      ddsOk.status === 200 && ddsOk.body.valid === true && ddsOk.body.status === 'active', ddsOk.body)
    check('sync: the answer is flat, with the key, dates and checkedAt',
      ddsOk.body.licenseKey === ddLive.licenseKey && ddsOk.body.productName === 'Digital Diya' &&
        Boolean(ddsOk.body.expiryDate) && !Number.isNaN(Date.parse(ddsOk.body.checkedAt)), ddsOk.body)
    check('sync: … and the POC with their email, so a PC set up earlier learns it',
      ddsOk.body.license.clientName === ddLive.clientName && ddsOk.body.license.clientUserId === ddLive.clientUserId, ddsOk.body.license)

    const ddsExpired = await call('POST', DD_SYNC, { licenseKey: ddOld.licenseKey }, { auth: false, ip: DD_SYNC_IP })
    check('sync: an expired key is reported as expired',
      ddsExpired.status === 200 && ddsExpired.body.valid === false && ddsExpired.body.status === 'expired', ddsExpired.body)

    await call('PUT', `/api/licenses/${ddLive.id}/status`, { deactivated: true })
    const ddsOff = await call('POST', DD_SYNC, { licenseKey: ddLive.licenseKey }, { auth: false, ip: DD_SYNC_IP })
    check('sync: switching a key off shows on the next sync',
      ddsOff.body.valid === false && ddsOff.body.status === 'deactivated', ddsOff.body)
    await call('PUT', `/api/licenses/${ddLive.id}/status`, { deactivated: false })
    check('sync: switching it back on shows too',
      (await call('POST', DD_SYNC, { licenseKey: ddLive.licenseKey }, { auth: false, ip: DD_SYNC_IP })).body.valid === true)

    const ddsOther = await call('POST', DD_SYNC, { licenseKey: otherProduct.licenseKey }, { auth: false, ip: DD_SYNC_IP })
    check('sync: a key for another product is refused, with checkedAt',
      ddsOther.status === 403 && ddsOther.body.status === 'invalid' && Boolean(ddsOther.body.checkedAt), ddsOther.body)

    const ddsUnknown = await call('POST', DD_SYNC, { licenseKey: 'ZZZZ99' }, { auth: false, ip: DD_SYNC_IP })
    check('sync: an unknown key is 404, with checkedAt',
      ddsUnknown.status === 404 && Boolean(ddsUnknown.body.checkedAt), ddsUnknown.body)

    check('sync: a missing key is 400',
      (await call('POST', DD_SYNC, {}, { auth: false, ip: DD_SYNC_IP })).status === 400)

    // Screen app 1.4.13: the sync carries the screens the key runs on.
    check('sync: no screens reported yet → screens is null',
      ddsOk.body.screens === null && (await call('GET', `/api/licenses/${ddLive.id}`)).body.license.screens === null, ddsOk.body)
    const ddsSeats = await call('POST', DD_SYNC,
      { licenseKey: ddLive.licenseKey, screens: { used: 2, limit: 4, plan: 'Standard' } }, { auth: false, ip: DD_SYNC_IP })
    check('sync: screens { used, limit, plan } are stored and echoed',
      ddsSeats.status === 200 && ddsSeats.body.screens.used === 2 && ddsSeats.body.screens.limit === 4 &&
        ddsSeats.body.screens.plan === 'Standard', ddsSeats.body)
    const seatsDoc = (await call('GET', `/api/licenses/${ddLive.id}`)).body.license
    check('the license shows them, with when they were reported',
      seatsDoc.screens && seatsDoc.screens.used === 2 && seatsDoc.screens.limit === 4 &&
        !Number.isNaN(Date.parse(seatsDoc.screens.updatedAt)), seatsDoc.screens)
    const seatsAgain = await call('POST', DD_SYNC,
      { licenseKey: ddLive.licenseKey, screens: { used: 2, limit: 4, plan: 'Standard' } }, { auth: false, ip: DD_SYNC_IP })
    check('the same count again is not rewritten',
      seatsAgain.body.screens.updatedAt === seatsDoc.screens.updatedAt, seatsAgain.body.screens)
    const noLimit = await call('POST', DD_SYNC,
      { licenseKey: ddLive.licenseKey, screens: { used: 3, limit: null, plan: null } }, { auth: false, ip: DD_SYNC_IP })
    check('no limit (a server without a plan) is stored as limit null',
      noLimit.body.screens.used === 3 && noLimit.body.screens.limit === null && noLimit.body.screens.plan === null, noLimit.body)
    check('a sync without screens leaves them as they were',
      (await call('POST', DD_SYNC, { licenseKey: ddLive.licenseKey }, { auth: false, ip: DD_SYNC_IP })).body.screens.used === 3)
    for (const [what, screens] of [
      ['not an object', 'two'], ['a negative count', { used: -1 }], ['no count', { limit: 4 }],
      ['a zero limit', { used: 1, limit: 0 }], ['a long plan name', { used: 1, plan: 'x'.repeat(41) }],
    ]) {
      check(`sync: screens with ${what} → 400`,
        (await call('POST', DD_SYNC, { licenseKey: ddLive.licenseKey, screens }, { auth: false, ip: DD_SYNC_IP })).status === 400)
    }

    console.log('\n-- licence details behind the staff PIN --')
    const PIN_URL = '/api/licenses/details'
    const pinAsk = (body, ip = '203.0.113.31') => call('POST', PIN_URL, body, { auth: false, ip })
    const wrongPin = await pinAsk({ licenseKey: ddLive.licenseKey, productName: 'Digital Diya', pin: '1234' })
    check('details: a wrong PIN is 401 WRONG_PIN, with no record',
      wrongPin.status === 401 && wrongPin.body.code === 'WRONG_PIN' && !wrongPin.body.license, wrongPin.body)
    const rightPin = await pinAsk({ licenseKey: ddLive.licenseKey, productName: 'Digital Diya', pin: '1968' })
    check('details: the right PIN needs no admin token and returns the whole record',
      rightPin.status === 200 && rightPin.body.license.licenseKey === ddLive.licenseKey &&
        rightPin.body.license.clientName === ddLive.clientName && rightPin.body.license.clientUserId === ddLive.clientUserId &&
        rightPin.body.license.companyName === ddLive.companyName && rightPin.body.license.status === 'active' &&
        Boolean(rightPin.body.license.expiryDate), rightPin.body)
    const oldPin = await pinAsk({ licenseKey: ddOld.licenseKey, productName: 'Digital Diya', pin: '1968' })
    check('details: an expired licence is shown too, as expired',
      oldPin.status === 200 && oldPin.body.license.status === 'expired', oldPin.body)
    check('details: a key for another product is 403',
      (await pinAsk({ licenseKey: otherProduct.licenseKey, productName: 'Digital Diya', pin: '1968' })).status === 403)
    check('details: an unknown key is 404',
      (await pinAsk({ licenseKey: 'ZZZZ99', pin: '1968' })).status === 404)
    check('details: no PIN sent is 400',
      (await pinAsk({ licenseKey: ddLive.licenseKey })).status === 400)
    process.env.CLIENT_PIN = ''
    const noPin = await pinAsk({ licenseKey: ddLive.licenseKey, pin: '' })
    check('details: with no CLIENT_PIN on the server, nothing opens (503)',
      noPin.status === 503 && noPin.body.code === 'PIN_NOT_CONFIGURED', noPin.body)
    process.env.CLIENT_PIN = '1968'
    const guesses = []
    for (let i = 0; i < 11; i += 1) guesses.push((await pinAsk({ licenseKey: ddLive.licenseKey, pin: '0000' }, '203.0.113.32')).status)
    check('details: wrong PINs are capped at 10 per 15 minutes',
      guesses.slice(0, 10).every((c) => c === 401) && guesses[10] === 429, guesses)

    await call('DELETE', `/api/licenses/${ddLive.id}`)
    await call('DELETE', `/api/licenses/${ddOld.id}`)
    await call('DELETE', `/api/licenses/${otherProduct.id}`)

    console.log('\n-- product self-service (POC + email) --')
    const SELF_IP = '203.0.113.9'
    const self = (await call('POST', '/api/licenses', newLicense({
      clientName: 'Old Name', clientUserId: 'old.contact@test.com',
      duration: 'custom', startDate: '2020-01-01', expiryDate: '2099-01-01',
    }))).body.license

    const noToken = await call('PUT', '/api/licenses/poc',
      { licenseKey: self.licenseKey, pocName: 'X' },
      { auth: false, ip: SELF_IP })
    check('the endpoints need no admin token',
      noToken.status !== 401 && noToken.body.code !== 'NO_TOKEN', noToken.body)

    const poc = await call('PUT', '/api/licenses/poc',
      { licenseKey: self.licenseKey, pocName: 'New Name' },
      { auth: false, ip: SELF_IP })
    check('the key holder can change the POC name',
      poc.status === 200 && poc.body.license.pocName === 'New Name', poc.body)

    const mail = await call('PUT', '/api/licenses/email',
      { licenseKey: self.licenseKey, email: 'new.contact@test.com' },
      { auth: false, ip: SELF_IP })
    check('and the email', mail.status === 200 && mail.body.license.email === 'new.contact@test.com', mail.body)

    const saved = (await call('GET', `/api/licenses/${self.id}`)).body.license
    check('both changes are saved on the license',
      saved.clientName === 'New Name' && saved.clientUserId === 'new.contact@test.com', saved)
    check('changing one does not clear the other',
      saved.clientName === 'New Name' && saved.productName === 'My Product')

    check('an unknown key is refused',
      (await call('PUT', '/api/licenses/poc',
        { licenseKey: 'OPEZ-0000-0000-0000', pocName: 'Nope' },
        { auth: false, ip: SELF_IP })).status === 404)
    check('the wrong product is refused',
      (await call('PUT', '/api/licenses/poc',
        { licenseKey: self.licenseKey, productName: 'Other', pocName: 'Nope' },
        { auth: false, ip: SELF_IP })).status === 403)
    check('a malformed email is refused',
      (await call('PUT', '/api/licenses/email',
        { licenseKey: self.licenseKey, email: 'not-an-email' },
        { auth: false, ip: SELF_IP })).status === 400)
    check('an empty POC name is refused',
      (await call('PUT', '/api/licenses/poc',
        { licenseKey: self.licenseKey, pocName: '' },
        { auth: false, ip: SELF_IP })).status === 400)

    // A switched-off license cannot rewrite its own record.
    await call('PUT', `/api/licenses/${self.id}/status`, { deactivated: true })
    check('a deactivated license cannot be edited',
      (await call('PUT', '/api/licenses/poc',
        { licenseKey: self.licenseKey, pocName: 'Nope' },
        { auth: false, ip: SELF_IP })).status === 403)
    await call('PUT', `/api/licenses/${self.id}/status`, { deactivated: false })

    await call('DELETE', `/api/licenses/${self.id}`)

    console.log('\n-- clients + stats --')
    const stats = await call('GET', '/api/licenses/stats')
    check('stats counts pending separately', stats.body.stats.pendingLicenses === 1, stats.body.stats)
    const clientList = await call('GET', '/api/clients')
    check('clients are grouped by username', clientList.body.clients.length === 2, clientList.body.count)
    const john = clientList.body.clients.find((c) => c.username === 'john.doe')
    check('client aggregates their licenses', john.totalLicenses === 5, john)
    check('a license-only client has no login yet', john.hasLogin === false)

    console.log('\n-- client accounts --')
    check('the client list requires a token',
      (await call('GET', '/api/clients', null, { auth: false, token: 'bad.token' })).status === 401)

    const newClient = {
      clientName: 'John Doe',
      companyName: 'ABC Pvt Ltd',
      username: 'john.doe',
      password: 'ClientPass123',
    }
    const created = await call('POST', '/api/clients', newClient)
    check('adds a client with credentials', created.status === 201, created.body)
    check('the password hash is never returned',
      !JSON.stringify(created.body).includes('passwordHash'), created.body)
    // The console shows the password, so admin responses carry it deliberately.
    check('admin responses include the readable password',
      created.body.client.password === 'ClientPass123', created.body.client)
    check('rejects a duplicate username',
      (await call('POST', '/api/clients', { ...newClient, username: 'JOHN.DOE' })).status === 409)
    check('rejects a short password',
      (await call('POST', '/api/clients', { ...newClient, username: 'someone.else', password: 'short' }))
        .status === 400)
    check('rejects an invalid username',
      (await call('POST', '/api/clients', { ...newClient, username: 'has spaces' })).status === 400)

    const merged = await call('GET', '/api/clients')
    const johnNow = merged.body.clients.find((c) => c.username === 'john.doe')
    check('the account merges with their existing licenses',
      johnNow.hasLogin === true && johnNow.totalLicenses === 5, johnNow)
    check('no duplicate row is created for the same username',
      merged.body.clients.filter((c) => c.username === 'john.doe').length === 1)
    check('the client list carries the readable password',
      johnNow.password === 'ClientPass123', johnNow.password)

    // The name typed on the form is what the license keeps, even when the
    // user ID matches an account with a different name on it.
    const typedName = await call('POST', '/api/licenses', {
      clientName: 'Johnny D', clientUserId: 'john.doe', productName: 'My Product',
      soldBy: 'Alex Seller', duration: '1_year', startDate: '2020-01-01',
    })
    check('a license keeps the client name it was given',
      typedName.status === 201 && typedName.body.license.clientName === 'Johnny D',
      typedName.body)
    check('a linked account only fills in what was left blank',
      typedName.body.license.companyName === 'ABC Pvt Ltd')
    await call('DELETE', `/api/licenses/${typedName.body.license.id}`)

    // No user ID at all: the license names a client who has no account.
    const nameOnly = await call('POST', '/api/licenses', {
      clientName: 'Walk-in Buyer', productName: 'My Product', soldBy: 'Alex Seller',
      duration: '1_year', startDate: '2020-01-01',
    })
    check('a license can be created with just a client name',
      nameOnly.status === 201 && nameOnly.body.license.clientName === 'Walk-in Buyer',
      nameOnly.body)
    check('and it still appears on the Clients page',
      (await call('GET', '/api/clients')).body.clients
        .some((c) => c.clientName === 'Walk-in Buyer'))
    const noName = await call('POST', '/api/licenses', {
      productName: 'My Product', soldBy: 'Alex Seller',
      duration: '1_year', startDate: '2020-01-01',
    })
    check('but a client name is required', noName.status === 400, noName.body)
    await call('DELETE', `/api/licenses/${nameOnly.body.license.id}`)

    console.log('\n-- product login --')
    const badUser = await call('POST', '/api/clients/login',
      { username: 'nobody', password: 'whatever' }, { auth: false })
    check('unknown username -> 401', badUser.status === 401, badUser.body)
    check('login error does not reveal which field was wrong',
      badUser.body.message === 'Invalid username or password')
    check('wrong password -> 401',
      (await call('POST', '/api/clients/login',
        { username: 'john.doe', password: 'nope' }, { auth: false })).status === 401)

    const good = await call('POST', '/api/clients/login',
      { username: 'JOHN.DOE', password: 'ClientPass123' }, { auth: false })
    check('correct credentials -> 200 valid', good.status === 200 && good.body.valid === true, good.body)
    check('login needs no admin token', good.status === 200)
    check('username matching ignores case', good.body.client.username === 'john.doe')
    check('login returns the client identity', good.body.client.clientName === 'John Doe')
    check('login never leaks a hash or password',
      !JSON.stringify(good.body).includes('passwordHash') &&
        !JSON.stringify(good.body).includes('ClientPass123'))
    check('login returns their licenses', good.body.licenses.length === 5, good.body.licenses.length)
    check('each license carries its own validity',
      good.body.licenses.every((l) => typeof l.valid === 'boolean' && l.licenseKey))

    const filtered = await call('POST', '/api/clients/login',
      { username: 'john.doe', password: 'ClientPass123', productName: 'My Product' }, { auth: false })
    check('productName filters the licenses returned',
      filtered.body.licenses.every((l) => l.productName === 'My Product'))

    console.log('\n-- client edit + delete --')
    const clientId = created.body.client.id
    const renamed = await call('PUT', `/api/clients/${clientId}`, { clientName: 'Jonathan Doe' })
    check('updates a client without touching the password', renamed.body.client.clientName === 'Jonathan Doe')
    check('the old password still works',
      (await call('POST', '/api/clients/login',
        { username: 'john.doe', password: 'ClientPass123' }, { auth: false })).status === 200)

    // Editing a client must change the existing row, not appear to add one.
    // Licenses are matched on the user id, so a changed email has to be
    // carried through to them or the client shows up twice.
    const rowsBefore = (await call('GET', '/api/clients')).body.clients.length
    await call('PUT', `/api/clients/${clientId}`, { username: 'jonathan.doe' })
    const afterEmail = (await call('GET', '/api/clients')).body.clients
    check('changing the email does not split the client in two',
      afterEmail.length === rowsBefore, afterEmail.map((c) => c.username))

    const moved = afterEmail.find((c) => c.username === 'jonathan.doe')
    check('the licenses move with them', moved && moved.totalLicenses === 5, moved)
    check('no login-less leftover is left behind',
      !afterEmail.some((c) => c.username === 'john.doe'))
    check('the client signs in with the new email',
      (await call('POST', '/api/clients/login',
        { username: 'jonathan.doe', password: 'ClientPass123' }, { auth: false })).status === 200)

    await call('PUT', `/api/clients/${clientId}`, { username: 'john.doe' })

    await call('PUT', `/api/clients/${clientId}`, { password: 'BrandNewPass9' })
    check('changing the password invalidates the old one',
      (await call('POST', '/api/clients/login',
        { username: 'john.doe', password: 'ClientPass123' }, { auth: false })).status === 401)
    check('the new password works',
      (await call('POST', '/api/clients/login',
        { username: 'john.doe', password: 'BrandNewPass9' }, { auth: false })).status === 200)

    check('cannot delete a client that still holds licenses',
      (await call('DELETE', `/api/clients/${clientId}`)).status === 409)

    // The POC name identifies the person, so it is unique across accounts —
    // which is what makes several licenses naming it belong to one client
    // rather than to look-alike duplicates.
    const poc1 = await call('POST', '/api/clients', {
      clientName: 'Unique Poc', companyName: 'Poc Co One',
      username: 'poc.one@test.com', password: 'PocPass12345',
    })
    check('a client can be created with a fresh POC name', poc1.status === 201, poc1.body)

    const poc2 = await call('POST', '/api/clients', {
      clientName: 'unique poc', companyName: 'Poc Co Two',
      username: 'poc.two@test.com', password: 'PocPass12345',
    })
    check('a duplicate POC name is refused, ignoring case', poc2.status === 409, poc2.body)
    check('and says which field clashed', poc2.body.code === 'POC_TAKEN')

    check('renaming onto an existing POC name is refused too',
      (await call('PUT', `/api/clients/${poc1.body.client.id}`,
        { clientName: 'Jonathan Doe' })).status === 409)
    check('a client keeps its own POC name on edit',
      (await call('PUT', `/api/clients/${poc1.body.client.id}`,
        { clientName: 'Unique Poc', companyName: 'Poc Co One Renamed' })).status === 200)

    // Several licenses for that one POC all land on the same client.
    const lic1 = await call('POST', '/api/licenses', newLicense({
      clientName: 'Unique Poc', clientUserId: 'poc.one@test.com',
      duration: 'custom', startDate: '2020-01-01', expiryDate: '2099-01-01',
    }))
    const lic2 = await call('POST', '/api/licenses', newLicense({
      clientName: 'Unique Poc', clientUserId: 'poc.one@test.com', productName: 'Second Product',
      duration: 'custom', startDate: '2020-01-01', expiryDate: '2099-01-01',
    }))
    check('two licenses can be issued to one POC',
      lic1.status === 201 && lic2.status === 201 &&
        lic1.body.license.licenseKey !== lic2.body.license.licenseKey, lic2.body)

    const pocRows = (await call('GET', '/api/clients')).body.clients
      .filter((c) => (c.clientName || '').toLowerCase() === 'unique poc')
    check('they gather on a single client row',
      pocRows.length === 1 && pocRows[0].totalLicenses === 2, pocRows)

    // The Create License form may send only the POC name. That must still land
    // on the existing POC, not start a look-alike login-less one.
    const byName = await call('POST', '/api/licenses', newLicense({
      clientName: 'UNIQUE POC ', clientUserId: undefined, companyName: undefined, duration: 'custom', startDate: '2020-01-01', expiryDate: '2099-01-01',
    }))
    check('a license issued by POC name alone links to that POC',
      byName.status === 201 && byName.body.license.clientUserId === 'poc.one@test.com', byName.body)
    check('and picks up the POC company',
      byName.body.license.companyName === 'Poc Co One Renamed', byName.body.license)
    const pocRowsAfter = (await call('GET', '/api/clients')).body.clients
      .filter((c) => (c.clientName || '').toLowerCase().trim() === 'unique poc')
    check('no second row appears for that POC',
      pocRowsAfter.length === 1 && pocRowsAfter[0].totalLicenses === 3, pocRowsAfter)
    const pocLogin = await call('POST', '/api/clients/login',
      { username: 'poc.one@test.com', password: 'PocPass12345' }, { auth: false })
    check("the POC's product login sees the new license",
      pocLogin.body.licenses.some((l) => l.licenseKey === byName.body.license.licenseKey),
      pocLogin.body.licenses)

    // An unlinked license renamed to an existing POC joins that POC on save.
    const stray = await call('POST', '/api/licenses', newLicense({
      clientName: 'Nobody Yet', clientUserId: undefined, duration: 'custom', startDate: '2020-01-01', expiryDate: '2099-01-01',
    }))
    check('a new POC name stays unlinked', stray.body.license.clientUserId === '', stray.body.license)
    const joined = await call('PUT', `/api/licenses/${stray.body.license.id}`, { clientName: 'Unique Poc' })
    check('renaming it to an existing POC links it',
      joined.body.license.clientUserId === 'poc.one@test.com', joined.body)

    await call('DELETE', `/api/licenses/${byName.body.license.id}`)
    await call('DELETE', `/api/licenses/${stray.body.license.id}`)
    await call('DELETE', `/api/licenses/${lic1.body.license.id}`)
    await call('DELETE', `/api/licenses/${lic2.body.license.id}`)
    await call('DELETE', `/api/clients/${poc1.body.client.id}`)

    const spare = await call('POST', '/api/clients', {
      clientName: 'Temp', companyName: 'Temp Co', username: 'temp.user', password: 'TempPass123',
    })
    check('a client with no licenses can be deleted',
      (await call('DELETE', `/api/clients/${spare.body.client.id}`)).status === 200)
    check('deleting an unknown client -> 404',
      (await call('DELETE', '/api/clients/nope')).status === 404)

    console.log('\n-- POC sign-in from the license form --')
    const pocLic = (over = {}) => newLicense({
      clientName: 'Form Poc', clientUserId: 'form.poc@test.com', companyName: 'Form Co',
      password: 'FormPass123', duration: 'custom', startDate: '2020-01-01', expiryDate: '2099-01-01',
      ...over,
    })
    const formLogin = (password, username = 'form.poc@test.com') =>
      call('POST', '/api/clients/login', { username, password }, { auth: false, ip: '10.0.0.77' })

    const fromForm = await call('POST', '/api/licenses', pocLic())
    check('a license with a password is created', fromForm.status === 201, fromForm.body)
    const formSignIn = await formLogin('FormPass123')
    check('and the POC can sign in to the product with it',
      formSignIn.status === 200 &&
        formSignIn.body.licenses.some((l) => l.licenseKey === fromForm.body.license.licenseKey),
      formSignIn.body)
    const formRow = (await call('GET', '/api/clients')).body.clients
      .filter((c) => c.username === 'form.poc@test.com')
    check('one POC account holds the company and readable password',
      formRow.length === 1 && formRow[0].hasLogin && formRow[0].companyName === 'Form Co' &&
        formRow[0].password === 'FormPass123', formRow)

    const second = await call('POST', '/api/licenses', pocLic({ productName: 'Second Product' }))
    const formRows = (await call('GET', '/api/clients')).body.clients
      .filter((c) => c.username === 'form.poc@test.com')
    check('a second license for the same POC reuses the account',
      second.status === 201 && formRows.length === 1 && formRows[0].totalLicenses === 2, formRows)

    const repass = await call('PUT', `/api/licenses/${fromForm.body.license.id}`,
      pocLic({ password: 'NewFormPass1' }))
    check('editing the license changes the POC password', repass.status === 200 &&
      (await formLogin('NewFormPass1')).status === 200 &&
      (await formLogin('FormPass123')).status === 401)

    // The license form edits one license: the POC account's other licenses never change with it.
    const licenseById = async (id) => (await call('GET', `/api/licenses/${id}`)).body.license
    const accountRow = async (username) => (await call('GET', '/api/clients')).body.clients
      .find((c) => c.username === username)

    const third = await call('POST', '/api/licenses',
      pocLic({ clientName: 'Third Poc', productName: 'Third Product', password: 'NewFormPass1' }))
    const secondAfter = await licenseById(second.body.license.id)
    check("a new license under the same email doesn't rename the POC's other licenses",
      third.status === 201 && third.body.license.clientName === 'Third Poc' &&
        secondAfter.clientName === 'Form Poc' && secondAfter.companyName === 'Form Co' &&
        (await accountRow('form.poc@test.com')).clientName === 'Form Poc',
      { third: third.body, secondAfter })
    await call('DELETE', `/api/licenses/${third.body.license.id}`)

    // What renamed a Digital Diya license once: one license's POC and email edited while another
    // license was filed under the same account.
    const emailMoved = await call('PUT', `/api/licenses/${fromForm.body.license.id}`, pocLic({
      clientName: 'Moved Poc', companyName: 'Moved Co', clientUserId: 'form.poc.new@test.com', password: 'MovedPass123',
    }))
    const secondStays = await licenseById(second.body.license.id)
    check("editing one license's POC and email leaves the other license as it was",
      emailMoved.status === 200 && emailMoved.body.license.clientUserId === 'form.poc.new@test.com' &&
        emailMoved.body.license.clientName === 'Moved Poc' && secondStays.clientName === 'Form Poc' &&
        secondStays.companyName === 'Form Co' && secondStays.clientUserId === 'form.poc@test.com',
      { moved: emailMoved.body, secondStays })
    const oldAccount = await accountRow('form.poc@test.com')
    const newAccount = await accountRow('form.poc.new@test.com')
    check('… the new email gets its own account; the old one keeps the other license and its sign-in',
      oldAccount && oldAccount.totalLicenses === 1 && oldAccount.clientName === 'Form Poc' &&
        newAccount && newAccount.totalLicenses === 1 &&
        (await formLogin('NewFormPass1')).status === 200 &&
        (await formLogin('MovedPass123', 'form.poc.new@test.com')).status === 200,
      { oldAccount, newAccount })

    // A license alone on its account is that POC being edited: the account moves to the new email.
    const loneMoved = await call('PUT', `/api/licenses/${fromForm.body.license.id}`, pocLic({
      clientName: 'Moved Poc', companyName: 'Moved Co', clientUserId: 'form.poc.newer@test.com', password: 'MovedPass123',
    }))
    check("a license alone on its account moves the account to the new email (no second account)",
      loneMoved.status === 200 && !(await accountRow('form.poc.new@test.com')) &&
        (await accountRow('form.poc.newer@test.com'))?.totalLicenses === 1 &&
        (await formLogin('MovedPass123', 'form.poc.newer@test.com')).status === 200)

    check('a short password is refused',
      (await call('POST', '/api/licenses', pocLic({ password: 'short' }))).status === 400)
    check('a password with a non-email is refused',
      (await call('POST', '/api/licenses', pocLic({ clientUserId: 'not-an-email' }))).status === 400)
    check('a password without a company is refused',
      (await call('POST', '/api/licenses', pocLic({ companyName: '' }))).status === 400)
    const clash = await call('POST', '/api/licenses',
      pocLic({ clientName: 'Other Poc', clientUserId: 'other@test.com', companyName: 'Form Co' }))
    check("another POC cannot take this POC's company", clash.status === 409, clash.body)

    await call('DELETE', `/api/licenses/${fromForm.body.license.id}`)
    await call('DELETE', `/api/licenses/${second.body.license.id}`)
    for (const username of ['form.poc@test.com', 'form.poc.newer@test.com']) {
      await call('DELETE', `/api/clients/${(await accountRow(username)).id}`)
    }

    console.log('\n-- update + delete --')
    const upd = await call('PUT', `/api/licenses/${lic.id}`, { soldBy: 'Dana Seller', duration: '1_month' })
    check('updates fields', upd.body.license.soldBy === 'Dana Seller', upd.body)
    // The client account was renamed to 'Jonathan Doe' earlier, and that edit
    // is carried through to their licenses so the two pages agree.
    check('renaming a client reaches their licenses',
      upd.body.license.clientName === 'Jonathan Doe', upd.body.license.clientName)
    check('key unchanged after update', upd.body.license.licenseKey === lic.licenseKey)
    check('changing duration recomputes the expiry',
      upd.body.license.expiryDate === '2020-02-01T23:59:59.999Z', upd.body.license.expiryDate)
    check('cannot delete a product that licenses still use',
      (await call('DELETE', `/api/products/${prod.body.product.id}`)).status === 409)
    check('deletes a license', (await call('DELETE', `/api/licenses/${lic.id}`)).status === 200)
    check('deleted key no longer verifies',
      (await call('POST', '/api/licenses/verify', { licenseKey: lic.licenseKey }, { auth: false })).status === 404)

    console.log('\n-- change password --')
    check('rejects a wrong current password',
      (await call('POST', '/api/admin/change-password', {
        currentPassword: 'nope', newPassword: 'BrandNewPass1', confirmPassword: 'BrandNewPass1',
      })).status === 400)
    check('rejects a mismatched confirmation',
      (await call('POST', '/api/admin/change-password', {
        currentPassword: ADMIN.password, newPassword: 'BrandNewPass1', confirmPassword: 'Different1',
      })).status === 400)
    check('rejects a too-short password',
      (await call('POST', '/api/admin/change-password', {
        currentPassword: ADMIN.password, newPassword: 'short', confirmPassword: 'short',
      })).status === 400)
    const changed = await call('POST', '/api/admin/change-password', {
      currentPassword: ADMIN.password, newPassword: 'BrandNewPass1', confirmPassword: 'BrandNewPass1',
    })
    check('changes the password', changed.status === 200, changed.body)
    check('the old password no longer works',
      (await call('POST', '/api/admin/login', ADMIN, { auth: false })).status === 401)
    check('the new password works',
      (await call('POST', '/api/admin/login', { email: ADMIN.email, password: 'BrandNewPass1' })).status === 200)

    console.log('\n-- email configuration --')
    const e1 = await call('POST', '/api/admin/emails', { email: 'first@test.com' })
    check('adds an email', e1.status === 201, e1.body)
    check('the first email becomes the default', e1.body.email.isDefault === true)
    const e2 = await call('POST', '/api/admin/emails', { email: 'second@test.com', label: 'Billing' })
    check('a later email is not default', e2.body.email.isDefault === false)
    check('rejects a duplicate email',
      (await call('POST', '/api/admin/emails', { email: 'FIRST@test.com' })).status === 409)
    check('rejects an invalid email',
      (await call('POST', '/api/admin/emails', { email: 'not-an-email' })).status === 400)
    check('refuses to delete the default while others exist',
      (await call('DELETE', `/api/admin/emails/${e1.body.email.id}`)).status === 400)

    // Several addresses may be default at once; marking one never unmarks another.
    await call('PUT', `/api/admin/emails/${e2.body.email.id}/default`)
    let emailList = await call('GET', '/api/admin/emails')
    let defaults = emailList.body.emails.filter((e) => e.isDefault)
    check('both emails can be default at once', defaults.length === 2, emailList.body.emails)

    check('a default can be deleted while another default remains',
      (await call('DELETE', `/api/admin/emails/${e1.body.email.id}`)).status === 200)

    // The edit form sets the flag too, and clearing the last one is refused.
    const e3 = await call('POST', '/api/admin/emails', { email: 'third@test.com' })
    check('a later email is not default', e3.body.email.isDefault === false)
    const marked = await call('PUT', `/api/admin/emails/${e3.body.email.id}`,
      { email: 'third@test.com', label: 'Ops', isDefault: true })
    check('editing an email can mark it default', marked.body.email.isDefault === true, marked.body)

    const unmarked = await call('PUT', `/api/admin/emails/${e3.body.email.id}/default`, { isDefault: false })
    check('a default mark can be cleared again', unmarked.body.email.isDefault === false, unmarked.body)

    emailList = await call('GET', '/api/admin/emails')
    defaults = emailList.body.emails.filter((e) => e.isDefault)
    check('only the remaining default is marked', defaults.length === 1 &&
      defaults[0].email === 'second@test.com', emailList.body.emails)
    check('refuses to delete the last default while others exist',
      (await call('DELETE', `/api/admin/emails/${defaults[0].id}`)).status === 400)
    check('a non-default email deletes freely',
      (await call('DELETE', `/api/admin/emails/${e3.body.email.id}`)).status === 200)

    console.log('\n-- branding --')
    const b0 = await call('GET', '/api/admin/branding', null, { auth: false })
    check('branding is readable without a token', b0.status === 200, b0.body)
    check('no logo configured initially', b0.body.branding.logo === null)
    check('uploading a logo requires a token',
      (await call('PUT', '/api/admin/branding', { logo: TINY_PNG }, { auth: false, token: 'bad.token' })).status === 401)
    check('rejects a non-image data url',
      (await call('PUT', '/api/admin/branding', { logo: 'data:text/html;base64,PHN2Zz4=' })).status === 400)
    check('rejects a malformed data url',
      (await call('PUT', '/api/admin/branding', { logo: 'just-a-string' })).status === 400)
    check('rejects an oversized image',
      (await call('PUT', '/api/admin/branding', { logo: `data:image/png;base64,${'A'.repeat(700001)}` })).status === 400)
    const bSet = await call('PUT', '/api/admin/branding', { logo: TINY_PNG, fileName: 'logo.png' })
    check('saves the logo', bSet.status === 200 && bSet.body.branding.logo === TINY_PNG, bSet.body)
    check('records the mime type', bSet.body.branding.mimeType === 'image/png')
    check('records the file name', bSet.body.branding.fileName === 'logo.png')
    const bRead = await call('GET', '/api/admin/branding', null, { auth: false })
    check('the saved logo is served publicly', bRead.body.branding.logo === TINY_PNG)
    check('removes the logo', (await call('DELETE', '/api/admin/branding')).body.branding.logo === null)

    console.log('\n-- share by email --')
    const shareable = m6.body.license
    check('mail status requires a token',
      (await call('GET', '/api/licenses/mail-status', null, { auth: false, token: 'bad.token' }))
        .status === 401)
    const mailStatus = await call('GET', '/api/licenses/mail-status')
    check('mail status reports whether SMTP is configured',
      mailStatus.status === 200 && typeof mailStatus.body.configured === 'boolean', mailStatus.body)
    check('sharing requires a token',
      (await call('POST', `/api/licenses/${shareable.id}/share`, { recipients: ['a@b.com'] },
        { auth: false, token: 'bad.token' })).status === 401)
    check('rejects an empty recipient list',
      (await call('POST', `/api/licenses/${shareable.id}/share`, { recipients: [] })).status === 400)
    check('rejects an invalid recipient',
      (await call('POST', `/api/licenses/${shareable.id}/share`, { recipients: ['not-an-email'] }))
        .status === 400)
    check('rejects more than ten recipients',
      (await call('POST', `/api/licenses/${shareable.id}/share`, {
        recipients: Array.from({ length: 11 }, (_, i) => `user${i}@test.com`),
      })).status === 400)
    // No SMTP in the test environment, so a valid request reports that clearly
    // rather than failing in some opaque way.
    const noSmtp = await call('POST', `/api/licenses/${shareable.id}/share`, {
      recipients: ['client@test.com'],
    })
    check('without SMTP configured it answers 503, not 500',
      noSmtp.status === 503 && noSmtp.body.code === 'MAIL_NOT_CONFIGURED', noSmtp.body)
    check('sharing an unknown license -> 404',
      (await call('POST', '/api/licenses/nope/share', { recipients: ['a@b.com'] })).status === 404)

    console.log('\n-- cors --')
    const foreign = await call('POST', '/api/licenses/verify',
      { licenseKey: 'OPEZ-2222-2222-2222' }, { auth: false, origin: 'https://my-product.example.com' })
    check('verify reachable from a foreign origin', foreign.status === 404)
    check('verify sends wildcard CORS header',
      foreign.headers.get('access-control-allow-origin') === '*')
    const foreignSync = await call('POST', '/api/licenses/sync',
      { licenseKey: 'OPEZ-2222-2222-2222' }, { auth: false, origin: 'https://my-product.example.com' })
    check('sync reachable from a foreign origin', foreignSync.status === 404)
    check('admin API rejects an unknown origin',
      (await call('GET', '/api/licenses', null, { origin: 'https://evil.example.com' })).status === 403)
    // The dashboard Express serves itself is same-origin even when that origin
    // is not in CORS_ORIGIN, so its sign-in must not be refused.
    check('admin API accepts the dashboard it serves itself',
      (await call('GET', '/api/licenses', null, { origin: base })).status === 200)

    console.log('\n-- rate limiting --')
    let limited = false
    for (let i = 0; i < 25; i++) {
      const r = await call('POST', '/api/licenses/verify', { licenseKey: 'OPEZ-1111-1111-1111' }, { auth: false })
      if (r.status === 429) { limited = true; break }
    }
    check('verify endpoint rate limits burst traffic', limited)

    console.log('\n-- error shape --')
    const nf = await call('GET', '/api/does-not-exist')
    check('unknown route -> 404 json', nf.status === 404 && nf.body.success === false)
    check('no stack traces in responses', !JSON.stringify(nf.body).includes('at '))
  } catch (e) {
    failed++
    console.error('  FAIL  threw:', e)
  }

  console.log(`\n${passed} passed, ${failed} failed\n`)
  server.close()
  await dropTestDb()
  process.exit(failed ? 1 : 0)
})
