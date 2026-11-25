/*
 * The Dashboard's numbers, worked out from the license list in the browser.
 *
 * Pure functions only: every one takes the licenses (and, where time matters,
 * `now`) and returns plain data, so they can be tested without React, the API
 * or the clock. Status is read as the server derived it, never recomputed.
 */
import { isDigitalDiya } from '../hooks/useLicenses'

export const DAY_MS = 24 * 60 * 60 * 1000
export const EXPIRING_WINDOW_DAYS = 60

const STATUSES = ['active', 'deactivated', 'pending', 'expired']

const time = (value) => {
  const t = new Date(value).getTime()
  return Number.isNaN(t) ? null : t
}

/** Whole-number share, 0 when there is nothing to share out. */
export function percent(part, total) {
  return total ? Math.round((part / total) * 100) : 0
}

/** Counts and shares per status, in the order the status bar draws them. */
export function statusBreakdown(licenses) {
  const total = licenses.length
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]))
  licenses.forEach((l) => {
    if (l.status in counts) counts[l.status] += 1
  })
  return {
    total,
    counts,
    segments: STATUSES.map((status) => ({
      status,
      count: counts[status],
      percent: total ? (counts[status] / total) * 100 : 0,
    })),
    activePercent: percent(counts.active, total),
  }
}

/**
 * Distinct clients with at least one active license, keyed the way the
 * server's stats count clients (the user ID, ignoring case), so this can never
 * exceed the Total clients figure it sits under.
 */
export function clientsWithActiveLicenses(licenses) {
  const keys = new Set()
  licenses.forEach((l) => {
    if (l.status === 'active') keys.add(String(l.clientUserId || '').trim().toLowerCase())
  })
  return keys.size
}

/** Days left, rounded up: a license expiring later today has 1 day left. */
export function daysLeft(expiryDate, now = new Date()) {
  const t = time(expiryDate)
  return t === null ? null : Math.ceil((t - now.getTime()) / DAY_MS)
}

/**
 * Active licenses whose expiry falls within the next `days` days:
 * now < expiry <= now + days. Soonest first.
 */
export function expiringSoon(licenses, now = new Date(), days = EXPIRING_WINDOW_DAYS) {
  const start = now.getTime()
  const end = start + days * DAY_MS
  return licenses
    .filter((l) => {
      if (l.status !== 'active') return false
      const t = time(l.expiryDate)
      return t !== null && t > start && t <= end
    })
    .map((l) => ({ ...l, daysLeft: daysLeft(l.expiryDate, now) }))
    .sort((a, b) => time(a.expiryDate) - time(b.expiryDate))
}

/**
 * Licenses per product, highest count first (then by name). Names are grouped
 * trimmed and case-insensitively, as license verification compares them; the
 * first spelling seen is the one shown.
 */
export function productBreakdown(licenses) {
  const groups = new Map()
  licenses.forEach((l) => {
    const name = String(l.productName || '').trim()
    const key = name.toLowerCase()
    if (!groups.has(key)) groups.set(key, { name: name || 'No product', count: 0 })
    groups.get(key).count += 1
  })
  const rows = [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  const max = rows.length ? rows[0].count : 0
  return rows.map((r) => ({ ...r, percentOfMax: max ? (r.count / max) * 100 : 0 }))
}

const machinesOf = (l) => (Array.isArray(l.claimedMachines) ? l.claimedMachines.length : 0)
const slotsOf = (l) => (Number.isInteger(l.maxScreens) ? l.maxScreens : 1)

/**
 * Machines in use out of the slots available. Digital Diya is left out of
 * both sums: it counts its own screens and never claims slots here.
 */
export function machineUsage(licenses) {
  const counted = licenses.filter((l) => !isDigitalDiya(l))
  return {
    used: counted.reduce((sum, l) => sum + machinesOf(l), 0),
    slots: counted.reduce((sum, l) => sum + slotsOf(l), 0),
    licenses: counted.length,
  }
}

/**
 * The licenses closest to their machine limit: highest used/max first, then
 * most machines in use, then client name. Licenses with no machine yet are
 * left out, as is Digital Diya.
 */
export function closestToLimit(licenses, limit = 4) {
  return licenses
    .filter((l) => !isDigitalDiya(l) && machinesOf(l) > 0)
    .map((l) => {
      const used = machinesOf(l)
      const max = slotsOf(l)
      const ratio = used / max
      return {
        id: l.id,
        clientName: l.clientName,
        productName: l.productName,
        used,
        max,
        ratio,
        level: ratio >= 1 ? 'full' : ratio >= 0.5 ? 'high' : 'low',
      }
    })
    .sort(
      (a, b) =>
        b.ratio - a.ratio || b.used - a.used || String(a.clientName).localeCompare(String(b.clientName))
    )
    .slice(0, limit)
}

/** The newest licenses by createdAt. Licenses without a date sort last. */
export function recentlyIssued(licenses, limit = 5) {
  return [...licenses]
    .sort((a, b) => (time(b.createdAt) ?? -Infinity) - (time(a.createdAt) ?? -Infinity))
    .slice(0, limit)
}

/** "Updated just now", "Updated 1 min ago", "Updated 5 min ago", "Updated 2 h ago". */
export function updatedLabel(loadedAt, now = new Date()) {
  if (!loadedAt) return ''
  const minutes = Math.floor((now.getTime() - loadedAt.getTime()) / 60000)
  if (minutes < 1) return 'Updated just now'
  if (minutes < 60) return `Updated ${minutes} min ago`
  return `Updated ${Math.floor(minutes / 60)} h ago`
}
