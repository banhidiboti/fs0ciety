import { useEffect, useState } from 'react'
import { prefersReducedMotion } from './motion.js'
import './Guestbook.css'

const ACK_MS = 2500
const REVEAL_MS_MIN = 80
const REVEAL_MS_MAX = 160
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
  const [introDone, setIntroDone] = useState(prefersReducedMotion)
  const [revealCount, setRevealCount] = useState(0)
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
    if (!entries || introDone) return
    if (revealCount >= entries.length) {
      setIntroDone(true)
      return
    }
    const delay = REVEAL_MS_MIN + Math.random() * (REVEAL_MS_MAX - REVEAL_MS_MIN)
    const timer = setTimeout(() => setRevealCount((c) => c + 1), delay)
    return () => clearTimeout(timer)
  }, [entries, introDone, revealCount])

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
    if (!trimmedAlias || !trimmedMessage || submitting) return

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
      if (!res.ok) throw new Error(body?.error || 'request_failed')

      setEntries((prev) => prev.map((entry) => (entry.id === tempId ? body : entry)))
      setJustSentId(body.id)
      setTimeout(() => setJustSentId((id) => (id === body.id ? null : id)), ACK_MS)
    } catch (err) {
      setEntries((prev) => prev.filter((entry) => entry.id !== tempId))
      setMessage(trimmedMessage)
      let errorText = 'connection lost — retry?'
      if (err.message === 'rate_limited') errorText = 'too many transmissions — wait a bit'
      else if (err.message === 'message contains blocked language') {
        errorText = 'transmission rejected: watch your language, friend'
      }
      setSubmitError(errorText)
    } finally {
      setSubmitting(false)
    }
  }

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
          disabled={submitting}
          aria-label="alias"
        />
        <input
          className="gb-message-input"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="leave a trace..."
          maxLength={280}
          disabled={submitting}
          aria-label="message"
        />
        <button type="submit" className="gb-send" disabled={submitting}>
          send
        </button>
      </form>

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
        {(introDone ? entries : entries?.slice(0, revealCount))?.map((entry, i, visible) => (
          <div className={`gb-line${entry.pending ? ' gb-line--pending' : ''}`} key={entry.id}>
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
            {!introDone && i === visible.length - 1 && <span className="gb-cursor" />}
          </div>
        ))}
      </div>
    </div>
  )
}

export default Guestbook
