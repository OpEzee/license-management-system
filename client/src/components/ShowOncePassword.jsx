import { useState } from 'react'

import { copyText } from './LicenseKey'

/**
 * A generated POC password, shown the one time it exists in readable form:
 * the server keeps only its hash, so once this closes nobody can see it again.
 *
 * The groups of four are spacing only. The password itself has no separators,
 * and Copy (or selecting the text) gives the plain 12 characters.
 */
export default function ShowOncePassword({ value, label = 'POC password', username, onCopied }) {
  const [copied, setCopied] = useState(false)
  const groups = value.match(/.{1,4}/g) || []

  const copy = async () => {
    await copyText(value)
    setCopied(true)
    onCopied?.()
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/60">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
        {label}
      </p>
      {username && (
        <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-300/80">
          Signs in as <span className="font-medium">{username}</span>
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <span
          className="flex gap-2.5 font-mono text-lg font-semibold tracking-wider text-slate-900 dark:text-white"
          aria-label={`Password ${value.split('').join(' ')}`}
        >
          {groups.map((g, i) => (
            <span key={i}>{g}</span>
          ))}
        </span>
        <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="mt-2 text-xs font-medium text-amber-900 dark:text-amber-200">
        Copy it now. It can't be shown again.
      </p>
    </div>
  )
}
