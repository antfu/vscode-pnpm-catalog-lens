import type { ObjectProperty, StringLiteral } from '@babel/types'
import type { DecorationOptions, Selection, Terminal } from 'vscode'
import type { JumpLocationParams, UpgradeVersionParams } from './data'

import type { PackageManager } from './types'
import { parseSync } from '@babel/core'
// @ts-expect-error missing types
import preset from '@babel/preset-typescript'
// @ts-expect-error missing types
import traverse from '@babel/traverse'
import { computed, defineExtension, executeCommand, shallowRef, toValue as track, useActiveTextEditor, useCommand, useDisposable, useDocumentText, useEditorDecorations, watchEffect } from 'reactive-vscode'
import { ConfigurationTarget, languages, MarkdownString, Position, Range, Uri, window, workspace, WorkspaceEdit } from 'vscode'
import { config, enabled, hover, namedCatalogsColors, namedCatalogsColorsSalt, namedCatalogsLabel } from './config'
import { catalogPrefix, PACKAGE_MANAGERS_NAME } from './constants'
import { WorkspaceManager } from './data'
import { commands } from './generated/meta'
import { getCatalogColor, getNodeRange, logger } from './utils'

const versionRangePrefixRe = /^\D*/
const packageJsonRe = /[\\/]package\.json$/

let terminal: Terminal | undefined

export function getInstallCommand(manager: PackageManager) {
  switch (manager) {
    case 'pnpm':
      return 'pnpm install'
    case 'yarn':
      return 'yarn install'
    case 'bun':
      return 'bun install'
  }
}

const { activate, deactivate } = defineExtension(() => {
  const manager = new WorkspaceManager()

  const editor = useActiveTextEditor()
  const tick = shallowRef(0)
  const packageUpdateTick = shallowRef(0)

  useDisposable(workspace.onDidChangeTextDocument(() => {
    tick.value++
  }))
  useDisposable(workspace.onDidOpenTextDocument(() => {
    tick.value++
  }))
  useDisposable(manager.onDidUpdatePackages(() => {
    packageUpdateTick.value++
  }))

  const doc = computed(() => {
    track(tick)
    if (!editor.value || !editor.value.document)
      return
    if (!packageJsonRe.test(editor.value.document.fileName))
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
      ObjectProperty(path: any) {
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
    track(packageUpdateTick)

    if (!enabled() || !editor.value || !doc.value || editor.value?.document !== doc.value) {
      decorationsOverride.value = []
      decorationsHover.value = []
      return
    }

    const packageJsonDoc = doc.value!
    const offset = parsed.value?.offset || 0
    const props = properties.value
    const _selections = selections.value

    const overrides: DecorationOptions[] = []
    const hovers: DecorationOptions[] = []

    await Promise.all(props.map(async ({ node, catalog }) => {
      catalog = catalog || 'default'
      const { version, definition, manager: packageManager } = await manager.resolveCatalog(
        packageJsonDoc,
        (node.key as StringLiteral).value,
        catalog,
      ) || {}
      if (!version)
        return

      const packageName = (node.key as StringLiteral).value

      const range = getNodeRange(packageJsonDoc, node, offset)
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

      const color = namedCatalogsColors()
        ? getCatalogColor(catalog === 'default' ? 'default' : `${catalog}-${namedCatalogsColorsSalt()}`)
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
            after: namedCatalogsLabel() && catalog !== 'default'
              ? {
                  contentText: `${catalog}`,
                  color: `${color}cc; padding-left: 0.4em; font-size: 0.8em;`,
                }
              : undefined,
          },
        })
      }

      let versionPositionCommandUri: Uri | undefined
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

      const [installedVersion, latestVersion] = await Promise.all([
        manager.getInstalledVersion(packageJsonDoc, packageName),
        manager.getLatestVersion(packageName),
      ])

      const lines = [
        '---',
        `**${packageManager ? PACKAGE_MANAGERS_NAME[packageManager] : ''} Catalog: \`${catalog}\`**`,
        versionPositionCommandUri ? `- Version: [\`${version}\`](${versionPositionCommandUri})` : `- Version: \`${version}\``,
      ]

      if (latestVersion) {
        const isLatestInstalled = latestVersion === installedVersion

        if (installedVersion) {
          lines.push(`- Installed: \`${isLatestInstalled ? 'latest' : installedVersion}\``)
        }

        if (!isLatestInstalled && definition && packageManager) {
          const prefix = version.match(versionRangePrefixRe)?.[0] ?? ''
          const upgradeArgs = [
            {
              cwd: Uri.joinPath(definition.uri, '..').fsPath,
              manager: packageManager,
              newVersion: `${prefix}${latestVersion}`,
              packageName,
              workspacePath: definition.uri.fsPath,
              versionRange: {
                end: { character: definition.range.end.character, line: definition.range.end.line },
                start: { character: definition.range.start.character, line: definition.range.start.line },
              },
            } satisfies UpgradeVersionParams,
          ]
          const upgradeCommandUri = Uri.parse(
            `command:${commands.upgradeVersion}?${encodeURIComponent(JSON.stringify(upgradeArgs))}`,
          )
          lines.push(`[Upgrade to latest](${upgradeCommandUri} "Installs ${packageName}@${latestVersion}")`)
        }
      }
      else if (installedVersion) {
        lines.push(`- Installed: \`${installedVersion}\``)
      }

      const md = new MarkdownString()
      md.appendMarkdown(lines.join('\n'))
      md.isTrusted = true

      hovers.push({
        range: new Range(
          doc.value!.positionAt(node.start! + offset),
          doc.value!.positionAt(node.end! + offset),
        ),
        hoverMessage: md,
      })
    }),
    )

    decorationsOverride.value = overrides
    if (hover())
      decorationsHover.value = hovers
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

  const toggleCommand = () => config.$update('enabled', !config.enabled, ConfigurationTarget.Global)
  const gotoDefinitionCommand = ({ workspacePath, versionPosition }: JumpLocationParams) => {
    executeCommand(
      'editor.action.goToLocations',
      Uri.file(workspacePath),
      new Position(versionPosition.line - 1, versionPosition.column),
      [],
      'goto',
    )
  }
  const upgradeVersionCommand = async ({ cwd, manager: packageManager, newVersion, workspacePath, versionRange }: UpgradeVersionParams) => {
    const uri = Uri.file(workspacePath)
    const document = await workspace.openTextDocument(uri)
    const range = new Range(
      new Position(versionRange.start.line, versionRange.start.character),
      new Position(versionRange.end.line, versionRange.end.character),
    )
    const edit = new WorkspaceEdit()
    edit.replace(uri, range, newVersion)
    await workspace.applyEdit(edit)
    await document.save()

    // We use a terminal because `install` might trigger a prompt or show feedback, like new scripts to approve
    const command = getInstallCommand(packageManager)
    terminal ??= window.createTerminal({ name: 'Catalog Lens', cwd })
    terminal.show()
    terminal.sendText(command)
  }

  useCommand(commands.toggle, toggleCommand)
  useCommand(commands.gotoDefinition, gotoDefinitionCommand)
  useCommand(commands.upgradeVersion, upgradeVersionCommand)

  // Legacy commands for backward compatibility - will be removed in future versions
  useCommand(commands.pnpmCatalogLensToggle, toggleCommand)
  useCommand(commands.pnpmCatalogLensGotoDefinition, gotoDefinitionCommand)

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
