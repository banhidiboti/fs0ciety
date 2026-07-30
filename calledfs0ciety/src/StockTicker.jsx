import { useEffect, useState } from 'react'
import './StockTicker.css'

const POLL_MS = 60000

// Render order, split 7/7 across the two columns.
const SYMBOL_ORDER = [
  'LMT',
  'NOC',
  'RHM',
  'RTX',
  'PLTR',
  'SPCX',
  'RKLB',
  'AAPL',
  'TSLA',
  'NVDA',
  'META',
  'AMZN',
  'MSFT',
  'GOOGL',
]

// Domain used to fetch each company's icon via Google's favicon service -
// no API key, no backend proxy needed, just a plain <img> request.
const LOGO_DOMAINS = {
  LMT: 'lockheedmartin.com',
  NOC: 'northropgrumman.com',
  RHM: 'rheinmetall.com',
  RTX: 'rtx.com',
  PLTR: 'palantir.com',
  SPCX: 'spacex.com',
  RKLB: 'rocketlabusa.com',
  AAPL: 'apple.com',
  TSLA: 'tesla.com',
  NVDA: 'nvidia.com',
  META: 'meta.com',
  AMZN: 'amazon.com',
  MSFT: 'microsoft.com',
  GOOGL: 'google.com',
}

function logoUrl(symbol) {
  const domain = LOGO_DOMAINS[symbol]
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : null
}

const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£' }

function formatPrice(price, currency) {
  if (typeof price !== 'number') return '—'
  const symbol = CURRENCY_SYMBOLS[currency] || currency || ''
  const number = price.toLocaleString('hu-HU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return symbol ? `${number} ${symbol}` : number
}

function formatChange(changePercent) {
  if (typeof changePercent !== 'number') return '—'
  const sign = changePercent > 0 ? '+' : ''
  return `${sign}${changePercent.toFixed(2)}%`
}

function Sparkline({ series, up }) {
  if (!series || series.length < 2) {
    return (
      <span className={`stock-arrow ${up ? 'stock-arrow--up' : 'stock-arrow--down'}`}>
        {up ? '▲' : '▼'}
      </span>
    )
  }

  const width = 60
  const height = 22
  const min = Math.min(...series)
  const max = Math.max(...series)
  const range = max - min || 1
  const points = series
    .map((value, i) => {
      const x = (i / (series.length - 1)) * width
      const y = height - ((value - min) / range) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg className="stock-sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} className={up ? 'stock-sparkline-line--up' : 'stock-sparkline-line--down'} />
    </svg>
  )
}

function StockRow({ quote }) {
  const changePercent = quote.changePercent
  const up = typeof changePercent === 'number' ? changePercent >= 0 : true

  const logo = logoUrl(quote.symbol)

  return (
    <div className="stock-row">
      {logo && <img className="stock-logo" src={logo} alt="" />}
      <span className="stock-symbol">{quote.symbol}</span>
      <Sparkline series={quote.series} up={up} />
      <span className="stock-price">{formatPrice(quote.price, quote.currency)}</span>
      <span className={`stock-change ${up ? 'stock-change--up' : 'stock-change--down'}`}>
        {formatChange(changePercent)}
      </span>
    </div>
  )
}

function StockTicker({ ready }) {
  const [quotes, setQuotes] = useState(null)

  useEffect(() => {
    if (!ready) return
    let cancelled = false

    async function load() {
      try {
        const res = await fetch('/api/stocks')
        if (!res.ok) throw new Error('bad_status')
        const data = await res.json()
        if (!cancelled) setQuotes(data)
      } catch {
        // keep showing the last known quotes on a transient failure
      }
    }

    load()
    const id = setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [ready])

  const bySymbol = new Map((quotes || []).map((q) => [q.symbol, q]))
  const ordered = SYMBOL_ORDER.map((symbol) => bySymbol.get(symbol) || { symbol, series: [] })
  const columns = [ordered.slice(0, 7), ordered.slice(7)]

  return (
    <section className="stock-ticker">
      <div className="stock-ticker-header">
        <span className="stock-title">{'> WATCHLIST'}</span>
      </div>
      <div className="stock-ticker-columns">
        {columns.map((col, i) => (
          <div className="stock-column" key={i}>
            {col.map((quote) => (
              <StockRow key={quote.symbol} quote={quote} />
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

export default StockTicker
