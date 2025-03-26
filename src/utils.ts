import type { ObjectProperty } from '@babel/types'
import type { TextDocument } from 'vscode'
import { useLogger } from 'reactive-vscode'
import { l10n, Range } from 'vscode'
import { displayName } from './generated/meta'

export const logger = useLogger(displayName)

export function getNodeRange(doc: TextDocument, node: ObjectProperty, offset: number) {
  const start = node.value.start! + offset + 1
  const end = node.value.end! + offset - 1
  return new Range(doc.positionAt(start), doc.positionAt(end))
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

const minute = 60
const hour = minute * 60
const day = hour * 24
const week = day * 7
const month = day * 30
const year = day * 365

/**
 * Create a localized of the time between now and the specified date.
 * @param date The date to generate the difference from.
 * @param appendAgoLabel Whether to append the " ago" to the end.
 * @param useFullTimeWords Whether to use full words (eg. seconds) instead of
 * shortened (eg. secs).
 * @param disallowNow Whether to disallow the string "now" when the difference
 * is less than 30 seconds.
 */
export function fromNow(date: number | Date, appendAgoLabel?: boolean, useFullTimeWords?: boolean, disallowNow?: boolean): string {
  if (typeof date !== 'number') {
    date = date.getTime()
  }

  const seconds = Math.round((new Date().getTime() - date) / 1000)
  if (seconds < -30) {
    return l10n.t('in {0}', fromNow(new Date().getTime() + seconds * 1000, false))
  }

  if (!disallowNow && seconds < 30) {
    return l10n.t('now')
  }

  let value: number
  if (seconds < minute) {
    value = seconds

    if (appendAgoLabel) {
      if (value === 1) {
        return useFullTimeWords
          ? l10n.t('{0} second ago', value)
          : l10n.t('{0} sec ago', value)
      }
      else {
        return useFullTimeWords
          ? l10n.t('{0} seconds ago', value)
          : l10n.t('{0} secs ago', value)
      }
    }
    else {
      if (value === 1) {
        return useFullTimeWords
          ? l10n.t('{0} second', value)
          : l10n.t('{0} sec', value)
      }
      else {
        return useFullTimeWords
          ? l10n.t('{0} seconds', value)
          : l10n.t('{0} secs', value)
      }
    }
  }

  if (seconds < hour) {
    value = Math.floor(seconds / minute)
    if (appendAgoLabel) {
      if (value === 1) {
        return useFullTimeWords
          ? l10n.t('{0} minute ago', value)
          : l10n.t('{0} min ago', value)
      }
      else {
        return useFullTimeWords
          ? l10n.t('{0} minutes ago', value)
          : l10n.t('{0} mins ago', value)
      }
    }
    else {
      if (value === 1) {
        return useFullTimeWords
          ? l10n.t('{0} minute', value)
          : l10n.t('{0} min', value)
      }
      else {
        return useFullTimeWords
          ? l10n.t('{0} minutes', value)
          : l10n.t('{0} mins', value)
      }
    }
  }

  if (seconds < day) {
    value = Math.floor(seconds / hour)
    if (appendAgoLabel) {
      if (value === 1) {
        return useFullTimeWords
          ? l10n.t('{0} hour ago', value)
          : l10n.t('{0} hr ago', value)
      }
      else {
        return useFullTimeWords
          ? l10n.t('{0} hours ago', value)
          : l10n.t('{0} hrs ago', value)
      }
    }
    else {
      if (value === 1) {
        return useFullTimeWords
          ? l10n.t('{0} hour', value)
          : l10n.t('{0} hr', value)
      }
      else {
        return useFullTimeWords
          ? l10n.t('{0} hours', value)
          : l10n.t('{0} hrs', value)
      }
    }
  }

  if (seconds < week) {
    value = Math.floor(seconds / day)
    if (appendAgoLabel) {
      return value === 1
        ? l10n.t('{0} day ago', value)
        : l10n.t('{0} days ago', value)
    }
    else {
      return value === 1
        ? l10n.t('{0} day', value)
        : l10n.t('{0} days', value)
    }
  }

  if (seconds < month) {
    value = Math.floor(seconds / week)
    if (appendAgoLabel) {
      if (value === 1) {
        return useFullTimeWords
          ? l10n.t('{0} week ago', value)
          : l10n.t('{0} wk ago', value)
      }
      else {
        return useFullTimeWords
          ? l10n.t('{0} weeks ago', value)
          : l10n.t('{0} wks ago', value)
      }
    }
    else {
      if (value === 1) {
        return useFullTimeWords
          ? l10n.t('{0} week', value)
          : l10n.t('{0} wk', value)
      }
      else {
        return useFullTimeWords
          ? l10n.t('{0} weeks', value)
          : l10n.t('{0} wks', value)
      }
    }
  }

  if (seconds < year) {
    value = Math.floor(seconds / month)
    if (appendAgoLabel) {
      if (value === 1) {
        return useFullTimeWords
          ? l10n.t('{0} month ago', value)
          : l10n.t('{0} mo ago', value)
      }
      else {
        return useFullTimeWords
          ? l10n.t('{0} months ago', value)
          : l10n.t('{0} mos ago', value)
      }
    }
    else {
      if (value === 1) {
        return useFullTimeWords
          ? l10n.t('{0} month', value)
          : l10n.t('{0} mo', value)
      }
      else {
        return useFullTimeWords
          ? l10n.t('{0} months', value)
          : l10n.t('{0} mos', value)
      }
    }
  }

  value = Math.floor(seconds / year)
  if (appendAgoLabel) {
    if (value === 1) {
      return useFullTimeWords
        ? l10n.t('{0} year ago', value)
        : l10n.t('{0} yr ago', value)
    }
    else {
      return useFullTimeWords
        ? l10n.t('{0} years ago', value)
        : l10n.t('{0} yrs ago', value)
    }
  }
  else {
    if (value === 1) {
      return useFullTimeWords
        ? l10n.t('{0} year', value)
        : l10n.t('{0} yr', value)
    }
    else {
      return useFullTimeWords
        ? l10n.t('{0} years', value)
        : l10n.t('{0} yrs', value)
    }
  }
}
