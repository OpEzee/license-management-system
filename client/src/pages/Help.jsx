import { useEffect, useRef, useState } from 'react'

import HelpFlowDiagram from '../components/HelpFlowDiagram'
import StatusBadge from '../components/StatusBadge'

const SECTIONS = [
  { id: 'how-it-works', label: 'How it works' },
  { id: 'parts', label: 'The parts' },
  { id: 'lifecycle', label: "A license's life" },
  { id: 'issuing', label: 'Issuing a license' },
  { id: 'managing', label: 'Managing licenses' },
  { id: 'machine-lock', label: 'One machine per license' },
  { id: 'products', label: 'Products & clients' },
  { id: 'settings', label: 'Settings' },
  { id: 'integration', label: 'For developers' },
  { id: 'troubleshooting', label: 'Troubleshooting' },
]

const BODY = 'text-sm leading-relaxed text-slate-600 dark:text-slate-300'
const CODE =
  'rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.8em] text-slate-800 dark:bg-slate-800 dark:text-slate-200'
const CELL = 'border-t border-slate-200 px-2 py-2.5 align-top dark:border-slate-800'

function Code({ children }) {
  return <code className={CODE}>{children}</code>
}

/**
 * One help topic. The scroll margin clears the sticky tab bar (and, below lg,
 * the sticky mobile header above it) so a jumped-to heading is never hidden.
 */
function Section({ id, title, children }) {
  return (
    <section id={id} className="card scroll-mt-36 p-5 sm:p-6 lg:scroll-mt-24">
      <h2 className="mb-3 text-lg font-semibold text-brand-600 dark:text-brand-400">{title}</h2>
      <div className={`space-y-3 ${BODY}`}>{children}</div>
    </section>
  )
}

function Steps({ items }) {
  return (
    <ol className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
            {i + 1}
          </span>
          <span className="pt-0.5">{item}</span>
        </li>
      ))}
    </ol>
  )
}

function Table({ head, rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} className="table-head">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i}>
              {cells.map((cell, j) => (
                <td key={j} className={`${CELL} ${j === 0 ? 'whitespace-nowrap pr-6' : ''}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const ARROW = 'select-none text-slate-400 dark:text-slate-500'

/** Section links that stay on screen and follow whichever section is in view. */
function TabBar({ active, onSelect }) {
  const barRef = useRef(null)

  // Keep the highlighted tab visible when the bar is scrolled sideways on a
  // phone. Only the bar moves; scrollIntoView would also tug the page.
  useEffect(() => {
    const bar = barRef.current
    const tab = bar?.querySelector(`[data-tab="${active}"]`)
    if (!bar || !tab) return
    const left = tab.offsetLeft - bar.offsetLeft
    if (left < bar.scrollLeft || left + tab.offsetWidth > bar.scrollLeft + bar.clientWidth) {
      bar.scrollTo({ left: left - 16, behavior: 'smooth' })
    }
  }, [active])

  return (
    <nav aria-label="Help sections" className="card sticky top-16 z-20 lg:top-4">
      <div ref={barRef} className="flex gap-1 overflow-x-auto px-2">
        {SECTIONS.map((s) => {
          const isActive = s.id === active
          return (
            <a
              key={s.id}
              href={`#${s.id}`}
              data-tab={s.id}
              aria-current={isActive ? 'true' : undefined}
              onClick={(e) => {
                e.preventDefault()
                onSelect(s.id)
              }}
              className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition ${
                isActive
                  ? 'border-brand-500 text-brand-500'
                  : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {s.label}
            </a>
          )
        })}
      </div>
    </nav>
  )
}

