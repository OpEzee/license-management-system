import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import StatCard, { STAT_ICONS } from '../components/StatCard'
import { EmptyState, ErrorState, TableSkeleton } from '../components/States'
import useLicenses, { useStats } from '../hooks/useLicenses'
import { formatDate, formatShortDate } from '../services/format'
import {
  EXPIRING_WINDOW_DAYS,
  clientsWithActiveLicenses,
  closestToLimit,
  expiringSoon,
  machineUsage,
  productBreakdown,
  recentlyIssued,
  statusBreakdown,
  updatedLabel,
} from '../services/dashboardStats'

// min(Npx, 100%) keeps a column from ever being wider than a phone screen,
// which a bare minmax(420px, 1fr) would be, forcing a sideways scroll.
const GRID_STATS = 'grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(190px,100%),1fr))]'
const GRID_THREE = 'grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))]'
const GRID_TWO = 'grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))]'

const MUTED = 'text-slate-500 dark:text-slate-400'

const STATUS_STYLE = {
  active: { label: 'Active', bar: 'bg-emerald-500 dark:bg-emerald-400' },
  deactivated: { label: 'Deactivated', bar: 'bg-slate-400 dark:bg-slate-500' },
  pending: { label: 'Pending', bar: 'bg-amber-400 dark:bg-amber-400' },
  expired: { label: 'Expired', bar: 'bg-red-500 dark:bg-red-400' },
}

