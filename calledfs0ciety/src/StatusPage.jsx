import { useEffect, useState } from 'react'
import { prefersReducedMotion } from './motion.js'
import './StatusPage.css'

const POLL_MS = 15000
const BAR_WIDTH = 10
const REVEAL_MS_MIN = 90
const REVEAL_MS_MAX = 170

function formatUptime(totalSeconds) {
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const parts = []
  if (days) parts.push(`${days}d`)
  if (days || hours) parts.push(`${hours}h`)
  parts.push(`${minutes}m`)
  return parts.join(' ')
}

function formatClock(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function asciiBarParts(fraction) {
  const filled = Math.round(Math.min(Math.max(fraction, 0), 1) * BAR_WIDTH)
  return { filled: '█'.repeat(filled), empty: '░'.repeat(BAR_WIDTH - filled) }
}

function StatusPage({ ready }) {
  const [status, setStatus] = useState(null)
  const [offline, setOffline] = useState(false)
  const [lastChecked, setLastChecked] = useState(null)
  const [introDone, setIntroDone] = useState(prefersReducedMotion)
  const [revealCount, setRevealCount] = useState(0)

  async function loadStatus() {
    try {
      const res = await fetch('/api/status')
      if (!res.ok) throw new Error('bad_status')
      setStatus(await res.json())
      setLastChecked(new Date())
      setOffline(false)
    } catch {
      setOffline(true)
    }
  }

  useEffect(() => {
    if (!ready) return
    loadStatus()
    const id = setInterval(loadStatus, POLL_MS)
    return () => clearInterval(id)
  }, [ready])

  const totalRows = status
    ? 6 + (status.resources.cpuTempC != null ? 1 : 0) + status.services.length
    : 0

  useEffect(() => {
    if (!status || introDone) return
    if (revealCount >= totalRows) {
      setIntroDone(true)
      return
    }
    const delay = REVEAL_MS_MIN + Math.random() * (REVEAL_MS_MAX - REVEAL_MS_MIN)
    const timer = setTimeout(() => setRevealCount((c) => c + 1), delay)
    return () => clearTimeout(timer)
  }, [status, introDone, revealCount, totalRows])

  if (!status) {
    return (
      <div className="status-panel">
        <div className="status-line status-line--header">SYSTEM STATUS — fs0ciety.hu</div>
        <p className="status-msg status-msg--error">
          {offline ? 'STATUS FEED OFFLINE' : 'connecting…'}
        </p>
      </div>
    )
  }

  const { host, resources, services } = status
  const cpuFraction = resources.cpuCount ? resources.loadavg[0] / resources.cpuCount : 0
  const cpuPct = Math.round(cpuFraction * 100)
  const memFraction = resources.totalMem
    ? (resources.totalMem - resources.freeMem) / resources.totalMem
    : 0
  const memPct = Math.round(memFraction * 100)
  const hasTemp = resources.cpuTempC != null

  const rowKeys = [
    'header',
    'uptime',
    'meta',
    'cpu-bar',
    'mem-bar',
    ...(hasTemp ? ['temp'] : []),
    ...services.map((svc) => `svc-${svc.name}`),
    'last-checked',
  ]
  const shown = (key) => introDone || rowKeys.indexOf(key) < revealCount
  const cursorAfter = (key) => !introDone && rowKeys.indexOf(key) === revealCount - 1

  return (
    <div className="status-panel">
      {shown('header') && (
        <div className="status-line status-line--header">
          SYSTEM STATUS — fs0ciety.hu
          {cursorAfter('header') && <span className="status-cursor" />}
        </div>
      )}

      {offline && <p className="status-msg status-msg--error">STATUS FEED OFFLINE</p>}

      {shown('uptime') && (
        <div className="status-line">
          UP {formatUptime(host.osUptimeSec)}
          {cursorAfter('uptime') && <span className="status-cursor" />}
        </div>
      )}
      {shown('meta') && (
        <div className="status-line status-line--dim">
          process up {formatUptime(host.processUptimeSec)} · {host.hostname} · {host.platform}/
          {host.arch}
          {cursorAfter('meta') && <span className="status-cursor" />}
        </div>
      )}

      <div className="status-section">
        {shown('cpu-bar') && (
          <div className="status-bar-row">
            <span className="status-bar-label">CPU LOAD</span>
            <span className="status-bar">
              [<span className="status-bar-fill">{asciiBarParts(cpuFraction).filled}</span>
              <span className="status-bar-empty">{asciiBarParts(cpuFraction).empty}</span>]
            </span>
            <span className="status-bar-pct">{cpuPct}%</span>
            {cursorAfter('cpu-bar') && <span className="status-cursor" />}
          </div>
        )}
        {shown('mem-bar') && (
          <div className="status-bar-row">
            <span className="status-bar-label">MEMORY</span>
            <span className="status-bar">
              [<span className="status-bar-fill">{asciiBarParts(memFraction).filled}</span>
              <span className="status-bar-empty">{asciiBarParts(memFraction).empty}</span>]
            </span>
            <span className="status-bar-pct">{memPct}%</span>
            {cursorAfter('mem-bar') && <span className="status-cursor" />}
          </div>
        )}
        {hasTemp && shown('temp') && (
          <div className="status-line status-line--dim">
            CPU TEMP: {resources.cpuTempC}°C
            {cursorAfter('temp') && <span className="status-cursor" />}
          </div>
        )}
      </div>

      <div className="status-section">
        {services.map((svc) => {
          const key = `svc-${svc.name}`
          if (!shown(key)) return null
          return (
            <div className="status-service" key={svc.name}>
              <span className={`status-tag status-tag--${svc.up ? 'up' : 'down'}`}>
                {svc.up ? 'UP' : 'DOWN'}
              </span>
              <span className="status-service-name">{svc.name}</span>
              <span className="status-service-time">
                {svc.responseTimeMs != null ? `${svc.responseTimeMs}ms` : '--'}
              </span>
              {cursorAfter(key) && <span className="status-cursor" />}
            </div>
          )
        })}
      </div>

      {lastChecked && shown('last-checked') && (
        <div className="status-line status-line--dim">
          last checked: {formatClock(lastChecked)}
          {cursorAfter('last-checked') && <span className="status-cursor" />}
        </div>
      )}
    </div>
  )
}

export default StatusPage
