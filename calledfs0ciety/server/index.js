import Database from 'better-sqlite3'
import cors from 'cors'
import crypto from 'node:crypto'
import express from 'express'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkProfanity, PROFANITY_MODE } from './profanity.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3001
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGIN || 'http://localhost:5173,https://fs0ciety.hu'
).split(',')

// Checked by GET /api/status. type: 'http' GETs the target and treats any
// non-5xx response as up; type: 'port' just tries a raw TCP connect.
const SERVICES = [
  { name: 'website', type: 'http', target: 'https://fs0ciety.hu' },
  { name: 'guestbook-api', type: 'http', target: `http://localhost:${PORT}/api/traces?limit=1` },
  // { name: 'pi-hole', type: 'http', target: 'http://192.168.1.2/admin' },
  // { name: 'ssh', type: 'port', target: '192.168.1.2:22' },
]
const SERVICE_CHECK_TIMEOUT_MS = 3000
const STATUS_CACHE_MS = 10_000

const DATA_DIR = join(__dirname, 'data')
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR)

const db = new Database(join(DATA_DIR, 'fs0ciety.db'))
db.pragma('journal_mode = WAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS traces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alias TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )
`)
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )
`)

// Keeps the table itself small (unbounded-history isn't needed for a live
// feed) while GET /api/events can still cap further via ?limit=.
const EVENT_HISTORY_LIMIT = 50

function logEvent(category, message) {
  db.prepare('INSERT INTO events (category, message) VALUES (?, ?)').run(category, message)
  db.prepare(
    'DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT ?)',
  ).run(EVENT_HISTORY_LIMIT)
}

function getClientIp(req) {
  const forwardedFor = req.headers['x-forwarded-for']
  return (
    req.headers['cf-connecting-ip'] ||
    (forwardedFor ? forwardedFor.split(',')[0].trim() : null) ||
    req.ip
  )
}

function stripHtml(value) {
  return value.replace(/<[^>]*>/g, '').trim()
}

// At most one VIS event per visitor per window, so a browsing session full
// of page loads/reloads doesn't turn the live feed into pure VIS spam.
const VISITOR_DEDUP_WINDOW_MS = 10 * 60 * 1000
const visitorLastLoggedAt = new Map() // ip -> ms timestamp of last VIS log

const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

function isLoopbackIp(ip) {
  return !ip || LOOPBACK_IPS.has(ip)
}

function maybeLogVisitorEvent(ip) {
  const now = Date.now()
  const last = visitorLastLoggedAt.get(ip)
  const isNew = last === undefined
  if (!isNew && now - last < VISITOR_DEDUP_WINDOW_MS) return
  visitorLastLoggedAt.set(ip, now)
  logEvent('VISITOR', isNew ? 'visitor connected' : 'returning visitor detected')
}

// 5 posts allowed back-to-back, then a short 5s cooldown rather than a long
// block — the window slides, so as soon as the oldest of the 5 timestamps
// ages out, one slot frees up again.
const RATE_LIMIT_WINDOW_MS = 5 * 1000
const RATE_LIMIT_MAX = 5
const postTimestampsByIp = new Map()

// Returns 0 if the request is allowed (and records it), or the number of ms
// the caller must still wait otherwise.
function getRateLimitRetryAfterMs(ip) {
  const now = Date.now()
  const timestamps = (postTimestampsByIp.get(ip) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  )
  if (timestamps.length >= RATE_LIMIT_MAX) {
    postTimestampsByIp.set(ip, timestamps)
    const oldest = Math.min(...timestamps)
    return RATE_LIMIT_WINDOW_MS - (now - oldest)
  }
  timestamps.push(now)
  postTimestampsByIp.set(ip, timestamps)
  return 0
}

const ADMIN_PASSWORD = 'F@szkukker1'
const ADMIN_LOGIN_WINDOW_MS = 10 * 60 * 1000
const ADMIN_LOGIN_MAX = 5
const adminLoginAttemptsByIp = new Map()

function isAdminLoginRateLimited(ip) {
  const now = Date.now()
  const timestamps = (adminLoginAttemptsByIp.get(ip) || []).filter(
    (t) => now - t < ADMIN_LOGIN_WINDOW_MS,
  )
  if (timestamps.length >= ADMIN_LOGIN_MAX) {
    adminLoginAttemptsByIp.set(ip, timestamps)
    return true
  }
  timestamps.push(now)
  adminLoginAttemptsByIp.set(ip, timestamps)
  return false
}

