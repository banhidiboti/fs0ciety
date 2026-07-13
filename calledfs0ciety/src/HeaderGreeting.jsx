import { useEffect, useState } from 'react'
import { prefersReducedMotion } from './motion.js'
import './HeaderGreeting.css'

const GREETING = 'hello, friend'
const CHAR_MS_MIN = 60
const CHAR_MS_MAX = 90
const STORAGE_KEY = 'fs0ciety:greeting-seen'

function hasSeenGreeting() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function markGreetingSeen() {
  try {
    sessionStorage.setItem(STORAGE_KEY, '1')
  } catch {
    // ignore (e.g. storage disabled)
  }
}

function HeaderGreeting({ ready }) {
  const [instant] = useState(() => prefersReducedMotion() || hasSeenGreeting())
  const [charCount, setCharCount] = useState(instant ? GREETING.length : 0)

  useEffect(() => {
    if (instant || !ready) return
    if (charCount >= GREETING.length) {
      markGreetingSeen()
      return
    }
    const delay = CHAR_MS_MIN + Math.random() * (CHAR_MS_MAX - CHAR_MS_MIN)
    const timer = setTimeout(() => setCharCount((c) => c + 1), delay)
    return () => clearTimeout(timer)
  }, [instant, ready, charCount])

  return (
    <span className="hg-line">
      <span className="hg-prompt">{'>'}</span> <span>{GREETING.slice(0, charCount)}</span>
      <span className="hg-cursor" />
    </span>
  )
}

export default HeaderGreeting
