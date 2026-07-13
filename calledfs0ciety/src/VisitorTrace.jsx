import { useEffect, useState } from 'react'
import { prefersReducedMotion } from './motion.js'
import './VisitorTrace.css'

const CHAR_MS_MIN = 12
const CHAR_MS_MAX = 30
const LINE_PAUSE_MS = 180

function detectBrowser(ua) {
  const checks = [
    [/Edg\//, /Edg\/([\d.]+)/, 'Edge'],
    [/OPR\//, /OPR\/([\d.]+)/, 'Opera'],
    [/Firefox\//, /Firefox\/([\d.]+)/, 'Firefox'],
    [/Chrome\//, /Chrome\/([\d.]+)/, 'Chrome'],
    [/Version\/[\d.]+.*Safari/, /Version\/([\d.]+)/, 'Safari'],
  ]
  for (const [test, versionRegex, name] of checks) {
    if (test.test(ua)) {
      const match = ua.match(versionRegex)
      const major = match ? match[1].split('.')[0] : null
      return major ? `${name} ${major}` : name
    }
  }
  return 'Unknown browser'
}

function detectOS(ua) {
  if (/Windows/.test(ua)) return 'Windows'
  if (/Android/.test(ua)) return 'Android'
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS'
  if (/Mac OS X/.test(ua)) return 'macOS'
  if (/Linux/.test(ua)) return 'Linux'
  return 'Unknown OS'
}

function formatUtcOffset(offsetMinutes) {
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  const hours = Math.floor(abs / 60)
  const minutes = abs % 60
  return `UTC${sign}${hours}${minutes ? ':' + String(minutes).padStart(2, '0') : ''}`
}

function formatLocalTime(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function detectGpu() {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    if (!ext) return null
    const raw = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
    if (!raw) return null
    const angleMatch = raw.match(/^ANGLE \([^,]+,\s*([^,]+?)(?:\s+Direct3D.*)?\)$/i)
    return angleMatch ? angleMatch[1].trim() : raw
  } catch {
    return null
  }
}

function detectCountryFromLocale() {
  try {
    const region = new Intl.Locale(navigator.language).region
    if (region) return region
  } catch {
    // Intl.Locale unavailable, fall through
  }
  const parts = (navigator.language || '').split('-')
  return parts.length > 1 ? parts[1].toUpperCase() : null
}

function detectDeviceType(ua) {
  const uaData = navigator.userAgentData
  const mobile = typeof uaData?.mobile === 'boolean' ? uaData.mobile : null

  const minDim = Math.min(screen.width, screen.height)
  const touchCapable = (navigator.maxTouchPoints || 0) > 0
  const uaIsTablet = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))
  const uaIsPhone = /Mobi|iPhone|Android.*Mobile/i.test(ua)

  let type
  if (mobile === true || uaIsPhone || (touchCapable && !uaIsTablet && minDim < 600)) {
    type = minDim >= 600 ? 'TABLET' : 'PHONE'
  } else if (uaIsTablet) {
    type = 'TABLET'
  } else {
    type = 'DESKTOP'
  }

  return `${type} (${detectOS(ua)})`
}

async function detectCpuArch() {
  try {
    const uaData = navigator.userAgentData
    if (!uaData?.getHighEntropyValues) return null
    const { architecture, bitness } = await uaData.getHighEntropyValues(['architecture', 'bitness'])
    if (!architecture) return null
    return bitness ? `${architecture}, ${bitness}-bit` : architecture
  } catch {
    return null
  }
}

async function fetchWhoami() {
  try {
    const res = await fetch('/api/whoami')
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function collectTraceLines() {
  const lines = [{ kind: 'header', text: 'YOUR INFORMATIONS:' }]

  const ua = navigator.userAgent
  lines.push({ kind: 'data', text: `BROWSER: ${detectBrowser(ua)} / ${detectOS(ua)}` })
  lines.push({ kind: 'data', text: `DEVICE: ${detectDeviceType(ua)}` })

  const cpuParts = []
  if (typeof navigator.hardwareConcurrency === 'number') {
    cpuParts.push(`${navigator.hardwareConcurrency} cores`)
  }
  const cpuArch = await detectCpuArch()
  if (cpuArch) cpuParts.push(cpuArch)
  if (cpuParts.length) {
    lines.push({ kind: 'data', text: `CPU: ${cpuParts.join(', ')}` })
  }

  if (typeof navigator.deviceMemory === 'number') {
    lines.push({ kind: 'data', text: `RAM: ~${navigator.deviceMemory}GB` })
  }

  const gpu = detectGpu()
  if (gpu) lines.push({ kind: 'data', text: `GPU: ${gpu}` })

  const dpr = window.devicePixelRatio || 1
  lines.push({
    kind: 'data',
    text: `SCREEN: ${screen.width}x${screen.height} @ ${dpr}x`,
  })

  const country = detectCountryFromLocale()
  if (country) {
    lines.push({ kind: 'data', text: `COUNTRY: ${country}` })
  }

  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const offset = formatUtcOffset(-new Date().getTimezoneOffset())
    lines.push({ kind: 'data', text: `TIMEZONE: ${tz} (${offset})` })
  } catch {
    // Intl unavailable, skip
  }

  const connection =
    navigator.connection || navigator.mozConnection || navigator.webkitConnection
  if (connection?.effectiveType) {
    const downlink = typeof connection.downlink === 'number' ? Math.round(connection.downlink) : null
    lines.push({
      kind: 'data',
      text: `CONNECTION: ${connection.effectiveType}${downlink ? `, ~${downlink}Mbps` : ''}`,
    })
  }

  const whoami = await fetchWhoami()

  lines.push({ kind: 'data', text: `LOCAL TIME: ${formatLocalTime(new Date())}` })

  if (whoami?.ip) {
    lines.push({ kind: 'data', text: `IP: ${whoami.ip}` })

    if (whoami.city || whoami.country) {
      const location = [whoami.city, whoami.country].filter(Boolean).join(', ')
      lines.push({ kind: 'data', text: `LOCATION: ${location}` })
    }

    if (whoami.asn) {
      const network = whoami.asOrganization ? `${whoami.asn} (${whoami.asOrganization})` : whoami.asn
      lines.push({ kind: 'data', text: `NETWORK: ${network}` })
    }
  }

  return lines
}

function VisitorTrace({ ready }) {
  const [lines, setLines] = useState(null)
  const [lineIndex, setLineIndex] = useState(0)
  const [charCount, setCharCount] = useState(0)
  const [instant] = useState(prefersReducedMotion)

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    collectTraceLines().then((collected) => {
      if (!cancelled) setLines(collected)
    })
    return () => {
      cancelled = true
    }
  }, [ready])

  useEffect(() => {
    if (!lines || instant) return
    if (lineIndex >= lines.length) return

    const currentText = lines[lineIndex].text
    if (charCount < currentText.length) {
      const delay = CHAR_MS_MIN + Math.random() * (CHAR_MS_MAX - CHAR_MS_MIN)
      const timer = setTimeout(() => setCharCount((c) => c + 1), delay)
      return () => clearTimeout(timer)
    }

    const timer = setTimeout(() => {
      setLineIndex((i) => i + 1)
      setCharCount(0)
    }, LINE_PAUSE_MS)
    return () => clearTimeout(timer)
  }, [lines, lineIndex, charCount, instant])

  if (!lines) return null

  const finished = instant || lineIndex >= lines.length
  const activeIndex = finished ? lines.length - 1 : lineIndex

  return (
    <div className="trace-panel">
      {lines.map((line, i) => {
        if (i > activeIndex) return null
        const text = i === activeIndex && !finished ? line.text.slice(0, charCount) : line.text
        return (
          <div className={`trace-line trace-line--${line.kind}`} key={line.text}>
            <span>{text}</span>
            {i === activeIndex && <span className="trace-cursor" />}
          </div>
        )
      })}
    </div>
  )
}

export default VisitorTrace
