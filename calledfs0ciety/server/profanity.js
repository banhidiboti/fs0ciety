import { EN_BADWORDS, HU_BADWORDS } from './badwords.js'

// 'reject' rejects the whole post; 'censor' stores the text with matches
// replaced by asterisks instead of rejecting it.
export const PROFANITY_MODE = 'reject'

const LEET_MAP = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', '@': 'a', $: 's', 5: 's' }

function stripDiacritics(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function normalizeForMatch(text) {
  return stripDiacritics(text.toLowerCase()).replace(/[01345@$]/g, (ch) => LEET_MAP[ch])
}

function escapeRegex(char) {
  return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Letters may have whitespace/dots/dashes between them (catches "f.u.c.k",
// "b a s z") but the whole span must be flanked by non-letters, so this
// won't flag e.g. "ass" inside "class".
function buildWordPattern(word) {
  const letters = word.split('').map(escapeRegex)
  return `(?<![a-z])${letters.join('[\\s.-]*')}(?![a-z])`
}

const BADWORD_PATTERNS = [...HU_BADWORDS, ...EN_BADWORDS].map(
  (word) => new RegExp(buildWordPattern(word), 'g'),
)

function findMatchSpans(normalized) {
  const spans = []
  for (const regex of BADWORD_PATTERNS) {
    regex.lastIndex = 0
    let match
    while ((match = regex.exec(normalized))) {
      spans.push([match.index, match.index + match[0].length])
      if (match[0].length === 0) regex.lastIndex += 1
    }
  }
  return spans
}

export function checkProfanity(text) {
  const normalized = normalizeForMatch(text)
  const spans = findMatchSpans(normalized)

  if (spans.length === 0) {
    return { flagged: false, censored: text }
  }

  if (PROFANITY_MODE !== 'censor') {
    return { flagged: true, censored: text }
  }

  const chars = [...text]
  for (const [start, end] of spans) {
    for (let i = start; i < end && i < chars.length; i++) {
      chars[i] = '*'
    }
  }
  return { flagged: true, censored: chars.join('') }
}
