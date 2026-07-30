import https from 'node:https'

// Order here drives the order rendered in the WATCHLIST widget on the site.
export const STOCKS = [
  { symbol: 'LMT', name: 'Lockheed Martin', yahoo: 'LMT' },
  { symbol: 'NOC', name: 'Northrop Grumman', yahoo: 'NOC' },
  { symbol: 'RHM', name: 'Rheinmetall', yahoo: 'RHM.DE' },
  { symbol: 'RTX', name: 'RTX', yahoo: 'RTX' },
  { symbol: 'PLTR', name: 'Palantir', yahoo: 'PLTR' },
  { symbol: 'SPCX', name: 'SpaceX', yahoo: 'SPCX' },
  { symbol: 'RKLB', name: 'Rocket Lab', yahoo: 'RKLB' },
  { symbol: 'AAPL', name: 'Apple', yahoo: 'AAPL' },
  { symbol: 'TSLA', name: 'Tesla', yahoo: 'TSLA' },
  { symbol: 'NVDA', name: 'Nvidia', yahoo: 'NVDA' },
  { symbol: 'META', name: 'Meta Platforms', yahoo: 'META' },
  { symbol: 'AMZN', name: 'Amazon', yahoo: 'AMZN' },
  { symbol: 'MSFT', name: 'Microsoft', yahoo: 'MSFT' },
  { symbol: 'GOOGL', name: 'Alphabet', yahoo: 'GOOGL' },
]

const QUOTE_TIMEOUT_MS = 5000
// Downsampled point count for the sparkline - enough shape, small payload.
const SPARKLINE_POINTS = 24

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: QUOTE_TIMEOUT_MS }, (res) => {
      if (res.statusCode >= 400) {
        res.resume()
        return reject(new Error(`http_${res.statusCode}`))
      }
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (err) {
          reject(err)
        }
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

function downsample(values, targetCount) {
  if (values.length <= targetCount) return values
  const step = values.length / targetCount
  const out = []
  for (let i = 0; i < targetCount; i++) {
    out.push(values[Math.floor(i * step)])
  }
  return out
}

async function fetchQuote(stock) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(stock.yahoo)}?range=1d&interval=15m`
  const json = await fetchJson(url)
  const result = json?.chart?.result?.[0]
  if (!result) throw new Error('no_data')

  const { meta } = result
  const price = meta.regularMarketPrice
  const previousClose = meta.chartPreviousClose ?? meta.previousClose
  const changePercent =
    typeof price === 'number' && typeof previousClose === 'number' && previousClose !== 0
      ? ((price - previousClose) / previousClose) * 100
      : null

  const rawCloses = (result.indicators?.quote?.[0]?.close || []).filter((v) => typeof v === 'number')

  return {
    symbol: stock.symbol,
    name: stock.name,
    currency: meta.currency || null,
    price: typeof price === 'number' ? price : null,
    changePercent,
    series: downsample(rawCloses, SPARKLINE_POINTS),
  }
}

// Yahoo's unofficial endpoint occasionally hiccups for a single symbol - on
// failure we fall back to that symbol's last successful quote rather than
// blanking it out, so a transient error doesn't flash "-" across the widget.
const lastGoodBySymbol = new Map()

async function fetchQuoteWithFallback(stock) {
  try {
    const quote = await fetchQuote(stock)
    lastGoodBySymbol.set(stock.symbol, quote)
    return quote
  } catch {
    return (
      lastGoodBySymbol.get(stock.symbol) || {
        symbol: stock.symbol,
        name: stock.name,
        currency: null,
        price: null,
        changePercent: null,
        series: [],
      }
    )
  }
}

const QUOTES_CACHE_MS = 60_000
let quotesCache = null
let quotesCacheAt = 0

export async function getStockQuotes() {
  const now = Date.now()
  if (quotesCache && now - quotesCacheAt < QUOTES_CACHE_MS) {
    return quotesCache
  }

  const quotes = await Promise.all(STOCKS.map(fetchQuoteWithFallback))
  quotesCache = quotes
  quotesCacheAt = Date.now()
  return quotes
}
