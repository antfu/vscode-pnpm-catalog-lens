import type { ObjectMethod, ObjectProperty, SpreadElement } from '@babel/types'
import type { Location, TextDocument } from 'vscode'
import type { AST } from 'yaml-eslint-parser'
import type { PackageManager } from './types'
import { dirname, join } from 'node:path'
import { parseSync, traverse } from '@babel/core'
// @ts-expect-error missing types
import preset from '@babel/preset-typescript'
import { findUp } from 'find-up'
import YAML from 'js-yaml'
import { Range, Uri, workspace } from 'vscode'
import { parseYAML } from 'yaml-eslint-parser'
import { BUN_LOCKS, WORKSPACE_FILES } from './constants'
import { logger } from './utils'

export interface WorkspaceData {
  catalog?: Record<string, string>
  catalogs?: Record<string, Record<string, string>>
}

export interface WorkspacePositionData {
  catalog: Record<string, [AST.Position, AST.Position]>
  catalogs: Record<string, Record<string, [AST.Position, AST.Position]>>
}

export interface JumpLocationParams {
  workspacePath: string
  versionPosition: AST.Position
}

export interface WorkspaceInfo {
  path: string
  manager: PackageManager
}

export class WorkspaceManager {
  private dataMap = new Map<string, WorkspaceData>()
  private findUpCache = new Map<string, WorkspaceInfo>()
  private positionDataMap = new Map<string, WorkspacePositionData>()

  async resolveCatalog(doc: TextDocument, name: string, catalog: string) {
    const workspaceInfo = await this.findWorkspace(doc.uri.fsPath)
    if (!workspaceInfo) {
      return null
    }

    const workspaceDoc = await workspace.openTextDocument(Uri.file(workspaceInfo.path))

    const data = await this.readWorkspace(workspaceDoc, workspaceInfo.manager)

    const map = catalog === 'default'
      ? (data.catalog || data.catalogs?.default)
      : data.catalogs?.[catalog]

    if (!map)
      return null

    const positionData = this.readWorkspacePosition(workspaceDoc)
    if (!positionData)
      return null

    const positionMap = catalog === 'default'
      ? (positionData.catalog || positionData.catalogs?.default)
      : positionData.catalogs?.[catalog]

    const version = map[name]

    const versionRange = positionMap?.[name]
    let definition: Location | undefined
    if (versionRange) {
      definition = {
        uri: Uri.file(workspaceInfo.path),
        range: new Range(versionRange[0].line - 1, versionRange[0].column, versionRange[1].line - 1, versionRange[1].column),
      }
    }

    return { version, definition, manager: workspaceInfo.manager }
  }

  private async findWorkspace(path: string): Promise<WorkspaceInfo | null> {
    if (this.findUpCache.has(path)) {
      return this.findUpCache.get(path)!
    }

    // Get workspace folders to limit search scope
    const workspaceFolders = workspace.workspaceFolders
    let stopAt: string | undefined

    if (workspaceFolders) {
      // Find which workspace folder contains the current path
      for (const folder of workspaceFolders) {
        if (path.startsWith(folder.uri.fsPath)) {
          stopAt = folder.uri.fsPath
          break
        }
      }
    }

    // check if is pnpm or yarn workspace
    const file = await findUp([WORKSPACE_FILES.yarn, WORKSPACE_FILES.pnpm], {
      type: 'file',
      cwd: path,
      stopAt,
    })
    logger.info(file)
    if (file) {
      const workspaceInfo: WorkspaceInfo = { path: file, manager: file.includes(WORKSPACE_FILES.yarn) ? 'yarn' : 'pnpm' }
      this.findUpCache.set(path, workspaceInfo)
      return workspaceInfo
    }

    // check if is bun workspace
    const bun = await findUp(BUN_LOCKS, {
      type: 'file',
      cwd: path,
      stopAt,
    })
    if (bun) {
      const filepath = join(dirname(bun), 'package.json')
      const workspaceInfo: WorkspaceInfo = { path: filepath, manager: 'bun' }
      this.findUpCache.set(path, workspaceInfo)
      return workspaceInfo
    }

    logger.error(`No workspace file (${WORKSPACE_FILES.yarn} or ${WORKSPACE_FILES.pnpm}) found in`, path)
    return null
  }

