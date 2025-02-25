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
