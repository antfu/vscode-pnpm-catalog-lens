import type { ObjectProperty } from '@babel/types'
import type { TextDocument } from 'vscode'
import { useLogger } from 'reactive-vscode'
import { env, Range } from 'vscode'
import { displayName } from './generated/meta'

export const logger = useLogger(displayName)

export function getNodeRange(doc: TextDocument, node: ObjectProperty, offset: number) {
  const start = node.value.start! + offset + 1
  const end = node.value.end! + offset - 1
  return new Range(doc.positionAt(start), doc.positionAt(end))
}

const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR

// Same threshold as VS Code's own relative dates
const NOW_THRESHOLD_SECONDS = 30

// Largest first, so the first unit that fits is the coarsest one (e.g. 400 days -> "1 year ago")
const TIME_UNITS: { unit: Intl.RelativeTimeFormatUnit, seconds: number }[] = [
  { unit: 'year', seconds: 365 * SECONDS_PER_DAY },
  { unit: 'month', seconds: 30 * SECONDS_PER_DAY },
  { unit: 'week', seconds: 7 * SECONDS_PER_DAY },
  { unit: 'day', seconds: SECONDS_PER_DAY },
  { unit: 'hour', seconds: SECONDS_PER_HOUR },
  { unit: 'minute', seconds: SECONDS_PER_MINUTE },
]

/** Formats a date relative to now in VS Code's display language, e.g. "3 hours ago" or "in 2 days". */
export function fromNow(date: number | Date, now = Date.now()): string {
  // env.language is VS Code's display language; the default Intl locale follows the OS instead
  const formatter = new Intl.RelativeTimeFormat(env.language, { numeric: 'auto' })
  const secondsFromNow = Math.round((new Date(date).getTime() - now) / 1000)

  if (Math.abs(secondsFromNow) < NOW_THRESHOLD_SECONDS)
    return formatter.format(0, 'second')

  for (const { unit, seconds } of TIME_UNITS) {
    if (Math.abs(secondsFromNow) >= seconds)
      return formatter.format(Math.trunc(secondsFromNow / seconds), unit)
  }
  return formatter.format(secondsFromNow, 'second')
}

const catalogColors = new Map<string, string>()
catalogColors.set('default', '#f69220')

export function getCatalogColor(name: string) {
  if (catalogColors.has(name)) {
    return catalogColors.get(name)
  }
  let hash = 0
  for (let i = 0; i < name.length; i++)
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  const hue = hash % 360
  const saturation = 35
  const lightness = 55
  const result = hslToHex(hue, saturation, lightness)
  catalogColors.set(name, result)
  return result
}

function hslToHex(h: number, s: number, l: number) {
  const [r, g, b] = hslToRgb(h, s, l)
  return `#${r.toString(16).padStart(2, '0').slice(0, 2)}${g.toString(16).padStart(2, '0').slice(0, 2)}${b.toString(16).padStart(2, '0').slice(0, 2)}`
}

function hslToRgb(h: number, s: number, l: number) {
  h = h % 360
  h /= 360
  s /= 100
  l /= 100
  let r, g, b

  if (s === 0) {
    r = g = b = l // achromatic
  }
  else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0)
        t += 1
      if (t > 1)
        t -= 1
      if (t < 1 / 6)
        return p + (q - p) * 6 * t
      if (t < 1 / 2)
        return q
      if (t < 2 / 3)
        return p + (q - p) * (2 / 3 - t) * 6
      return p
    }

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }

  return [
    Math.max(0, Math.round(r * 255)),
    Math.max(0, Math.round(g * 255)),
    Math.max(0, Math.round(b * 255)),
  ]
}
