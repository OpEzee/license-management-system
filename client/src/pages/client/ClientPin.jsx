import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { productClientApi } from '../../services/api'
import { linkTo, notifyProduct, readParams } from '../../services/productLink'

const LENGTH = 4
/** How long a freshly typed digit stays readable before it becomes a dot. */
const PEEK_MS = 1000

/**
 * The staff PIN in front of a product's licence details (Digital Diya opens it
 * from its server-address page). Four digits from the keyboard submit on
 * their own and are checked by POST /api/licenses/details, which on the right
 * PIN returns the whole record: the details page then shows it as it is. A
 * wrong PIN empties the boxes for another try at once.
 *
 * Drawn as Match Match draws its own PIN gate — a card with a back control at
 * its corner, a two-line prompt and four boxes, each digit showing itself for
 * a second before it turns into a dot — at the kiosk panel's millimetres
 * scaled to the 520px column a product frames. Back (or Esc) tells the
 * product `close`.
 */
export default function ClientPin() {
  const location = useLocation()
  const navigate = useNavigate()
  const params = readParams(location.search)

  const [entry, setEntry] = useState('')
  const [message, setMessage] = useState('')
  const [retry, setRetry] = useState(false)
  const [checking, setChecking] = useState(false)
  // Index of the digit still showing itself, or -1 once it has become a dot.
  const [peek, setPeek] = useState(-1)
  // What the key handler reads: it is bound once, so state would go stale.
  const live = useRef({ entry: '', checking: false })
  live.current = { entry, checking }

  const close = () => {
    if (!notifyProduct('close')) navigate(-1)
  }

  const submit = async (pin) => {
    setChecking(true)
    try {
      const data = await productClientApi.details({
        licenseKey: params.key,
        productName: params.product || undefined,
        pin,
      })
      navigate(linkTo('/client/details', params, { email: data.license.clientUserId }), {
        replace: true,
        state: { license: data.license },
      })
    } catch (err) {
      setEntry('')
      setPeek(-1)
      setRetry(true)
      setMessage(err.status === 401 ? 'The PIN is incorrect. Try again.' : err.message)
    } finally {
      setChecking(false)
    }
  }

  const push = (digit) => {
    const { entry: e, checking: busy } = live.current
    if (busy || e.length >= LENGTH) return
    setRetry(false)
    setMessage('')
    const next = e + digit
    setPeek(e.length)
    setEntry(next)
    if (next.length === LENGTH) submit(next)
  }
  const pop = () => {
    if (live.current.checking) return
    setPeek(-1)
    setEntry(live.current.entry.slice(0, -1))
  }

  useEffect(() => {
    if (peek < 0) return undefined
    const t = setTimeout(() => setPeek(-1), PEEK_MS)
    return () => clearTimeout(t)
  }, [peek, entry])

  useEffect(() => {
    const onKey = (event) => {
      if (/^[0-9]$/.test(event.key)) push(event.key)
      else if (event.key === 'Backspace') pop()
      else if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const noKey = !params.key

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4 text-slate-900 dark:bg-[#0c1220] dark:text-white min-[480px]:px-[52px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pin-title"
        className="relative flex w-full max-w-[424px] flex-col items-center rounded-[12px] border border-slate-200 bg-slate-50 px-[19px] pb-[14px] pt-[43px] text-center dark:border-white/[0.12] dark:bg-[#121a2a]"
      >
        <button
          type="button"
          aria-label="Back"
          onClick={close}
          tabIndex={-1}
          className="absolute left-[12px] top-[12px] h-[34px] w-[34px] rounded-full bg-slate-900/[0.06] p-[7px] dark:bg-white/[0.08]"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-full w-full" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5 8 12l7 7" />
          </svg>
        </button>

        <h2
          id="pin-title"
          className="mb-[48px] max-w-[300px] text-[17px] font-bold leading-[1.3] [text-wrap:balance]"
        >
          {'Enter your PIN to view Admin Details.'}
        </h2>

        <div className="flex gap-[14px]" aria-label="PIN">
          {Array.from({ length: LENGTH }, (_, i) => {
            const active = !retry && !checking && !noKey && i === entry.length
            return (
              <span
                key={i}
                className={`flex h-[58px] w-[58px] items-center justify-center rounded-[10px] border bg-white text-[29px] leading-none dark:bg-[#1b2432] ${
                  retry
                    ? 'border-[#e0532c]'
                    : active
                      ? 'border-[#7c7ff0] shadow-[0_0_0_1.5px_rgba(124,127,240,0.35)]'
                      : 'border-slate-200 dark:border-white/[0.12]'
                }`}
              >
                {i === peek ? entry[i] : i < entry.length ? '•' : ''}
              </span>
            )
          })}
        </div>

        <p aria-live="polite" className="mt-[12px] min-h-[1.3em] text-[12.5px] text-[#e0532c]">
          {noKey ? 'No licence key was given to look up.' : checking ? '' : message || ' '}
        </p>
      </div>
    </div>
  )
}
