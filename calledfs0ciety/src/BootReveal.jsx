import { useEffect, useState } from 'react'
import { prefersReducedMotion } from './motion.js'
import './BootReveal.css'

// Single source of truth for the terminal-style row-by-row reveal used by
// every panel (leave a trace, live feed, system status, your informations).
export const REVEAL_MS_MIN = 90
export const REVEAL_MS_MAX = 170

function BootReveal({ count, active = true, onDone, children }) {
  const [instant] = useState(prefersReducedMotion)
  const [revealCount, setRevealCount] = useState(0)

  useEffect(() => {
    if (!active || instant) return
    if (revealCount >= count) return
    const delay = REVEAL_MS_MIN + Math.random() * (REVEAL_MS_MAX - REVEAL_MS_MIN)
    const timer = setTimeout(() => setRevealCount((c) => c + 1), delay)
    return () => clearTimeout(timer)
  }, [active, instant, count, revealCount])

  const introDone = instant || revealCount >= count

  useEffect(() => {
    if (introDone) onDone?.()
  }, [introDone, onDone])

  return children({ revealCount: introDone ? count : revealCount, introDone })
}

export function BootCursor({ className = '' }) {
  return <span className={`boot-cursor${className ? ` ${className}` : ''}`} />
}

export default BootReveal
