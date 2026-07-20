import { useEffect, useState } from 'react'
import BootReveal, { BootCursor } from './BootReveal.jsx'
import './Guestbook.css'

const ACK_MS = 2500
const ALIAS_STORAGE_KEY = 'fs0ciety:guestbook-alias'

function loadSavedAlias() {
  try {
    return localStorage.getItem(ALIAS_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

function saveAlias(value) {
  try {
    localStorage.setItem(ALIAS_STORAGE_KEY, value)
  } catch {
    // ignore (e.g. storage disabled)
  }
}

function formatEntryTimestamp(iso) {
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function Guestbook({ ready }) {
  const [entries, setEntries] = useState(null)
  const [loadState, setLoadState] = useState('loading')
  const [alias, setAlias] = useState(loadSavedAlias)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [justSentId, setJustSentId] = useState(null)
  const [rateLimitSecondsLeft, setRateLimitSecondsLeft] = useState(null)
  const [adminToken, setAdminToken] = useState(null)
  const adminMode = adminToken !== null

  async function loadTraces() {
    setLoadState('loading')
    try {
      const res = await fetch('/api/traces?limit=50')
      if (!res.ok) throw new Error('bad_status')
      setEntries(await res.json())
      setLoadState('ready')
    } catch {
      setLoadState('error')
    }
  }

  useEffect(() => {
    if (!ready) return
    loadTraces()
  }, [ready])

  useEffect(() => {
    if (rateLimitSecondsLeft === null) return
    if (rateLimitSecondsLeft <= 0) {
      setRateLimitSecondsLeft(null)
      return
    }
    const timer = setTimeout(() => setRateLimitSecondsLeft((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [rateLimitSecondsLeft])

  async function handleAdminLogin(password) {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) throw new Error('access_denied')
      const body = await res.json()
      setAdminToken(body.token)
      setAlias(loadSavedAlias())
      setMessage('')
    } catch {
      setSubmitError('access denied')
      setMessage('')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id) {
    if (!adminToken) return
    const prevEntries = entries
    setEntries((prev) => prev.filter((entry) => entry.id !== id))
    try {
      const res = await fetch(`/api/traces/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      if (!res.ok) throw new Error('delete_failed')
    } catch {
      setEntries(prevEntries)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmedAlias = alias.trim()
    const trimmedMessage = message.trim()
    if (!trimmedAlias || !trimmedMessage || submitting || rateLimitSecondsLeft !== null) return

    if (trimmedAlias.toLowerCase() === 'admin') {
      await handleAdminLogin(trimmedMessage)
      return
    }

    const tempId = `pending-${Date.now()}`
    setEntries((prev) => [
      { id: tempId, alias: trimmedAlias, message: trimmedMessage, createdAt: new Date().toISOString(), pending: true },
      ...(prev || []),
    ])
    saveAlias(trimmedAlias)
    setAlias(trimmedAlias)
    setMessage('')
    setSubmitting(true)
    setSubmitError(null)

    try {
      const res = await fetch('/api/traces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: trimmedAlias, message: trimmedMessage }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const error = new Error(body?.error || 'request_failed')
        error.retryAfterMs = body?.retryAfterMs
        throw error
      }

      setEntries((prev) => prev.map((entry) => (entry.id === tempId ? body : entry)))
      setJustSentId(body.id)
      setTimeout(() => setJustSentId((id) => (id === body.id ? null : id)), ACK_MS)
    } catch (err) {
      setEntries((prev) => prev.filter((entry) => entry.id !== tempId))
      setMessage(trimmedMessage)
      if (err.message === 'rate_limited') {
        setRateLimitSecondsLeft(Math.ceil((err.retryAfterMs ?? 5000) / 1000))
      } else if (err.message === 'message contains blocked language') {
        setSubmitError('transmission rejected: watch your language, friend')
      } else {
        setSubmitError('connection lost — retry?')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const formDisabled = submitting || rateLimitSecondsLeft !== null

  return (
    <div className="gb-panel">
      <div className="gb-line gb-line--header">LEAVE A TRACE</div>

      <form className="gb-prompt" onSubmit={handleSubmit}>
        <span className="gb-caret">{'>'}</span>
        <input
          className="gb-alias-input"
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          placeholder="handle"
          maxLength={32}
          disabled={formDisabled}
          aria-label="alias"
        />
        <input
          className="gb-message-input"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="leave a trace..."
          maxLength={280}
          disabled={formDisabled}
          aria-label="message"
        />
        <button type="submit" className="gb-send" disabled={formDisabled}>
          send
        </button>
      </form>

      {rateLimitSecondsLeft !== null && (
        <p className="gb-status gb-status--error">
          {`too many transmissions — wait ${rateLimitSecondsLeft}s`}
        </p>
      )}
      {submitError && <p className="gb-status gb-status--error">{submitError}</p>}
      {justSentId && <p className="gb-status gb-status--ack">// transmission received</p>}
      {adminMode && <p className="gb-status gb-status--ack">{'// admin mode active'}</p>}

      <div className="gb-feed">
        {loadState === 'loading' && <p className="gb-status">loading trace log…</p>}
        {loadState === 'error' && (
          <p className="gb-status gb-status--error">
            connection lost —{' '}
            <button type="button" className="gb-retry" onClick={loadTraces}>
              retry?
            </button>
          </p>
        )}
        {loadState === 'ready' && entries.length === 0 && (
          <p className="gb-status">no traces yet. be the first.</p>
        )}
        {entries && (
          <BootReveal count={entries.length}>
            {({ revealCount, introDone }) => {
              const visible = introDone ? entries : entries.slice(0, revealCount)
              return visible.map((entry, i) => (
                <div
                  className={`gb-line${entry.pending ? ' gb-line--pending' : ''}`}
                  key={entry.id}
                >
                  <span className="gb-ts">[{formatEntryTimestamp(entry.createdAt)}]</span>{' '}
                  <span className="gb-alias">{`<${entry.alias}>`}</span>{' '}
                  <span className="gb-msg">{entry.message}</span>
                  {adminMode && !entry.pending && (
                    <button
                      type="button"
                      className="gb-delete"
                      onClick={() => handleDelete(entry.id)}
                      aria-label={`delete entry from ${entry.alias}`}
                    >
                      [x]
                    </button>
                  )}
                  {!introDone && i === visible.length - 1 && <BootCursor />}
                </div>
              ))
            }}
          </BootReveal>
        )}
      </div>
    </div>
  )
}

export default Guestbook
