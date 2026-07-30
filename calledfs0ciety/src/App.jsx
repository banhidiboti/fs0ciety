import { useCallback, useEffect, useState } from 'react'
import reactLogo from './assets/react.svg'
import nodejsLogo from './assets/nodejs-stacked-light.svg'
import raspberryPiLogo from './assets/raspberrypilogo.png'
import cfLogo from './assets/cloudflare-color.svg'
import claudeLogo from './assets/claude-color.svg'
import BootIntro from './BootIntro.jsx'
import VisitorTrace from './VisitorTrace.jsx'
import Guestbook from './Guestbook.jsx'
import StatusPage from './StatusPage.jsx'
import HeaderGreeting from './HeaderGreeting.jsx'
import WebcamPanel from './WebcamPanel.jsx'
import StockTicker from './StockTicker.jsx'
import LiveFeed from './LiveFeed.jsx'
import { captureOwnerFlagFromUrl } from './owner.js'
import './App.css'

const FOOTER_CREDITS = [
  {
    label: 'Built with',
    href: 'https://react.dev',
    src: reactLogo,
    alt: 'React logo',
    logoClass: 'logo-react',
  },
  {
    label: 'Runs on',
    href: 'https://nodejs.org',
    src: nodejsLogo,
    alt: 'Node.js logo',
    logoClass: 'logo-nodejs',
  },
  {
    label: 'Hosted on',
    href: 'https://www.raspberrypi.com',
    src: raspberryPiLogo,
    alt: 'Raspberry Pi logo',
    logoClass: 'logo-pi',
  },
  {
    label: 'Powered by',
    href: 'https://www.cloudflare.com',
    src: cfLogo,
    alt: 'Cloudflare logo',
    logoClass: 'logo-cf',
  },
  {
    label: 'Made with',
    href: 'https://claude.com',
    src: claudeLogo,
    alt: 'Claude logo',
    logoClass: 'logo-claude',
  },
]

const PANEL_TABS_ROW1 = [
  { key: 'trace', label: 'Leave a trace' },
  { key: 'status', label: 'System status' },
  { key: 'info', label: 'Your info' },
]
const PANEL_TABS_ROW2 = [
  { key: 'log', label: 'Log' },
  { key: 'cams', label: 'Cams' },
  { key: 'watchlist', label: 'Watchlist' },
]
const MOBILE_BREAKPOINT = 1000

function useIsMobile(breakpoint = MOBILE_BREAKPOINT) {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= breakpoint,
  )

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`)
    const onChange = () => setIsMobile(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [breakpoint])

  return isMobile
}

function App() {
  const [bootReady, setBootReady] = useState(false)
  const handleBootComplete = useCallback(() => setBootReady(true), [])
  const [openPanel, setOpenPanel] = useState('status')
  const isMobile = useIsMobile()
  const camsStreaming = !isMobile || openPanel === 'cams'

  useEffect(() => {
    captureOwnerFlagFromUrl()
  }, [])

  return (
    <>
      <header id="site-header">
        <HeaderGreeting ready={bootReady} />
      </header>

      <BootIntro onComplete={handleBootComplete}>
        <main id="blank-page">
          <div className="panel-tabs-group">
            <div className="panel-tabs">
              {PANEL_TABS_ROW1.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  className={`panel-tab${openPanel === key ? ' active' : ''}`}
                  onClick={() => setOpenPanel(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="panel-tabs">
              {PANEL_TABS_ROW2.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  className={`panel-tab${openPanel === key ? ' active' : ''}`}
                  onClick={() => setOpenPanel(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div id="panel-row">
            <div className="panel-col">
              <div className={`panel-item${openPanel === 'trace' ? ' panel-item--active' : ''}`}>
                <Guestbook ready={bootReady} />
              </div>
              <div className={`panel-item${openPanel === 'log' ? ' panel-item--active' : ''}`}>
                <LiveFeed ready={bootReady} />
              </div>
            </div>
            <div className="panel-col panel-col--center">
              <div className={`panel-item${openPanel === 'cams' ? ' panel-item--active' : ''}`}>
                <WebcamPanel ready={bootReady} streaming={camsStreaming} />
              </div>
              <div className={`panel-item${openPanel === 'watchlist' ? ' panel-item--active' : ''}`}>
                <StockTicker ready={bootReady} />
              </div>
            </div>
            <div className="panel-col panel-col--right">
              <div className={`panel-item${openPanel === 'status' ? ' panel-item--active' : ''}`}>
                <StatusPage ready={bootReady} />
              </div>
              <div className={`panel-item${openPanel === 'info' ? ' panel-item--active' : ''}`}>
                <VisitorTrace ready={bootReady} />
              </div>
            </div>
          </div>
        </main>
      </BootIntro>

      <footer id="site-footer">
        {FOOTER_CREDITS.map(({ label, href, src, alt, logoClass }) => (
          <div className="footer-item" key={label}>
            <div className="footer-label-row">
              <span className="footer-label">{label}</span>
            </div>
            <div className="footer-logo-row">
              <a
                className="footer-logo-link"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
              >
                <img
                  className={`footer-logo${logoClass ? ` ${logoClass}` : ''}`}
                  src={src}
                  alt={alt}
                />
              </a>
            </div>
          </div>
        ))}
      </footer>
    </>
  )
}

export default App
