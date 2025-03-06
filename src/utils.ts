/* eslint-disable no-sequences */
/* eslint-disable ts/no-unused-expressions */
import type { ObjectProperty } from '@babel/types'
import { useLogger } from 'reactive-vscode'
import { Range, type TextDocument } from 'vscode'
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
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  // Convert HSL to range [0, 1]
  s /= 100
  l /= 100

  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = l - c / 2

  let r = 0; let g = 0; let b = 0

  if (h >= 0 && h < 60) {
    r = c, g = x, b = 0
  }
  else if (h >= 60 && h < 120) {
    r = x, g = c, b = 0
  }
  else if (h >= 120 && h < 180) {
    r = 0, g = c, b = x
  }
  else if (h >= 180 && h < 240) {
    r = 0, g = x, b = c
  }
  else if (h >= 240 && h < 300) {
    r = x, g = 0, b = c
  }
  else if (h >= 300 && h < 360) {
    r = c, g = 0, b = x
  }

  // Convert to 0-255 range
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ]
}
