import { useEffect, useState } from 'react'
import { prefersReducedMotion } from './motion.js'
import './BootIntro.css'

const BOOT_LINES = [
  { status: 'OK', text: 'Mounting /dev/fs0ciety' },
  { status: 'OK', text: 'Starting fs0ciety daemon...' },
  { status: 'OK', text: 'Establishing secure connection' },
  { status: 'WARN', text: 'Intrusion countermeasures active' },
  { status: 'OK', text: 'Welcome, friend.' },
]

const EXIT_MS = 400

function BootIntro({ children, onComplete }) {
  const [phase, setPhase] = useState(() =>
    prefersReducedMotion() ? 'done' : 'booting',
  )
  const [visibleCount, setVisibleCount] = useState(0)

  useEffect(() => {
    if (phase === 'done') onComplete?.()
  }, [phase, onComplete])

  useEffect(() => {
    if (phase !== 'booting') return
    if (visibleCount >= BOOT_LINES.length) {
      const timer = setTimeout(() => setPhase('exiting'), 500)
      return () => clearTimeout(timer)
    }
    const delay = 400 + Math.random() * 600
    const timer = setTimeout(() => setVisibleCount((c) => c + 1), delay)
    return () => clearTimeout(timer)
  }, [phase, visibleCount])

  useEffect(() => {
    if (phase !== 'exiting') return
    const timer = setTimeout(() => setPhase('done'), EXIT_MS)
    return () => clearTimeout(timer)
  }, [phase])

  useEffect(() => {
    if (phase !== 'booting') return
    const skip = () => setPhase('exiting')
    window.addEventListener('keydown', skip)
    window.addEventListener('pointerdown', skip)
    return () => {
      window.removeEventListener('keydown', skip)
      window.removeEventListener('pointerdown', skip)
    }
  }, [phase])

  const revealed = BOOT_LINES.slice(0, visibleCount)

  return (
    <div className="boot-root">
      {phase !== 'done' && (
        <div
          className={`boot-overlay${phase === 'exiting' ? ' boot-overlay--exiting' : ''}`}
          aria-hidden="true"
        >
          <div className="boot-log">
            {revealed.map((line, i) => (
              <div className="boot-line" key={line.text}>
                <span className={`boot-tag boot-tag--${line.status.toLowerCase()}`}>
                  {line.status}
                </span>
                <span>{line.text}</span>
                {phase === 'booting' && i === revealed.length - 1 && (
                  <span className="boot-cursor" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className={`boot-content${phase !== 'booting' ? ' boot-content--ready' : ''}`}>
        {children}
      </div>
    </div>
  )
}

export default BootIntro
