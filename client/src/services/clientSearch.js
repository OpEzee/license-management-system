/*
 * Matching for the POC search box in the license form. Kept out of the
 * component so the rules can be tested without a browser.
 */

const norm = (s) => String(s || '').toLowerCase()

/**
 * How well a client matches, lower first: the admin is usually typing a name,
 * so name hits outrank company hits, and an email-only hit comes last. null
 * when nothing matches.
 */
function rankOf(c, q) {
  const name = norm(c.clientName)
  if (name.startsWith(q)) return 0
  if (name.includes(q)) return 1
  if (norm(c.companyName).includes(q)) return 2
  if (norm(c.username).includes(q)) return 3
  return null
}

const byText = (a, b) => norm(a).localeCompare(norm(b))

/**
 * Clients whose name, company or username (their email) contains `query`,
 * case-insensitively, best match first and alphabetical within a rank.
 * An empty query matches nothing: the list should only open once the admin
 * starts typing, not dump every client on focus.
 */
export function matchClients(clients, query, limit = 8) {
  const q = norm(query).trim()
  if (!q) return []
  const seen = new Set()
  const ranked = []
  for (const c of clients) {
    if (!c || !c.clientName) continue
    // The list can hold the same account twice; one row per client.
    const key = c.id || `${c.clientName}|${c.username || ''}`
    if (seen.has(key)) continue
    const rank = rankOf(c, q)
    if (rank === null) continue
    seen.add(key)
    ranked.push({ c, rank })
  }
  // Ranked before the cut, so a strong match late in the list still shows.
  ranked.sort(
    (a, b) =>
      a.rank - b.rank ||
      byText(a.c.clientName, b.c.clientName) ||
      byText(a.c.companyName, b.c.companyName) ||
      byText(a.c.username, b.c.username)
  )
  return ranked.slice(0, limit).map((r) => r.c)
}

/**
 * Splits `text` into [{ text, match }] parts around each case-insensitive
 * occurrence of `query`, so the caller can highlight the matched text.
 */
export function highlightParts(text, query) {
  const s = String(text || '')
  const q = norm(query).trim()
  if (!q || !s) return s ? [{ text: s, match: false }] : []
  const lower = s.toLowerCase()
  const parts = []
  let from = 0
  let at = lower.indexOf(q)
  while (at !== -1) {
    if (at > from) parts.push({ text: s.slice(from, at), match: false })
    parts.push({ text: s.slice(at, at + q.length), match: true })
    from = at + q.length
    at = lower.indexOf(q, from)
  }
  if (from < s.length) parts.push({ text: s.slice(from), match: false })
  return parts
}
