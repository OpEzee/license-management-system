import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { highlightParts, matchClients } from '../services/clientSearch'

/*
 * A typed field that suggests existing clients, replacing a <datalist>: the
 * browser's popup could not be styled, covered the form, and listed every
 * client before anything was typed.
 *
 * The list is portalled to <body> with fixed positioning, like DatePicker, so
 * the modal's scroll area cannot clip it and opening it never moves the form.
 */

const MAX_RESULTS = 8

function Highlighted({ text, query }) {
  return highlightParts(text, query).map((p, i) =>
    p.match ? (
      <mark key={i} className="bg-transparent font-semibold text-brand-700 dark:text-brand-300">
        {p.text}
      </mark>
    ) : (
      <span key={i}>{p.text}</span>
    )
  )
}

export default function ClientCombobox({
  id,
  value,
  clients = [],
  onInputChange,
  // (client) => void. Called with null for the "New POC" row.
  onSelect,
  invalid = false,
  placeholder,
}) {
  const listId = useId()
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState(null)

  const query = String(value || '')
  const matches = useMemo(() => matchClients(clients, query, MAX_RESULTS), [clients, query])
  // Nothing matches: one row offering the typed text as a new POC.
  const rows = matches.length ? matches : query.trim() ? [null] : []
  const expanded = open && rows.length > 0
  const optionId = (i) => `${listId}-opt-${i}`

  const place = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPosition({ left: rect.left, top: rect.bottom + 4, width: rect.width })
  }, [])

  useLayoutEffect(() => {
    if (!expanded) return undefined
    place()
    // The modal body scrolls, so the list has to follow its field.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [expanded, place])

  useEffect(() => {
    if (!expanded) return undefined
    const onDown = (e) => {
      if (listRef.current?.contains(e.target) || inputRef.current?.contains(e.target)) return
      setOpen(false)
    }
    // Escape closes the list first; the modal behind it stays open.
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [expanded])

  // Keep the active row in view as the arrow keys move past the scroll edge.
  useEffect(() => {
    if (!expanded) return
    document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' })
  }, [active, expanded]) // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (row) => {
    setOpen(false)
    onSelect(row)
  }

  const onKeyDown = (e) => {
    if (e.key === 'Tab') {
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!rows.length) return
      e.preventDefault()
      if (!expanded) {
        setOpen(true)
        setActive(0)
        return
      }
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (i + step + rows.length) % rows.length)
      return
    }
    // Only swallowed while the list is open, so Enter still submits the form.
    if (e.key === 'Enter' && expanded) {
      e.preventDefault()
      choose(rows[active])
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded ? optionId(active) : undefined}
        autoComplete="off"
        spellCheck={false}
        className={`input ${invalid ? 'border-red-400' : ''}`}
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          onInputChange(e.target.value)
          setActive(0)
          setOpen(Boolean(e.target.value.trim()))
        }}
        onKeyDown={onKeyDown}
      />

      {expanded &&
        position &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Matching POCs"
            style={{ position: 'fixed', left: position.left, top: position.top, width: position.width }}
            className="scrollbar-themed z-[60] max-h-[280px] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:theme(colors.slate.300)_transparent] dark:[scrollbar-color:theme(colors.slate.600)_transparent] rounded-lg border border-slate-200 bg-white py-1 shadow-xl shadow-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/40"
          >
            {rows.map((row, i) => {
              const isActive = i === active
              return (
                <li
                  key={row ? row.id || `${row.clientName}-${row.username}` : 'new'}
                  id={optionId(i)}
                  role="option"
                  aria-selected={isActive}
                  // mousedown, not click: the input keeps focus, so the list
                  // is not closed by the blur before the choice lands.
                  onMouseDown={(e) => {
                    e.preventDefault()
                    choose(row)
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`cursor-pointer px-3 py-2 text-sm ${
                    isActive
                      ? 'bg-brand-50 text-brand-800 dark:bg-slate-800 dark:text-brand-300'
                      : 'text-slate-800 dark:text-slate-100'
                  }`}
                >
                  {row ? (
                    <>
                      <p className="truncate font-semibold">
                        <Highlighted text={row.clientName} query={query} />
                      </p>
                      {(row.companyName || row.username) && (
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                          {row.companyName && <Highlighted text={row.companyName} query={query} />}
                          {row.companyName && row.username && ' · '}
                          {row.username && <Highlighted text={row.username} query={query} />}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="truncate">
                      New POC: <span className="font-semibold">{query.trim()}</span>
                    </p>
                  )}
                </li>
              )
            })}
          </ul>,
          document.body
        )}
    </>
  )
}
