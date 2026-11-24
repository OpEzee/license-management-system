/**
 * The contract between the /client pages and the product that shows them.
 *
 * A product (Match Match, say) opens these pages inside a frame instead of
 * drawing its own sign-in and key screens. It tells the page who it is through
 * the URL, and the page tells it what happened through postMessage:
 *
 *   /client/login     ?product=&theme=
 *   /client/activate  ?product=&email=&poc=&company=&error=&theme=
 *   /client/status    ?product=&key=&email=&poc=&company=&status=&signout=&theme=
 *                     (signout=0 hides Sign out, for a product with no sign-in of its own)
 *   /client/details   ?product=&key=&email=&poc=&company=&theme=
 *   /client/pin       ?product=&key=&theme=
 *                     (the staff PIN, CLIENT_PIN on the server; right → /client/details)
 *
 *   Every page also takes &machine=, the product's machine number. Activate,
 *   status and details send it to /verify or /sync, where it counts against
 *   the license's max screens. Once a key has claimed machines, a page opened
 *   without it is refused (403 MACHINE_NUMBER_REQUIRED), so products must pass it.
 *
 * Every message is { source: 'opezee-licence', type, ...payload }:
 *
 *   ready        the page has loaded (the product's cue that the server is up)
 *   login        { username, client }       signed in; never the password
 *   activated    { licenseKey, valid, status, license }
 *   reactivate   the operator wants to enter a key again
 *   signOut      the operator signed out
 *   close        the details page was closed
 *
 * The product must still treat a message as a request, not a verdict: Match
 * Match re-verifies an `activated` key from its own process before it opens.
 *
 * Opened on its own in a browser, with no product around it, the pages move
 * between each other instead, so the flow can be tried end to end.
 */

export const MESSAGE_SOURCE = 'opezee-licence'

const CARRIED = ['product', 'key', 'email', 'poc', 'company', 'status', 'signout', 'theme', 'machine']

/** The server's own rules, mirrored so a bad value is caught before a request. */
// A key in either format, after normalizeKey (below).
export const KEY_PATTERN = /^(?:[A-Z0-9]{6}|[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3})$/
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function readParams(search = window.location.search) {
  const q = new URLSearchParams(search)
  const get = (name) => (q.get(name) || '').trim()
  return {
    product: get('product'),
    key: get('key').toUpperCase(),
    email: get('email'),
    poc: get('poc'),
    company: get('company'),
    // What the product last heard, so the notice opens on the right face
    // before the page's own sync answers.
    status: get('status').toLowerCase(),
    signout: get('signout'),
    theme: get('theme'),
    error: get('error'),
    machine: get('machine'),
  }
}

/** True when a product is showing this page in a frame. */
export function isEmbedded() {
  try {
    return window.parent !== window
  } catch {
    return true
  }
}

/**
 * Tells the product what happened. The target is '*' because an installed
 * Electron app loads from file://, whose origin cannot be named; nothing
 * secret is ever sent — no password, only what the operator just typed or
 * what the server answered.
 */
export function notifyProduct(type, payload = {}) {
  if (!isEmbedded()) return false
  try {
    window.parent.postMessage({ source: MESSAGE_SOURCE, type, ...payload }, '*')
    return true
  } catch {
    return false
  }
}

/** A link to another /client page that keeps the product's parameters. */
export function linkTo(path, params, overrides = {}) {
  const q = new URLSearchParams()
  const merged = { ...params, ...overrides }
  for (const name of CARRIED) if (merged[name]) q.set(name, merged[name])
  const query = q.toString()
  return query ? `${path}?${query}` : path
}

// Keys are six characters ("K7M2Q9"). Keys issued before that format are
// sixteen, printed in groups of four ("OPEZ-8F4K-92LM-X7PQ"), and still work.
const KEY_LENGTH = 6
const LEGACY_KEY_LENGTH = 16

/**
 * Tidies the key while it is typed: uppercase, nothing but letters and digits.
 * Six characters or fewer is a current key and is left as typed. Anything
 * longer can only be a legacy key, so it is grouped as the server prints it,
 * with a dash appearing as each group of four fills — but only when typing
 * forward, so a backspace over it is not undone.
 */
export function formatKeyInput(raw, previous = '') {
  const clean = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, LEGACY_KEY_LENGTH)
  if (clean.length <= KEY_LENGTH) return clean
  const grouped = clean.match(/.{1,4}/g).join('-')
  const typingForward = String(raw || '').length > String(previous || '').length
  const groupJustFilled = clean.length < LEGACY_KEY_LENGTH && clean.length % 4 === 0
  return typingForward && groupJustFilled ? `${grouped}-` : grouped
}

/** The key as the server stores it: "K7M2Q9", or "OPEZ-8F4K-92LM-X7PQ". */
export function normalizeKey(raw) {
  const clean = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return clean.length === LEGACY_KEY_LENGTH ? clean.match(/.{1,4}/g).join('-') : clean
}

/** Statuses as the server spells them on /verify and /sync, and as shown. */
export const STATUS_LABELS = {
  active: 'Active',
  valid: 'Active',
  expired: 'Expired',
  pending: 'Pending',
  deactivated: 'Deactivated',
  deactive: 'Deactivated',
  invalid: 'Invalid',
}

export function statusLabel(status) {
  return STATUS_LABELS[status] || (status ? status[0].toUpperCase() + status.slice(1) : '-')
}
