import type { ObjectProperty, StringLiteral } from '@babel/types'
import type { DecorationOptions, Selection } from 'vscode'
import type { JumpLocationParams } from './data'

import { parseSync } from '@babel/core'
import traverse from '@babel/traverse'
import { computed, defineExtension, executeCommand, shallowRef, toValue as track, useActiveTextEditor, useCommand, useDisposable, useDocumentText, useEditorDecorations, watchEffect } from 'reactive-vscode'
import { ConfigurationTarget, MarkdownString, Position, Range, Uri, window, workspace } from 'vscode'
// @ts-expect-error missing types
import preset from '@babel/preset-typescript'
import { config } from './config'
import { catalogPrefix } from './constants'
import { PnpmWorkspaceManager } from './data'
import { commands } from './generated/meta'
import { logger } from './utils'

const { activate, deactivate } = defineExtension(() => {
  const manager = new PnpmWorkspaceManager()

  const editor = useActiveTextEditor()
  const tick = shallowRef(0)

  useDisposable(workspace.onDidChangeTextDocument(() => {
    tick.value++
  }))
  useDisposable(workspace.onDidOpenTextDocument(() => {
    tick.value++
  }))

  const doc = computed(() => {
    track(tick)
    if (!editor.value || !editor.value.document)
      return
    if (!editor.value.document.fileName.match(/[\\/]package\.json$/))
      return
    return editor.value.document
  })

  const text = useDocumentText(() => doc.value)

  // const workspaceData = computed(() => {
  //   if (!doc.value)
  //     return
  //   return readCatalog(doc.value.uri.fsPath)
  // })

  const parsed = computed(() => {
    if (!text.value)
      return

    const prefix = 'const x = '
    const offset = -prefix.length
    const combined = prefix + text.value

    try {
      return {
        offset,
        ast: parseSync(
          combined,
          {
            filename: doc.value?.uri.fsPath,
            presets: [preset],
            babelrc: false,
          },
        ),
      }
    }
    catch (error) {
      logger.error(error)
    }
  })

  const properties = computed(() => {
    if (!parsed.value?.ast)
      return []

    const items: {
      node: ObjectProperty
      catalog: string
    }[] = []

    const { ast } = parsed.value

    traverse(ast, {
      ObjectProperty(path) {
        const key = path.node.key
        const value = path.node.value

        if (key.type !== 'StringLiteral' || value.type !== 'StringLiteral') {
          return
        }

        if (!value.value.startsWith(catalogPrefix))
          return

        items.push({
          node: path.node,
          catalog: value.value.slice(catalogPrefix.length).trim() || 'default',
        })
      },
    })

    return items
  })

  const decorationsOverride = shallowRef<DecorationOptions[]>([])
  const decorationsHover = shallowRef<DecorationOptions[]>([])

  const selections = shallowRef<readonly Selection[]>([])

  useDisposable(window.onDidChangeTextEditorSelection((e) => {
    if (e.textEditor !== editor.value)
      selections.value = []
    else
      selections.value = e.selections
  }))

  watchEffect(async () => {
    if (!config.enabled || !editor.value || !doc.value || editor.value?.document !== doc.value) {
      decorationsOverride.value = []
      decorationsHover.value = []
      return
    }

    const offset = parsed.value?.offset || 0
    const props = properties.value
    const _selections = selections.value

    const overrides: DecorationOptions[] = []
    const hovers: DecorationOptions[] = []

    await Promise.all(props.map(async ({ node, catalog }) => {
      const { version, versionPositionCommandUri } = await manager.resolveCatalog(
        doc.value!,
        (node.key as StringLiteral).value,
        catalog,
      ) || {}
      if (!version)
        return

      const md = new MarkdownString()
      md.appendMarkdown([
        `- PNPM Catalog: \`${catalog}\``,
        versionPositionCommandUri ? `- Version: [${version}](${versionPositionCommandUri})` : `- Version: \`${version}\``,
      ].join('\n'))
      md.isTrusted = true

      const range = new Range(
        doc.value!.positionAt(node.value.start! + offset + 1),
        doc.value!.positionAt(node.value.end! + offset - 1),
      )
      let inSelection = false
      for (const selection of _selections) {
        if (selection.contains(range)) {
          inSelection = true
          break
        }
        const lines = [selection.start.line, selection.end.line]
        if (lines.includes(range.start.line) || lines.includes(range.end.line)) {
          inSelection = true
          break
        }
      }

      hovers.push({
        range: new Range(
          doc.value!.positionAt(node.start! + offset),
          doc.value!.positionAt(node.end! + offset),
        ),
        hoverMessage: md,
      })
      if (!inSelection) {
        overrides.push({
          range,
          hoverMessage: md,
          renderOptions: {
            after: {
              contentText: version,
            },
          },
        })
      }
    }),
    )

    decorationsOverride.value = overrides
    decorationsHover.value = hovers
  })

  useEditorDecorations(
    editor,
    {
      opacity: '0; display: none;',
      after: {
        color: '#f69220',
        backgroundColor: '#f6922020; border-radius: 0.2em; padding: 0 0.2em;',
      },
    },
    decorationsOverride,
  )

  useEditorDecorations(
    editor,
    {},
    decorationsHover,
  )

  useCommand(
    commands.toggle,
    () => config.$update('enabled', !config.enabled, ConfigurationTarget.Global),
  )

  useCommand(
    commands.gotoDefinition,
    ({ workspacePath, versionPosition }: JumpLocationParams) => {
      executeCommand(
        'editor.action.goToLocations',
        Uri.file(workspacePath),
        new Position(versionPosition.line - 1, versionPosition.column - 1),
        [],
        'goto',
      )
    },
  )
})

export { activate, deactivate }
