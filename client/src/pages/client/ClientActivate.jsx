import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import {
  BUTTON_CLASS,
  CARD_CLASS,
  CardHeading,
  Field,
  FormMessage,
  Handoff,
  INPUT_CLASS,
  KioskPage,
  LINK_CLASS,
} from '../../layouts/ClientLayout'
import { productClientApi } from '../../services/api'
import {
  KEY_PATTERN,
  formatKeyInput,
  linkTo,
  normalizeKey,
  notifyProduct,
  readParams,
} from '../../services/productLink'

/**
 * Signed in, not yet licensed: the operator types the key, and it is checked
 * with POST /api/licenses/verify. A key is not tied to a machine, so the same
 * key works on every installation it is entered on.
 *
 * A key the server knows but will not honour (expired, deactivated, pending)
 * is still handed to the product, so its next screen can say exactly why.
 *
 * Drawn like the sign-in card it follows: logo, heading, one field, the
 * button and Sign out.
 */
export default function ClientActivate() {
  const location = useLocation()
  const navigate = useNavigate()
  const params = readParams(location.search)

  const [key, setKey] = useState('')
  const [fieldError, setFieldError] = useState('')
  // The product may send back an error of its own, from its own re-check.
  const [formError, setFormError] = useState(params.error)
  const [submitting, setSubmitting] = useState(false)
  const [handedOff, setHandedOff] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitting || handedOff) return

    const licenseKey = normalizeKey(key)
    if (!licenseKey) return setFieldError('License key is required')
    if (!KEY_PATTERN.test(licenseKey)) {
      return setFieldError('Enter the 6-character key, e.g. K7M2Q9')
    }

    setSubmitting(true)
    setFormError('')
    try {
      const data = await productClientApi.verify({
        licenseKey,
        productName: params.product || undefined,
      })
      const status = data.valid ? 'active' : data.license?.status || 'deactivated'

      const told = notifyProduct('activated', {
        licenseKey,
        valid: Boolean(data.valid),
        status,
        license: data.license || null,
      })
      if (told) {
        setHandedOff(data.valid ? 'License activated. Opening...' : `${data.message}.`)
        return
      }
      navigate(linkTo(data.valid ? '/client/details' : '/client/status', params, { key: licenseKey }))
    } catch (err) {
      setFormError(err.status === 404 ? 'That license key was not found.' : err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const signOut = () => {
    if (!notifyProduct('signOut')) {
      navigate(linkTo('/client/login', { product: params.product, theme: params.theme }))
    }
  }

  return (
    <KioskPage>
      <form onSubmit={handleSubmit} noValidate className={CARD_CLASS}>
        <CardHeading>Activate License</CardHeading>

        <Field id="licenseKey" label="License key" error={fieldError}>
          <input
            id="licenseKey"
            type="text"
            autoComplete="off"
            spellCheck="false"
            autoFocus
            placeholder="XXXXXX"
            value={key}
            onChange={(e) => {
              setKey(formatKeyInput(e.target.value, key))
              setFieldError('')
              setFormError('')
            }}
            disabled={Boolean(handedOff)}
            className={`${INPUT_CLASS} font-mono tracking-[1px] ${fieldError ? '!border-[#e0532c]' : ''}`}
          />
        </Field>

        <FormMessage>{formError}</FormMessage>

        {handedOff ? (
          <Handoff>{handedOff}</Handoff>
        ) : (
          <button type="submit" disabled={submitting} className={BUTTON_CLASS}>
            {submitting ? 'Checking...' : 'Activate'}
          </button>
        )}

        <button
          type="button"
          onClick={signOut}
          disabled={submitting || Boolean(handedOff)}
          className={LINK_CLASS}
        >
          Sign out
        </button>
      </form>
    </KioskPage>
  )
}
