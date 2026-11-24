import { useMemo, useState } from 'react'

import TableToolbar from '../components/TableToolbar'
import LicenseTable from '../components/LicenseTable'
import LicenseFormModal from '../components/LicenseFormModal'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'
import LicenseKey from '../components/LicenseKey'
import { EmptyState, ErrorState, TableSkeleton } from '../components/States'
import { useToast } from '../components/Toast'
import useLicenses, { filterByProduct, filterLicenses, useClients, useProducts } from '../hooks/useLicenses'
import { licenseApi } from '../services/api'
import { formatDate } from '../services/format'

const COLUMNS = [
  'clientName',
  'licenseKey',
  'companyName',
  'clientUserId',
  'productName',
  'soldBy',
  'machines',
  'startDate',
  'expiryDate',
  'status',
]

// Digital Diya's own view: no dates, and the screens each key runs on instead
// (out of what its Digital Diya plan allows, as reported on sync). No machines
// column: Digital Diya does not send machine numbers, so it claims no slots.
const DIGITAL_DIYA_COLUMNS = [
  'clientName',
  'licenseKey',
  'companyName',
  'clientUserId',
  'productName',
  'soldBy',
  'screens',
  'status',
]

const PRODUCT_FILTERS = [
  { value: 'other', label: 'Other' },
  { value: 'digital-diya', label: 'Digital Diya' },
]

export default function Licenses() {
  const { licenses, loading, error, reload } = useLicenses()
  const { products } = useProducts()
  // Existing POCs, so a new license can be filed under one instead of a duplicate.
  const { clients, reload: reloadClients } = useClients()

  const toast = useToast()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [product, setProduct] = useState('other')
  const [formOpen, setFormOpen] = useState(false)
  // `editing` drives both the View popup and Create — a null value means create.
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [created, setCreated] = useState(null)

  const visible = useMemo(
    () => filterLicenses(filterByProduct(licenses, product), search, status),
    [licenses, product, search, status]
  )
  const digitalDiya = product === 'digital-diya'
  const copied = () => toast.success('License key copied to clipboard')

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  const openView = (license) => {
    setEditing(license)
    setFormOpen(true)
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditing(null)
  }

  const handleSubmit = async (values, { deactivated } = {}) => {
    try {
      if (editing) {
        await licenseApi.update(editing.id, values)
        // The status dropdown only takes effect here, on Save Changes.
        const statusChanged =
          deactivated !== undefined && deactivated !== Boolean(editing.deactivated)
        if (statusChanged) await licenseApi.setStatus(editing.id, deactivated)
        toast.success('License updated successfully')
      } else {
        // Surface the generated key immediately — the admin needs to send it on.
        setCreated(await licenseApi.create(values))
        toast.success('License created successfully')
      }
      closeForm()
      await Promise.all([reload({ silent: true }), reloadClients({ silent: true })])
    } catch (err) {
      toast.error(err.message)
    }
  }

  // The popup stays open on its own copy of the machines; only the table is
  // refreshed, so unsaved edits in the form survive a release.
  const handleReleaseMachine = async (machineNumber) => {
    try {
      const updated = await licenseApi.releaseMachine(editing.id, machineNumber)
      toast.success(`${machineNumber} released`)
      await reload({ silent: true })
      return updated
    } catch (err) {
      toast.error(err.message)
      return null
    }
  }

  const handleDelete = async () => {
    setDeleteBusy(true)
    try {
      await licenseApi.remove(deleting.id)
      toast.success('License deleted successfully')
      setDeleting(null)
      await reload({ silent: true })
    } catch (err) {
      toast.error(err.message)
    } finally {
      setDeleteBusy(false)
    }
  }

  const renderBody = () => {
    if (loading) return <TableSkeleton cols={6} />
    if (error) return <ErrorState message={error} onRetry={reload} />
    if (!licenses.length) {
      return (
        <EmptyState
          title="No licenses found."
          description="Create your first license to get started."
          action={
            <button className="btn-primary" onClick={openCreate}>
              Create License
            </button>
          }
        />
      )
    }
    if (!visible.length) {
      return (
        <EmptyState
          title="No matching licenses"
          description={
            digitalDiya
              ? 'No Digital Diya licenses match. Try a different search term or clear the status filter.'
              : 'Try a different search term, clear the status filter or choose another product.'
          }
        />
      )
    }
    return (
      <LicenseTable
        licenses={visible}
        columns={digitalDiya ? DIGITAL_DIYA_COLUMNS : COLUMNS}
        onCopied={copied}
        actions={{ onView: openView, onDelete: setDeleting }}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="page-title">Licenses</h1>
          {/* <p className="page-subtitle">
            Create, review and revoke the license keys issued to your clients.
          </p> */}
        </div>
        <button className="btn-primary" onClick={openCreate}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Create License
        </button>
      </div>

      <div className="card overflow-hidden">
        <TableToolbar
          search={search}
          onSearch={setSearch}
          status={status}
          onStatus={setStatus}
          placeholder="Search by POC, company, email or key"
        >
          <select
            className="input w-full sm:w-44"
            aria-label="Product"
            value={product}
            onChange={(e) => setProduct(e.target.value)}
          >
            {PRODUCT_FILTERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </TableToolbar>
        {renderBody()}
      </div>

      <LicenseFormModal
        open={formOpen}
        license={editing}
        products={products}
        clients={clients}
        onClose={closeForm}
        onSubmit={handleSubmit}
        onReleaseMachine={handleReleaseMachine}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        busy={deleteBusy}
        title="Delete this license?"
        message={
          deleting
            ? `The license ${deleting.licenseKey} issued to ${deleting.clientName} will be permanently deleted and will stop verifying immediately. This cannot be undone.`
            : ''
        }
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />

      {/* Post-creation receipt showing the generated key */}
      <Modal
        open={Boolean(created)}
        title="License created"
        subtitle="Share this license key with your client for product activation."
        onClose={() => setCreated(null)}
        maxWidth="max-w-md"
      >
        {created && (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center dark:border-emerald-900 dark:bg-emerald-950">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                License Key
              </p>
              <div className="mt-2 flex justify-center">
                <LicenseKey value={created.licenseKey} onCopied={copied} size="lg" />
              </div>
            </div>
            <dl className="space-y-2 text-sm">
              {[
                ['Client', created.clientName],
                ['Product', created.productName],
                ['Starts on', formatDate(created.startDate)],
                ['Expires on', formatDate(created.expiryDate)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
                  <dd className="text-right font-medium text-slate-900 dark:text-white">{value}</dd>
                </div>
              ))}
            </dl>
            <button className="btn-primary w-full" onClick={() => setCreated(null)}>
              Done
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}