function isCorrectPassword(candidate) {
  // Hash both sides to a fixed-length digest so timingSafeEqual never sees
  // mismatched buffer lengths (which itself would leak length info).
  const candidateHash = crypto.createHash('sha256').update(candidate).digest()
  const actualHash = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest()
  return crypto.timingSafeEqual(candidateHash, actualHash)
}

const ADMIN_TOKEN_TTL_MS = 30 * 60 * 1000
const adminTokens = new Map() // token -> expiresAt

function createAdminToken() {
  const token = crypto.randomBytes(32).toString('hex')
  adminTokens.set(token, Date.now() + ADMIN_TOKEN_TTL_MS)
  return token
}

function isValidAdminToken(token) {
  if (!token) return false
  const expiresAt = adminTokens.get(token)
  if (!expiresAt) return false
  if (Date.now() > expiresAt) {
    adminTokens.delete(token)
    return false
  }
  return true
}

function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  const token = bearerToken || req.headers['x-admin-token']
  if (!isValidAdminToken(token)) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  next()
}

function readCpuTempC() {
  try {
    const raw = readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8')
    const millidegrees = parseInt(raw.trim(), 10)
    if (Number.isNaN(millidegrees)) return null
    return Math.round((millidegrees / 1000) * 10) / 10
  } catch {
    return null
  }
}

function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    promise.then((value) => {
      clearTimeout(timer)
      resolve(value)
    })
  })
}

function checkHttpTarget(target, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now()
    let url
    try {
      url = new URL(target)
    } catch {
      return resolve({ up: false, responseTimeMs: null })
    }

    const lib = url.protocol === 'https:' ? https : http
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      const responseTimeMs = Date.now() - start
      res.resume()
      resolve({ up: res.statusCode < 500, responseTimeMs })
      req.destroy()
    })
    req.on('timeout', () => {
      req.destroy()
      resolve({ up: false, responseTimeMs: null })
    })
    req.on('error', () => {
      resolve({ up: false, responseTimeMs: null })
    })
  })
}

function checkPortTarget(target, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now()
    const [host, portStr] = target.split(':')
    const port = parseInt(portStr, 10)
    const socket = new net.Socket()

    const finish = (up) => {
      socket.destroy()
      resolve({ up, responseTimeMs: up ? Date.now() - start : null })
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}

async function checkService(service) {
  const checker = service.type === 'port' ? checkPortTarget : checkHttpTarget
  const result = await withTimeout(
    checker(service.target, SERVICE_CHECK_TIMEOUT_MS),
    SERVICE_CHECK_TIMEOUT_MS + 500,
    { up: false, responseTimeMs: null },
  )
  return { name: service.name, up: result.up, responseTimeMs: result.responseTimeMs }
}

let statusCache = null
let statusCacheAt = 0

async function getStatusPayload() {
  const now = Date.now()
  if (statusCache && now - statusCacheAt < STATUS_CACHE_MS) {
    return statusCache
  }

  const services = await Promise.all(SERVICES.map(checkService))

  const resources = {
    loadavg: os.loadavg(),
    cpuCount: os.cpus().length,
    totalMem: os.totalmem(),
    freeMem: os.freemem(),
  }
  const cpuTempC = readCpuTempC()
  if (cpuTempC !== null) resources.cpuTempC = cpuTempC

  const payload = {
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      processUptimeSec: Math.round(process.uptime()),
      osUptimeSec: Math.round(os.uptime()),
    },
    resources,
    services,
    checkedAt: new Date().toISOString(),
  }

  statusCache = payload
  statusCacheAt = Date.now()
  return payload
}

// Drives the LIVE FEED panel. Separate from SERVICES/getStatusPayload above
// (which is cached and only runs when a client hits /api/status) so feed
// events keep appearing autonomously even with nobody polling the site, and
// so the extra camera checks don't leak into the System Status panel.
const EVENT_CAMERAS = [
  { id: 'thuthu', label: 'CAM_01', stream: 'https://cam.idokep.hu/live/thuthu/live-300918a100.m3u8' },
  {
    id: 'hotelvictoria',
    label: 'CAM_02',
    stream: 'https://cam.idokep.hu/live/hotelvictoria/live-0020520885.m3u8',
  },
  {
    id: 'budapestpark',
    label: 'CAM_03',
    stream: 'https://cam.idokep.hu/live/budapestpark/live-c995f18840.m3u8',
  },
  {
    id: 'schonherz1',
    label: 'CAM_04',
    stream: 'https://cam.idokep.hu/live/schonherz1/live-c57fd0cbbe.m3u8',
  },
]