const LEVEL_STYLE = {
  full: 'font-semibold text-red-600 dark:text-red-400',
  high: 'font-semibold text-amber-600 dark:text-amber-400',
  low: MUTED,
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function NewLicenseButton() {
  return (
    <Link to="/licenses?new=1" className="btn-primary">
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
      </svg>
      New license
    </Link>
  )
}

/** A titled dashboard panel, with an optional "View all" link to the full list. */
function Panel({ title, viewAll, children, footer }) {
  return (
    <section className="card flex min-w-0 flex-col p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h2>
        {viewAll && (
          <Link
            to={viewAll}
            className="shrink-0 text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            View all
          </Link>
        )}
      </div>
      <div className="flex-1">{children}</div>
      {footer && <p className={`mt-4 text-xs ${MUTED}`}>{footer}</p>}
    </section>
  )
}

function StatusPanel({ breakdown }) {
  const { segments, total } = breakdown
  return (
    <Panel title="Licenses by status">
      <div
        role="group"
        aria-label={`Licenses by status, ${plural(total, 'license')} in all`}
        className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
      >
        {segments
          .filter((s) => s.count > 0)
          .map((s) => (
            <div
              key={s.status}
              role="img"
              aria-label={`${STATUS_STYLE[s.status].label} ${s.count} of ${total}`}
              title={`${STATUS_STYLE[s.status].label}: ${s.count} of ${total}`}
              className={STATUS_STYLE[s.status].bar}
              style={{ width: `${s.percent}%` }}
            />
          ))}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        {segments.map((s) => (
          <div key={s.status} className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_STYLE[s.status].bar}`} aria-hidden="true" />
            <dt className={`text-sm ${MUTED}`}>{STATUS_STYLE[s.status].label}</dt>
            <dd className="ml-auto text-sm font-semibold text-slate-900 dark:text-white">{s.count}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}

function ProductPanel({ rows, total }) {
  return (
    <Panel title="Licenses by product">
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.name}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-slate-700 dark:text-slate-200">{r.name}</span>
              <span className="shrink-0 font-semibold text-slate-900 dark:text-white">{r.count}</span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                role="img"
                aria-label={`${r.name} ${r.count} of ${total}`}
                className="h-full rounded-full bg-brand-500"
                style={{ width: `${r.percentOfMax}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function MachineSlotsPanel({ rows }) {
  return (
    <Panel title="Machine slots" footer="Licenses closest to their limit. Digital Diya excluded.">
      {rows.length ? (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{r.clientName}</p>
                <p className={`truncate text-xs ${MUTED}`}>{r.productName}</p>
              </div>
              <span
                className={`shrink-0 text-sm ${LEVEL_STYLE[r.level]}`}
                aria-label={`${r.used} of ${r.max} machines in use${r.level === 'full' ? ', full' : ''}`}
              >
                {r.used}/{r.max}
                {r.level === 'full' && ' full'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={`text-sm ${MUTED}`}>No machines have checked in yet.</p>
      )}
    </Panel>
  )
}

function ExpiringPanel({ rows }) {
  return (
    <Panel title="Expiring soon" viewAll="/licenses">
      {rows.length ? (
        // The one block allowed to scroll sideways on a phone.
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="table-head">Client</th>
                <th className="table-head">Product</th>
                <th className="table-head">Expires</th>
                <th className="table-head text-right">Left</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap px-2 py-2.5 font-medium text-slate-900 dark:text-white">
                    {l.clientName}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-slate-600 dark:text-slate-300">{l.productName}</td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-slate-600 dark:text-slate-300">
                    {formatDate(l.expiryDate)}
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <span
                      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        l.daysLeft < 14
                          ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'
                          : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'
                      }`}
                    >
                      {plural(l.daysLeft, 'day')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={`text-sm ${MUTED}`}>No active license expires in the next {EXPIRING_WINDOW_DAYS} days.</p>
      )}
    </Panel>
  )
}

function RecentPanel({ rows }) {
  return (
    <Panel title="Recently issued" viewAll="/licenses">
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{l.clientName}</p>
              <p className={`truncate font-mono text-xs ${MUTED}`}>{l.licenseKey}</p>
            </div>
            <div className="min-w-0 shrink-0 text-right">
              <p className="max-w-[10rem] truncate text-sm text-slate-700 dark:text-slate-200">{l.productName}</p>
              <p className={`text-xs ${MUTED}`}>{formatShortDate(l.createdAt)}</p>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function PanelSkeleton({ title }) {
  return (
    <Panel title={title}>
      <TableSkeleton rows={4} cols={2} />
    </Panel>
  )
}

/**
 * Insights worked out from the license list in the browser (see
 * services/dashboardStats.js). Total clients comes from the stats endpoint,
 * so the full client list is not loaded just to count it.
 */
export default function Dashboard() {
  const { licenses, loading: licensesLoading, error: licensesError, reload: reloadLicenses } = useLicenses()
  const { stats, loading: statsLoading, error: statsError, reload: reloadStats } = useStats()

  const loading = licensesLoading || statsLoading
  const error = licensesError || statsError

  // When the data last arrived, and a clock that moves the "Updated" label on
  // once a minute. The timer only re-renders; it never fetches again.
  const [loadedAt, setLoadedAt] = useState(null)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!loading && !error) {
      const at = new Date()
      setLoadedAt(at)
      setNow(at)
    }
  }, [loading, error])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000)
    return () => window.clearInterval(timer)
  }, [])

  const status = useMemo(() => statusBreakdown(licenses), [licenses])
  const activeClients = useMemo(() => clientsWithActiveLicenses(licenses), [licenses])
  const expiring = useMemo(() => expiringSoon(licenses, now), [licenses, now])
  const products = useMemo(() => productBreakdown(licenses), [licenses])
  const machines = useMemo(() => machineUsage(licenses), [licenses])
  const nearLimit = useMemo(() => closestToLimit(licenses, 4), [licenses])
  const recent = useMemo(() => recentlyIssued(licenses, 5), [licenses])

  const retry = () => Promise.all([reloadLicenses(), reloadStats()])
  const isEmpty = !loading && !error && licenses.length === 0

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            {/* Until the load time is recorded (one render after the data
                lands), the data is by definition fresh. */}
            {loading ? 'Loading…' : error ? 'Could not load' : updatedLabel(loadedAt || now, now)}
          </p>
        </div>
        {!isEmpty && <NewLicenseButton />}
      </div>

      {error ? (
        <div className="card overflow-hidden">
          <ErrorState message={error} onRetry={retry} />
        </div>
      ) : isEmpty ? (
        <div className="card overflow-hidden">
          <EmptyState
            title="No licenses yet"
            description="Issue your first license and this page fills in with your clients, products and machines."
            action={<NewLicenseButton />}
          />
        </div>
      ) : (
        <>
          <div className={GRID_STATS}>
            <StatCard
              label="Total clients"
              value={stats.totalClients}
              tone="brand"
              icon={STAT_ICONS.clients}
              loading={loading}
              hint={`${activeClients} with active licenses`}
            />
            <StatCard
              label="Active licenses"
              value={status.counts.active}
              tone="emerald"
              valueTone="emerald"
              icon={STAT_ICONS.active}
              loading={loading}
              hint={`${status.activePercent}% of all licenses`}
            />
            <StatCard
              label={`Expiring in ${EXPIRING_WINDOW_DAYS} days`}
              value={expiring.length}
              tone="amber"
              valueTone="amber"
              icon={STAT_ICONS.expiring}
              loading={loading}
              hint={expiring.length ? `Next: ${formatDate(expiring[0].expiryDate)}` : 'None'}
            />
            <StatCard
              label="Deactivated"
              value={status.counts.deactivated}
              tone="slate"
              icon={STAT_ICONS.deactivated}
              loading={loading}
              hint={`${status.counts.expired} expired`}
            />
            <StatCard
              label="Machines in use"
              value={
                <>
                  {machines.used}
                  <span className={`text-base font-medium ${MUTED}`}> / {plural(machines.slots, 'slot')}</span>
                </>
              }
              tone="slate"
              icon={STAT_ICONS.machines}
              loading={loading}
              hint={`Across ${plural(machines.licenses, 'license')}`}
            />
          </div>

          {loading ? (
            <>
              <div className={GRID_THREE}>
                <PanelSkeleton title="Licenses by status" />
                <PanelSkeleton title="Licenses by product" />
                <PanelSkeleton title="Machine slots" />
              </div>
              <div className={GRID_TWO}>
                <PanelSkeleton title="Expiring soon" />
                <PanelSkeleton title="Recently issued" />
              </div>
            </>
          ) : (
            <>
              <div className={GRID_THREE}>
                <StatusPanel breakdown={status} />
                <ProductPanel rows={products} total={status.total} />
                <MachineSlotsPanel rows={nearLimit} />
              </div>
              <div className={GRID_TWO}>
                <ExpiringPanel rows={expiring.slice(0, 5)} />
                <RecentPanel rows={recent} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
