/*
 * Matching for the POC search box in the license form. Kept out of the
 * component so the rules can be tested without a browser.
 */

const norm = (s) => String(s || '').toLowerCase()

/**
 * Clients whose name, username or company contains `query`, case-insensitively.
 * An empty query matches nothing: the list should only open once the admin
 * starts typing, not dump every client on focus.
 */
export function matchClients(clients, query, limit = 8) {
  const q = norm(query).trim()
  if (!q) return []
  const seen = new Set()
  const out = []
  for (const c of clients) {
    if (!c || !c.clientName) continue
    // The list can hold the same account twice; one row per client.
    const key = c.id || `${c.clientName}|${c.username || ''}`
    if (seen.has(key)) continue
    if (![c.clientName, c.username, c.companyName].some((f) => norm(f).includes(q))) continue
    seen.add(key)
    out.push(c)
    if (out.length >= limit) break
  }
  return out
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