const EVENT_CHECK_TARGETS = [
  { key: 'website', kind: 'web', target: 'https://fs0ciety.hu' },
  { key: 'guestbook-api', kind: 'api', target: `http://localhost:${PORT}/api/traces?limit=1` },
  ...EVENT_CAMERAS.map((cam) => ({ key: cam.id, kind: 'camera', target: cam.stream, label: cam.label })),
]

const EVENT_CHECK_INTERVAL_MS = 45_000
// ~ once every 11 minutes at the interval above - an occasional heartbeat,
// not a transition, so it shouldn't fire on every single check.
const HEALTH_CHECK_LOG_EVERY = 15
const UPTIME_MILESTONES_SEC = [3600, 21600, 86400, 604800]

const eventCheckState = new Map() // key -> { up: bool|null, streak: number }
const loggedUptimeMilestones = new Set()

function formatUptimeLabel(seconds) {
  return seconds >= 86400 ? `${seconds / 86400}d` : `${seconds / 3600}h`
}

async function runEventChecks() {
  for (const target of EVENT_CHECK_TARGETS) {
    const result = await checkHttpTarget(target.target, SERVICE_CHECK_TIMEOUT_MS)
    const prev = eventCheckState.get(target.key) || { up: null, streak: 0 }

    if (result.up) {
      if (prev.up === null) {
        if (target.kind === 'camera') logEvent('CAMERA', `${target.label} stream active`)
        else if (target.kind === 'api') logEvent('API', 'guestbook-api online')
        else logEvent('SYSTEM', 'website online')
      } else if (prev.up === false) {
        if (target.kind === 'camera') logEvent('CAMERA', `${target.label} reconnected`)
        else if (target.kind === 'api') logEvent('API', 'guestbook-api recovered')
        else logEvent('SYSTEM', 'website online')
      }
      const streak = prev.up === true ? prev.streak + 1 : 1
      if (target.kind === 'web' && streak % HEALTH_CHECK_LOG_EVERY === 0) {
        logEvent('SYSTEM', 'website health check passed')
      }
      eventCheckState.set(target.key, { up: true, streak })
    } else {
      if (prev.up === true && target.kind === 'camera') {
        logEvent('CAMERA', `stream unavailable: ${target.label}`)
      }
      eventCheckState.set(target.key, { up: false, streak: 0 })
    }
  }

  for (const seconds of UPTIME_MILESTONES_SEC) {
    if (process.uptime() >= seconds && !loggedUptimeMilestones.has(seconds)) {
      loggedUptimeMilestones.add(seconds)
      logEvent('SYSTEM', `uptime milestone reached: ${formatUptimeLabel(seconds)}`)
    }
  }
}

const app = express()
app.set('trust proxy', true)
app.use(cors({ origin: ALLOWED_ORIGINS }))
app.use(express.json({ limit: '4kb' }))

app.get('/api/whoami', (req, res) => {
  res.set('Cache-Control', 'no-store')

  const ip = getClientIp(req)
  const isOwner = req.query.owner === '1'
  if (ip && !isOwner && !isLoopbackIp(ip)) {
    maybeLogVisitorEvent(ip)
  }

  const country = req.headers['cf-ipcountry']
  // CF-IPCity / CF-Region only appear once "Add visitor location headers"
  // is enabled in Cloudflare (Rules > Managed Transforms).
  const city = req.headers['cf-ipcity']
  const region = req.headers['cf-region']
  // Plain Cloudflare proxying to an origin does not include ASN in request
  // headers (that's only exposed inside a Cloudflare Worker's `request.cf`
  // object). These are read in case a Worker or transform rule adds them.
  const asn = req.headers['cf-asn']
  const asOrganization = req.headers['cf-as-organization']

  const payload = {
    ip: ip || null,
    userAgent: req.headers['user-agent'] || null,
  }
  if (country && country !== 'XX') payload.country = country
  if (city) payload.city = city
  if (region) payload.region = region
  if (asn) payload.asn = asn
  if (asOrganization) payload.asOrganization = asOrganization

  res.json(payload)
})