  private async readWorkspace(doc: TextDocument | Uri, manager: PackageManager): Promise<WorkspaceData> {
    if (doc instanceof Uri) {
      doc = await workspace.openTextDocument(doc)
    }
    if (this.dataMap.has(doc.uri.fsPath)) {
      return this.dataMap.get(doc.uri.fsPath)!
    }
    const data = await this.loadWorkspace(doc, manager)

    this.dataMap.set(doc.uri.fsPath, data)
    const disposable = workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.fsPath === doc.uri.fsPath) {
        this.dataMap.delete(doc.uri.fsPath)
        disposable.dispose()
      }
    })

    return data
  }

  private async loadWorkspace(doc: TextDocument, manager: PackageManager): Promise<WorkspaceData> {
    if (manager === 'pnpm' || manager === 'yarn')
      return YAML.load(doc.getText()) as WorkspaceData
    if (manager === 'bun') {
      try {
        const parsed = JSON.parse(doc.getText())
        // Priority: root-level catalog/catalogs > workspaces.catalog/catalogs (for backward compatibility)
        const rootCatalog = parsed.catalog
        const rootCatalogs = parsed.catalogs
        const workspacesCatalog = parsed.workspaces?.catalog
        const workspacesCatalogs = parsed.workspaces?.catalogs

        return {
          catalog: rootCatalog || workspacesCatalog,
          catalogs: rootCatalogs || workspacesCatalogs,
        } as WorkspaceData
      }
      catch {
        // Safe guard
      }
    }
    return {} as WorkspaceData
  }

  private readWorkspacePosition(doc: TextDocument) {
    if (this.positionDataMap.has(doc.uri.fsPath)) {
      return this.positionDataMap.get(doc.uri.fsPath)!
    }

    if (doc.uri.fsPath.endsWith('.json'))
      return this.readJsonWorkspacePosition(doc)
    else
      return this.readYamlWorkspacePosition(doc)
  }

  private readYamlWorkspacePosition(doc: TextDocument) {
    const data: WorkspacePositionData = {
      catalog: {},
      catalogs: {},
    }

    const code = doc.getText()
    const lines = code.split('\n')
    const ast: AST.YAMLProgram = parseYAML(code)
    const astBody = ast.body[0].content as AST.YAMLMapping
    if (!astBody) {
      return data
    }

    const defaultCatalog = astBody.pairs.find(pair => pair.key?.type === 'YAMLScalar' && pair.key.value === 'catalog')
    const namedCatalog = astBody.pairs.find(pair => pair.key?.type === 'YAMLScalar' && pair.key.value === 'catalogs')

    function setActualPosition(data: Record<string, [AST.Position, AST.Position]>, pairs: AST.YAMLPair[]) {
      pairs.forEach(({ key, value }) => {
        if (key?.type === 'YAMLScalar' && value?.type === 'YAMLScalar') {
          const line = value.loc.start.line
          const lineText = lines[line - 1]
          const column = lineText.indexOf(value.value as unknown as string)
          const endLine = value.loc.end.line
          const endColumn = column + (value.value as unknown as string).length
          data[key.value as unknown as string] = [
            { line, column },
            { line: endLine, column: endColumn },
          ]
        }
      })
    }

    try {
      if (defaultCatalog?.value?.type === 'YAMLMapping') {
        setActualPosition(data.catalog, defaultCatalog.value.pairs)
      }

      if (namedCatalog?.value?.type === 'YAMLMapping') {
        namedCatalog.value.pairs.forEach(({ key, value }) => {
          if (key?.type === 'YAMLScalar' && value?.type === 'YAMLMapping') {
            const catalogName = key.value as unknown as string
            data.catalogs[catalogName] = {}
            setActualPosition(data.catalogs[catalogName], value.pairs)
          }
        })
      }
    }
    catch (err: any) {
      logger.error(`readYamlWorkspacePosition error ${err.message}`)
    }

    this.positionDataMap.set(doc.uri.fsPath, data)

    return data
  }

  private readJsonWorkspacePosition(doc: TextDocument) {
    const data: WorkspacePositionData = {
      catalog: {},
      catalogs: {},
    }

    const code = doc.getText()
    const prefix = 'const x = '
    const offset = -prefix.length
    const combined = prefix + code

    try {
      const ast = parseSync(combined, {
        filename: doc.uri.fsPath,
        presets: [preset],
        babelrc: false,
      })
      if (!ast)
        return

      const setActualPosition = (properties: (ObjectMethod | ObjectProperty | SpreadElement)[], data: Record<string, [AST.Position, AST.Position]>, code: string) => {
        properties.forEach((prop) => {
          if (prop.type === 'ObjectProperty' && prop.key.type === 'StringLiteral' && prop.value.type === 'StringLiteral') {
            const packageName = prop.key.value

            const startPos = prop.value.start ? prop.value.start + offset : undefined
            const endPos = prop.value.end ? prop.value.end + offset : undefined

            const beforeStart = code.substring(0, startPos)
            const beforeEnd = code.substring(0, endPos)

            const startLine = beforeStart.split('\n').length
            const startColumn = beforeStart.split('\n').pop()!.length
            const endLine = beforeEnd.split('\n').length
            const endColumn = beforeEnd.split('\n').pop()!.length

            data[packageName] = [
              { line: startLine, column: startColumn + 1 },
              { line: endLine, column: endColumn - 1 },
            ]
          }
        })
      }

      traverse(ast, {
        ObjectProperty(path) {
          const key = path.node.key
          const value = path.node.value

          // Handle root-level catalog and catalogs (priority)
          if (key.type === 'StringLiteral') {
            if (key.value === 'catalog' && value.type === 'ObjectExpression') {
              setActualPosition(value.properties, data.catalog, code)
            }
            else if (key.value === 'catalogs' && value.type === 'ObjectExpression') {
              value.properties.forEach((catalogProp) => {
                if (catalogProp.type === 'ObjectProperty' && catalogProp.key.type === 'StringLiteral' && catalogProp.value.type === 'ObjectExpression') {
                  const catalogName = catalogProp.key.value
                  data.catalogs[catalogName] = {}
                  setActualPosition(catalogProp.value.properties, data.catalogs[catalogName], code)
                }
              })
            }
          }

          // Handle workspaces.catalog and workspaces.catalogs (backward compatibility)
          if (key.type === 'StringLiteral' && key.value === 'workspaces') {
            if (value.type === 'ObjectExpression') {
              value.properties.forEach((prop) => {
                if (prop.type === 'ObjectProperty' && prop.key.type === 'StringLiteral') {
                  if (prop.key.value === 'catalog' && prop.value.type === 'ObjectExpression') {
                    // Only set if root-level catalog doesn't exist
                    if (Object.keys(data.catalog).length === 0) {
                      setActualPosition(prop.value.properties, data.catalog, code)
                    }
                  }
                  else if (prop.key.value === 'catalogs' && prop.value.type === 'ObjectExpression') {
                    // Only set if root-level catalogs doesn't exist
                    if (Object.keys(data.catalogs).length === 0) {
                      prop.value.properties.forEach((catalogProp) => {
                        if (catalogProp.type === 'ObjectProperty' && catalogProp.key.type === 'StringLiteral' && catalogProp.value.type === 'ObjectExpression') {
                          const catalogName = catalogProp.key.value
                          data.catalogs[catalogName] = {}
                          setActualPosition(catalogProp.value.properties, data.catalogs[catalogName], code)
                        }
                      })
                    }
                  }
                }
              })
            }
          }
        },
      })
    }
    catch (err: any) {
      logger.error(`readJsonWorkspacePosition error ${err.message}`)
    }

    this.positionDataMap.set(doc.uri.fsPath, data)

    return data
  }
}
