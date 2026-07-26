import https from 'node:https'

// Keep in sync with the frontend's WebcamPanel.jsx CAMERAS list.
export const CAMERA_IDS = [
  'hotelvictoria',
  'thuthu',
  'budapestpark',
  'schonherz1',
  'tihany_onkormanyzat',
  'internetx',
  'mordok',
  'fary24',
  'letyi',
  'dmjvcam3',
  'elco',
  'leonetti3',
  'volgyvaros6',
  'volgyvaros5',
]

const RESOLVE_TTL_MS = 5 * 60 * 1000
const resolvedCache = new Map() // id -> { path: 'live/<id>/live-<hash>.m3u8', resolvedAt }

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        if (res.statusCode >= 400) {
          res.resume()
          return reject(new Error(`http_${res.statusCode}`))
        }
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => resolve(data))
      })
      .on('error', reject)
  })
}

// idokep.hu rotates the hash suffix of each camera's live .m3u8 path every
// time its stream restarts, so a hardcoded URL eventually 404s. Instead of
// hardcoding it, scrape the same webcam page idokep's own site loads and
// read off whatever path is live there right now - cached briefly so we
// aren't re-scraping the page on every playlist request.
async function resolveCameraPath(id, { force = false } = {}) {
  const cached = resolvedCache.get(id)
  if (!force && cached && Date.now() - cached.resolvedAt < RESOLVE_TTL_MS) {
    return cached.path
  }

  const html = await fetchText(`https://www.idokep.hu/webkamera/${id}`)
  const match = html.match(new RegExp(`live/${id}/live-[a-f0-9]+\\.m3u8`))
  if (!match) throw new Error('stream_not_found')

  resolvedCache.set(id, { path: match[0], resolvedAt: Date.now() })
  return match[0]
}

// Fetches the current playlist text, re-resolving the path once if the
// cached hash has gone stale in the meantime (upstream 404s on it).
export async function fetchCameraPlaylist(id) {
  const path = await resolveCameraPath(id)
  try {
    return await fetchText(`https://cam.idokep.hu/${path}`)
  } catch {
    const freshPath = await resolveCameraPath(id, { force: true })
    return await fetchText(`https://cam.idokep.hu/${freshPath}`)
  }
}