app.get('/api/traces', (req, res) => {
  res.set('Cache-Control', 'no-store')

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100)
  const rows = db
    .prepare('SELECT id, alias, message, created_at FROM traces ORDER BY id DESC LIMIT ?')
    .all(limit)

  res.json(
    rows.map((row) => ({
      id: row.id,
      alias: row.alias,
      message: row.message,
      createdAt: row.created_at,
    })),
  )
})

app.get('/api/events', (req, res) => {
  res.set('Cache-Control', 'no-store')

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100)
  const rows = db
    .prepare('SELECT id, category, message, created_at FROM events ORDER BY id DESC LIMIT ?')
    .all(limit)

  res.json(
    rows.map((row) => ({
      id: row.id,
      category: row.category,
      message: row.message,
      createdAt: row.created_at,
    })),
  )
})

app.post('/api/traces', (req, res) => {
  res.set('Cache-Control', 'no-store')

  const retryAfterMs = getRateLimitRetryAfterMs(getClientIp(req))
  if (retryAfterMs > 0) {
    return res.status(429).json({ error: 'rate_limited', retryAfterMs })
  }

  const { alias, message } = req.body || {}
  if (typeof alias !== 'string' || typeof message !== 'string') {
    return res.status(400).json({ error: 'invalid_input' })
  }

  const cleanAlias = stripHtml(alias)
  const cleanMessage = stripHtml(message)

  if (!cleanAlias || !cleanMessage) {
    return res.status(400).json({ error: 'empty_input' })
  }
  if (cleanAlias.toLowerCase() === 'admin') {
    return res.status(400).json({ error: 'reserved_alias' })
  }
  if (cleanAlias.length > 32 || cleanMessage.length > 280) {
    return res.status(400).json({ error: 'too_long' })
  }

  const aliasCheck = checkProfanity(cleanAlias)
  const messageCheck = checkProfanity(cleanMessage)
  if (aliasCheck.flagged || messageCheck.flagged) {
    if (PROFANITY_MODE !== 'censor') {
      return res.status(400).json({ error: 'message contains blocked language' })
    }
  }
  const finalAlias = PROFANITY_MODE === 'censor' ? aliasCheck.censored : cleanAlias
  const finalMessage = PROFANITY_MODE === 'censor' ? messageCheck.censored : cleanMessage

  const info = db
    .prepare('INSERT INTO traces (alias, message) VALUES (?, ?)')
    .run(finalAlias, finalMessage)
  const row = db
    .prepare('SELECT id, alias, message, created_at FROM traces WHERE id = ?')
    .get(info.lastInsertRowid)

  logEvent('GUESTBOOK', `trace submitted by ${finalAlias}`)

  res.status(201).json({
    id: row.id,
    alias: row.alias,
    message: row.message,
    createdAt: row.created_at,
  })
})

app.post('/api/admin/login', (req, res) => {
  res.set('Cache-Control', 'no-store')

  if (isAdminLoginRateLimited(getClientIp(req))) {
    return res.status(429).json({ error: 'rate_limited' })
  }

  const { password } = req.body || {}
  if (typeof password !== 'string' || !isCorrectPassword(password)) {
    return res.status(401).json({ error: 'invalid_credentials' })
  }

  res.json({ token: createAdminToken() })
})

app.delete('/api/traces/:id', requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store')

  const id = parseInt(req.params.id, 10)
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'invalid_id' })
  }

  const existing = db.prepare('SELECT alias FROM traces WHERE id = ?').get(id)
  const info = db.prepare('DELETE FROM traces WHERE id = ?').run(id)
  if (info.changes === 0) {
    return res.status(404).json({ error: 'not_found' })
  }

  logEvent('GUESTBOOK', `trace deleted${existing ? ` (${existing.alias})` : ''}`)

  res.status(204).end()
})

app.get('/api/status', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(await getStatusPayload())
})

const distPath = join(__dirname, '..', 'dist')
app.use(express.static(distPath))

app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(join(distPath, 'index.html'))
})

app.listen(PORT, () => {
  console.log(`fs0ciety server listening on :${PORT}`)
  runEventChecks()
  setInterval(runEventChecks, EVENT_CHECK_INTERVAL_MS)
})
