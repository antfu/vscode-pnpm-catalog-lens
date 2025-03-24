import type { ObjectProperty } from '@babel/types'
import type { TextDocument } from 'vscode'
import { useLogger } from 'reactive-vscode'
import { Range } from 'vscode'
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
