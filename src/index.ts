import type { ObjectProperty, StringLiteral } from '@babel/types'
import type { DecorationOptions, Selection } from 'vscode'
import type { JumpLocationParams } from './data'

import { parseSync } from '@babel/core'
// @ts-expect-error missing types
import preset from '@babel/preset-typescript'
import traverse from '@babel/traverse'
import { $fetch } from 'ofetch'
import { computed, defineExtension, executeCommand, shallowRef, toValue as track, useActiveTextEditor, useCommand, useDisposable, useDocumentText, useEditorDecorations, watchEffect } from 'reactive-vscode'
import { ConfigurationTarget, languages, MarkdownString, Position, Range, Uri, window, workspace } from 'vscode'
import { config } from './config'
import { catalogPrefix } from './constants'
import { PnpmWorkspaceManager } from './data'
import { commands } from './generated/meta'
import { getNPMCommandPath } from './npm'
import { fromNow, getCatalogColor, getNodeRange, logger } from './utils'

const { activate, deactivate } = defineExtension(async () => {
  const npmCommandPath = await getNPMCommandPath()
  const fetch = $fetch.create({
    agent: 'PNPM Catalog Lens',
  })
  const manager = new PnpmWorkspaceManager(fetch, npmCommandPath)

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
    const doc = editor.value.document
    if (!doc)
      return
    return doc
  })

  const yamlDoc = computed(() => {
    track(tick)
    if (!editor.value || !editor.value.document)
      return
    if (!editor.value.document.fileName.match(/[\\/]pnpm-workspace\.yaml$/))
      return
    const yamlDoc = editor.value.document
    if (!yamlDoc)
      return
    return yamlDoc
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

  const parsedWorkspace = computed(async () => {
    if (!yamlDoc.value)
      return

    const prefix = 'const x = '
    const offset = -prefix.length
    const combined = prefix + JSON.stringify(await manager.readPnpmWorkspace(yamlDoc.value!))

    try {
      return {
        offset,
        ast: parseSync(
          combined,
          {
            filename: yamlDoc.value?.uri.fsPath,
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

  const yamlProperties = computed(async () => {
    const pw = await parsedWorkspace.value

    if (!pw?.ast)
      return []

    const items: {
      node: ObjectProperty
      pkg: string
    }[] = []

    const { ast } = pw

    traverse(ast, {
      ObjectProperty(path) {
        // Check if the current property is inside a "catalog" object.
        // path.findParent walks up the traversal chain.
        const catalogParent = path.findParent((p) => {
          // We are looking for an ObjectProperty with a StringLiteral key equal to "catalog".
          if (p.isObjectProperty()) {
            const key = p.node.key
            // Ensure the key is a StringLiteral and its value equals "catalog".
            return key.type === 'StringLiteral' && key.value === 'catalog'
          }
          return false
        })

        // Only continue if the property is a descendant of "catalog"
        if (!catalogParent) {
          return // Not inside a "catalog" property, skip.
        }

        const key = path.node.key
        const value = path.node.value

        if (key.type !== 'StringLiteral' || value.type !== 'StringLiteral') {
          return
        }

        items.push({
          node: path.node,
          pkg: key.value,
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
    if (!config.enabled || !editor.value || !yamlDoc.value || editor.value?.document !== yamlDoc.value) {
      decorationsOverride.value = []
      decorationsHover.value = []
      return
    }

    const offset = (await parsedWorkspace.value)?.offset || 0
    const props = await yamlProperties.value
    const _selections = selections.value

    const overrides: DecorationOptions[] = []
    const hovers: DecorationOptions[] = []
    const position = manager.readPnpmWorkspacePosition(yamlDoc.value!)

    await Promise.all(props.map(async ({ node, pkg }) => {
      const range = new Range(
        yamlDoc.value!.positionAt(node.start! - 8),
        yamlDoc.value!.positionAt(node.end! - 8),
      )

      const info = await manager.fetchPackageInfo(pkg, yamlDoc.value?.uri)

      const str = new MarkdownString()
      if (info?.description) {
        str.appendText(info.description)
      }
      if (info?.version) {
        str.appendText('\n\n')
        str.appendText(info?.time ? `Latest version: ${info.version} published ${fromNow(Date.parse(info.time), true, true)}` : `Latest version: ${info.version}`)
      }
      if (info?.homepage) {
        str.appendText('\n\n')
        str.appendText(info.homepage)
      }

      hovers.push({
        range,
        hoverMessage: str,
      })
    }))

    decorationsOverride.value = overrides
    decorationsHover.value = hovers
  })

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
      catalog = catalog || 'default'
      const { version, definition } = await manager.resolveCatalog(
        doc.value!,
        (node.key as StringLiteral).value,
        catalog,
      ) || {}
      if (!version)
        return

      let versionPositionCommandUri
      if (definition) {
        const args = [
          {
            workspacePath: definition.uri.fsPath,
            versionPosition: { line: definition.range.start.line + 1, column: definition.range.start.character },
          } satisfies JumpLocationParams,
        ]
        versionPositionCommandUri = Uri.parse(
          `command:${commands.gotoDefinition}?${encodeURIComponent(JSON.stringify(args))}`,
        )
      }

      const md = new MarkdownString()
      md.appendMarkdown([
        `- PNPM Catalog: \`${catalog}\``,
        versionPositionCommandUri ? `- Version: [${version}](${versionPositionCommandUri})` : `- Version: \`${version}\``,
      ].join('\n'))
      md.isTrusted = true

      const range = getNodeRange(doc.value!, node, offset)
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

      const color = config.namedCatalogsColors
        ? getCatalogColor(catalog === 'default' ? 'default' : `${catalog}-${config.namedCatalogsColorsSalt}`)
        : getCatalogColor('default')

      if (!inSelection) {
        overrides.push({
          range,
          renderOptions: {
            before: {
              contentText: version,
              color,
              backgroundColor: `${color}20; border-radius: 0.2em; padding: 0 0.2em;`,
            },
            after: config.namedCatalogsLabel && catalog !== 'default'
              ? {
                  contentText: `${catalog}`,
                  color: `${color}cc; padding-left: 0.4em; font-size: 0.8em;`,
                }
              : undefined,
          },
        })
      }
    }),
    )
  })

  useEditorDecorations(
    editor,
    {
      opacity: '0; display: none;',
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
        new Position(versionPosition.line - 1, versionPosition.column),
        [],
        'goto',
      )
    },
  )

  useDisposable(
    languages.registerDefinitionProvider({ pattern: '**/package.json' }, {
      async provideDefinition(document, position, token) {
        if (doc.value?.fileName !== document.fileName)
          return

        const offset = parsed.value?.offset || 0
        const selected = properties.value.find(prop => getNodeRange(doc.value!, prop.node, offset).contains(position))
        if (!selected)
          return

        const { version, definition } = await manager.resolveCatalog(
          doc.value!,
          (selected.node.key as StringLiteral).value,
          selected.catalog,
        ) || {}
        if (!version || token.isCancellationRequested)
          return

        return definition
      },
    }),
  )
})

export { activate, deactivate }