export default function Help() {
  const [active, setActive] = useState(SECTIONS[0].id)
  // While a click-triggered smooth scroll is running, sections fly past the
  // observer; ignoring it until the scroll settles stops the tab flickering.
  const scrollingTo = useRef(null)
  const settleTimer = useRef(null)

  useEffect(() => () => window.clearTimeout(settleTimer.current), [])

  useEffect(() => {
    const visible = new Set()
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => (e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id)))
        if (scrollingTo.current) return
        // The topmost section within the reading band wins.
        const first = SECTIONS.find((s) => visible.has(s.id))
        if (first) setActive(first.id)
      },
      // A band just below the sticky bar, down to 40% of the viewport.
      { rootMargin: '-140px 0px -60% 0px' },
    )
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [])

  const select = (id) => {
    const el = document.getElementById(id)
    if (!el) return
    setActive(id)
    scrollingTo.current = id
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    window.clearTimeout(settleTimer.current)
    settleTimer.current = window.setTimeout(() => {
      scrollingTo.current = null
    }, 800)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
        <h1 className="page-title">Help</h1>
        <p className="page-subtitle sm:mt-0">
          Everything you need to issue and manage licenses, in about 5 minutes.
        </p>
      </div>

      <TabBar active={active} onSelect={select} />

      <Section id="how-it-works" title="How it works">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
          <HelpFlowDiagram />
        </div>
        <Steps
          items={[
            <>
              An admin creates a license here. The server generates a key like{' '}
              <Code>OPEZ-7K3M-QX9P-2HTD</Code> and calculates the expiry date.
            </>,
            'The admin emails the key to the client from the license popup.',
            'The client enters the key in the Opezee product on their machine. The product asks the server whether the key is valid.',
            'The first machine to use the key claims it. From then on, only that machine is accepted.',
            'Every hour the product checks again. When a license expires or is switched off, the product locks on its next check.',
          ]}
        />
      </Section>

      <Section id="parts" title="The parts">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['Admin dashboard', 'This site, for Opezee staff.'],
            ['Server + database', 'One for all products, on Firebase Firestore.'],
            ['Opezee product', "The kiosk, game or app running on the client's machine."],
            ['Client account', 'The email and password the client signs in to the product with.'],
          ].map(([name, text]) => (
            <div
              key={name}
              className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40"
            >
              <p className="font-semibold text-slate-900 dark:text-white">{name}</p>
              <p className="mt-1">{text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="lifecycle" title="A license's life">
        {/* Deactivated hangs off Active: it is the only state an admin sets by
            hand, and it can be switched back. */}
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2 py-2">
          <StatusBadge status="pending" />
          <span className={`pt-0.5 ${ARROW}`} aria-hidden="true">→</span>
          <div className="flex flex-col items-center gap-1">
            <StatusBadge status="active" />
            <span className={ARROW} aria-label="can switch both ways">⇅</span>
            <StatusBadge status="deactivated" />
          </div>
          <span className={`pt-0.5 ${ARROW}`} aria-hidden="true">→</span>
          <StatusBadge status="expired" />
        </div>
        <ul className="space-y-2">
          {[
            ['pending', 'The start date is in the future.'],
            ['active', 'Started and not yet expired.'],
            ['expired', 'The expiry date has passed.'],
            ['deactivated', 'Switched off by an admin. This overrides the dates, and the dates are kept.'],
          ].map(([status, text]) => (
            <li key={status} className="flex flex-wrap items-center gap-2">
              <span className="w-24 shrink-0">
                <StatusBadge status={status} />
              </span>
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="issuing" title="Issuing a license">
        <Steps
          items={[
            <>
              Open <strong>Licenses</strong>, then click <strong>Create License</strong>.
            </>,
            'Pick the client (POC) from the list, or type a new name. Picking an existing one fills in their email, company and password.',
            'Choose the product.',
            'Enter or check the email, company and password the client will sign in with.',
            <>
              Enter <strong>Sold By</strong>.
            </>,
            'Choose a start date.',
            <>
              Choose a duration. <strong>1 Month</strong>, <strong>3 Months</strong>, <strong>6 Months</strong>{' '}
              or <strong>1 Year</strong> fills in the expiry date for you. <strong>Custom Date</strong> lets you
              set it yourself, and it must be after the start date.
            </>,
            'Save.',
          ]}
        />
        <p className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
          The license key is generated automatically and can never be edited.
        </p>
      </Section>

      <Section id="managing" title="Managing licenses">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Edit</strong> (the pencil in each row) opens the license popup, where every detail can be changed
            except the key.
          </li>
          <li>
            <strong>Status:</strong> in the popup, switch an active license to Deactive, or back again. Pending and
            expired licenses follow their dates, so they can&apos;t be switched.
          </li>
          <li>
            <strong>Delete</strong> asks for confirmation first, and can&apos;t be undone.
          </li>
          <li>
            <strong>Share</strong> (in the popup) emails the license to between 1 and 10 recipients, chosen from the
            email IDs in Settings. The server sends it, so email must be set up on the server first; until then,
            Share shows an error instead.
          </li>
        </ul>
      </Section>

      <Section id="machine-lock" title="One machine per license">
        <p>
          A license works on one machine only. The first machine that checks the key claims it, and the server
          remembers that machine&apos;s number. After that, the same key used on any other machine is refused, even
          though the key itself is correct.
        </p>
        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40 sm:flex-row sm:items-center">
          <span className="self-start rounded-lg border border-brand-500 bg-white px-3 py-2 font-mono text-xs font-semibold text-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:self-center">
            OPEZ-7K3M-QX9P-2HTD
          </span>
          <div className="space-y-2">
            <p className="flex flex-wrap items-center gap-2">
              <span className={ARROW} aria-hidden="true">→</span>
              <span className="font-medium text-slate-900 dark:text-white">Machine A</span>
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                claimed ✓
              </span>
            </p>
            <p className="flex flex-wrap items-center gap-2">
              <span className={ARROW} aria-hidden="true">→</span>
              <span className="font-medium text-slate-900 dark:text-white">Machine B</span>
              <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-400">
                refused ✗ machine mismatch
              </span>
            </p>
          </div>
        </div>
        <p>Once a key is claimed, a request with no machine number at all is refused too.</p>
      </Section>

      <Section id="products" title="Products & clients">
        <p>
          <strong>Products</strong> have a name and an optional description. A license must name the product the
          same way the product app reports it. Capital letters and spaces at either end don&apos;t matter, but the
          spelling does.
        </p>
        <p>
          <strong>Clients</strong> are set up on the license form: the POC&apos;s name, their email, their company
          and a password of at least 8 characters. The client signs in to the product with that email and password.
        </p>
      </Section>

      <Section id="settings" title="Settings">
        <ul className="list-disc space-y-2 pl-5">
          <li>Dark or light mode.</li>
          <li>Change your password.</li>
          <li>Email IDs, the addresses you can share licenses to. The first one added becomes the default.</li>
          <li>The console logo: PNG, JPEG, WebP or SVG, up to 500 KB.</li>
        </ul>
      </Section>

      <Section id="integration" title="For developers">
        <p>These public endpoints need no admin token:</p>
        <Table
          head={['Endpoint', 'Used for']}
          rows={[
            [<Code key="v">POST /api/licenses/verify</Code>, 'Checking the key when the product starts'],
            [<Code key="s">POST /api/licenses/sync</Code>, 'Re-checking every hour'],
            [<Code key="l">POST /api/clients/login</Code>, 'Client sign-in'],
          ]}
        />
        <p>Example request body for verify and sync:</p>
        <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 font-mono text-xs text-slate-100 dark:bg-slate-950 dark:ring-1 dark:ring-slate-800">
          {'{"licenseKey":"OPEZ-7K3M-QX9P-2HTD","productName":"River Crossing","machineNumber":"PC-01"}'}
        </pre>
        <p>
          A product must lock itself whenever the response has <Code>&quot;valid&quot;: false</Code>. Verify and
          sync allow 20 requests per minute per IP. Client sign-in allows 30 failed attempts per 15 minutes per IP.
        </p>
      </Section>

      <Section id="troubleshooting" title="Troubleshooting">
        <Table
          head={['What the product sees', 'What to do']}
          rows={[
            [
              <>404 · Invalid license key</>,
              'The key was mistyped or the license was deleted. Check the key on the Licenses page.',
            ],
            [
              <>403 · Not valid for this product</>,
              'The license names a different product. Edit the product name on the license.',
            ],
            [
              <>403 · In use on another machine</>,
              'Another machine has claimed the key. The client must use the original machine (there is no reset button yet).',
            ],
            [<>valid: false · expired</>, "Renew it by editing the license's dates."],
            [<>valid: false · pending</>, "The start date hasn't arrived yet."],
            [<>valid: false · deactivated</>, 'Switch it back on from the license popup.'],
            [<>Too many requests</>, 'Wait a minute and try again (15 minutes after repeated failed sign-ins).'],
          ]}
        />
      </Section>
    </div>
  )
}
