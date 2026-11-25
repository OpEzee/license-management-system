import { formatDate } from '../services/format'

// The old one-machine lock never recorded when a machine first checked in, so
// licenses migrated from it carry no first-seen date.
const seen = (value) => (value ? formatDate(value) : 'Not recorded')

/*
 * The machines using a license, out of its max screens, in the License
 * Details popup. Releasing one is the parent's job: it confirms first and
 * then calls the API, so this list stays a plain view.
 */
export default function ClaimedMachines({ machines = [], maxScreens, onRelease, releasing }) {
  const full = machines.length >= maxScreens

  return (
    <div className="mb-5 rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-800">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
        Machines:{' '}
        <span className={full ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}>
          {machines.length} of {maxScreens}
        </span>{' '}
        in use
      </p>

      {machines.length ? (
        <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
          {machines.map((m) => (
            <li
              key={m.machineNumber}
              className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-sm text-slate-900 dark:text-white">{m.machineNumber}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  First seen {seen(m.firstSeenAt)} · Last seen {seen(m.lastSeenAt)}
                </p>
              </div>
              <button
                type="button"
                className="btn-danger-outline shrink-0 px-3 py-1.5 text-xs"
                disabled={releasing}
                onClick={() => onRelease(m)}
              >
                Release
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          No machine has used this key yet. The first {maxScreens === 1 ? 'one' : maxScreens} to verify it
          will claim {maxScreens === 1 ? 'the slot' : 'the slots'}.
        </p>
      )}
    </div>
  )
}
