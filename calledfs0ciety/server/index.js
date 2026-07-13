import Database from 'better-sqlite3'
import cors from 'cors'
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

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
const RATE_LIMIT_MAX = 3
const postTimestampsByIp = new Map()

function isRateLimited(ip) {
  const now = Date.now()
  const timestamps = (postTimestampsByIp.get(ip) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  )
  if (timestamps.length >= RATE_LIMIT_MAX) {
    postTimestampsByIp.set(ip, timestamps)
    return true
  }
  timestamps.push(now)
  postTimestampsByIp.set(ip, timestamps)
  return false
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

const app = express()
app.set('trust proxy', true)
app.use(cors({ origin: ALLOWED_ORIGINS }))
app.use(express.json({ limit: '4kb' }))

app.get('/api/whoami', (req, res) => {
  res.set('Cache-Control', 'no-store')

  const ip = getClientIp(req)
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

app.post('/api/traces', (req, res) => {
  res.set('Cache-Control', 'no-store')

  if (isRateLimited(getClientIp(req))) {
    return res.status(429).json({ error: 'rate_limited' })
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

  res.status(201).json({
    id: row.id,
    alias: row.alias,
    message: row.message,
    createdAt: row.created_at,
  })
})

app.get('/api/status', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(await getStatusPayload())
})

app.listen(PORT, () => {
  console.log(`fs0ciety server listening on :${PORT}`)
})
