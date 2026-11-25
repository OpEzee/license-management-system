/*
 * The Help page's overview: who talks to the server, and why. Drawn with
 * boxes and text arrows rather than an image so it follows the theme and
 * reflows on a phone, where it stacks top to bottom.
 */

const NODE =
  'flex-1 rounded-lg border border-slate-200 bg-white px-4 py-3 text-center dark:border-slate-700 dark:bg-slate-900'

function Node({ title, text, highlight = false }) {
  return (
    <div className={`${NODE} ${highlight ? 'border-brand-500 dark:border-brand-500' : ''}`}>
      <p className="text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{text}</p>
    </div>
  )
}

/**
 * The label sits on the line. Stacked, the boxes run top to bottom, so a
 * right-pointing link points down and a left-pointing one points up.
 */
function Connector({ label, direction }) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center px-1 text-center md:w-36">
      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>
      <span className="select-none text-lg leading-none text-slate-400 dark:text-slate-500" aria-hidden="true">
        <span className="md:hidden">{direction === 'left' ? '↑' : '↓'}</span>
        <span className="hidden md:inline">{direction === 'left' ? '←' : '→'}</span>
      </span>
    </div>
  )
}

export default function HelpFlowDiagram() {
  return (
    <figure>
      <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
        <Node title="Admin dashboard" text="Issues and manages licenses" />
        <Connector label="Creates the key" direction="right" />
        <Node title="Server + MongoDB" text="Holds every license and its machines" highlight />
        <Connector label="Verify on start, sync every hour" direction="left" />
        <Node title="Opezee product" text="Sends its key and machine number" />
      </div>
      <figcaption className="mt-3 text-center text-xs text-slate-500 dark:text-slate-400">
        The admin emails the key to the client, who enters it in the product.
      </figcaption>
    </figure>
  )
}
