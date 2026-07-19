import { useCallback, useState } from 'react'
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
import LiveFeed from './LiveFeed.jsx'
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

function App() {
  const [bootReady, setBootReady] = useState(false)
  const handleBootComplete = useCallback(() => setBootReady(true), [])

  return (
    <>
      <header id="site-header">
        <HeaderGreeting ready={bootReady} />
      </header>

      <BootIntro onComplete={handleBootComplete}>
        <main id="blank-page">
          <div id="panel-row">
            <div className="panel-col">
              <Guestbook ready={bootReady} />
              <LiveFeed ready={bootReady} />
            </div>
            <div className="panel-col panel-col--center">
              <WebcamPanel ready={bootReady} />
            </div>
            <div className="panel-col">
              <StatusPage ready={bootReady} />
              <VisitorTrace ready={bootReady} />
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
