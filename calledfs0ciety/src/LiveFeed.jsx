import { useEffect, useRef, useState } from 'react'
import BootReveal, { BootCursor } from './BootReveal.jsx'
import './LiveFeed.css'

const POLL_MS = 5000
const LIMIT = 20

const CATEGORY_TAGS = {
  SYSTEM: 'SYS',
  CAMERA: 'CAM',
  GUESTBOOK: 'GB',
  VISITOR: 'VIS',
  API: 'API',
}

function formatClock(iso) {
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function renderEntry(event, showCursor) {
  return (
    <div className="feed-entry" key={event.id}>
      <span className="feed-ts">[{formatClock(event.createdAt)}]</span>{' '}
      <span className="feed-tag">[{CATEGORY_TAGS[event.category] ?? event.category}]</span>{' '}
      <span className="feed-msg">{event.message}</span>
      {showCursor && <BootCursor />}
    </div>
  )
}

function LiveFeed({ ready }) {
  const [events, setEvents] = useState(null)
  const [offline, setOffline] = useState(false)
  const [initialRevealDone, setInitialRevealDone] = useState(false)
  const listRef = useRef(null)
  const topIdRef = useRef(null)

  async function loadEvents() {
    try {
      const res = await fetch(`/api/events?limit=${LIMIT}`)
      if (!res.ok) throw new Error('bad_status')
      setEvents(await res.json())
      setOffline(false)
    } catch {
      setOffline(true)
    }
  }

  useEffect(() => {
    if (!ready) return
    loadEvents()
    const id = setInterval(loadEvents, POLL_MS)
    return () => clearInterval(id)
  }, [ready])

  useEffect(() => {
    if (!events || !events.length) return
    const newestId = events[0].id
    if (newestId !== topIdRef.current) {
      topIdRef.current = newestId
      if (listRef.current) listRef.current.scrollTop = 0
    }
  }, [events])

  return (
    <div className="feed-panel">
      <div className="feed-line feed-line--header">LIVE FEED</div>

      {offline && !events && <p className="feed-status feed-status--error">FEED OFFLINE</p>}

      <div className="feed-list" ref={listRef}>
        {events && events.length === 0 && <p className="feed-status">waiting for activity...</p>}
        {events && events.length > 0 && initialRevealDone && events.map((event) => renderEntry(event, false))}
        {events && events.length > 0 && !initialRevealDone && (
          <BootReveal count={events.length} onDone={() => setInitialRevealDone(true)}>
            {({ revealCount, introDone }) => {
              const visible = events.slice(0, revealCount)
              return visible.map((event, i) =>
                renderEntry(event, !introDone && i === visible.length - 1),
              )
            }}
          </BootReveal>
        )}
      </div>
    </div>
  )
}

export default LiveFeed
