import type { TextDocument } from 'vscode'
import type { AST } from 'yaml-eslint-parser'
import { findUp } from 'find-up'
import YAML from 'js-yaml'
import { Uri, workspace } from 'vscode'
import { parseYAML } from 'yaml-eslint-parser'
import { workspaceFileName } from './constants'
import { commands } from './generated/meta'
import { logger } from './utils'

export interface PnpmWorkspacData {
  catalog?: Record<string, string>
  catalogs?: Record<string, Record<string, string>>
}

export interface PnpmWorkspacPositionData {
  catalog: Record<string, AST.Position>
  catalogs: Record<string, Record<string, AST.Position>>
}

export interface JumpLocationParams {
  workspacePath: string
  versionPosition: AST.Position
}

export class PnpmWorkspaceManager {
  private dataMap = new Map<string, PnpmWorkspacData>()
  private findUpCache = new Map<string, string>()
  private positionDataMap = new Map<string, PnpmWorkspacPositionData>()

  async resolveCatalog(doc: TextDocument, name: string, catalog: string) {
    const workspacePath = await this.findPnpmWorkspace(doc.uri.fsPath)
    if (!workspacePath) {
      return null
    }

    const workspaceDoc = await workspace.openTextDocument(Uri.file(workspacePath))

    const data = await this.readPnpmWorkspace(workspaceDoc)
    const positionData = this.readPnpmWorkspacePosition(workspaceDoc)

    const map = catalog === 'default'
      ? (data.catalog || data.catalogs?.default)
      : data.catalogs?.[catalog]

    const positionMap = catalog === 'default'
      ? (positionData.catalog || positionData.catalogs?.default)
      : positionData.catalogs?.[catalog]

    if (!map) {
      return null
    }

    const version = map[name]

    const versionPosition = positionMap?.[name]
    let versionPositionCommandUri
    if (versionPosition) {
      const args = [{ workspacePath, versionPosition } as JumpLocationParams]
      versionPositionCommandUri = Uri.parse(
        `command:${commands.gotoDefinition}?${encodeURIComponent(JSON.stringify(args))}`,
      )
    }

    return { version, versionPositionCommandUri }
  }

  private async findPnpmWorkspace(path: string) {
    if (this.findUpCache.has(path)) {
      return this.findUpCache.get(path)
    }

    const file = await findUp(workspaceFileName, {
      type: 'file',
      cwd: path,
    })

    if (!file) {
      logger.error(`${workspaceFileName} not found in`, path)
      return null
    }

    this.findUpCache.set(path, file)
    return file
  }

  private async readPnpmWorkspace(doc: TextDocument | Uri): Promise<PnpmWorkspacData> {
    if (doc instanceof Uri) {
      doc = await workspace.openTextDocument(doc)
    }
    if (this.dataMap.has(doc.uri.fsPath)) {
      return this.dataMap.get(doc.uri.fsPath)!
    }
    const data = YAML.load(doc.getText()) as PnpmWorkspacData
    this.dataMap.set(doc.uri.fsPath, data)
    const disposable = workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.fsPath === doc.uri.fsPath) {
        this.dataMap.delete(doc.uri.fsPath)
        disposable.dispose()
      }
    })

    return data
  }

  private readPnpmWorkspacePosition(doc: TextDocument) {
    if (this.positionDataMap.has(doc.uri.fsPath)) {
      return this.positionDataMap.get(doc.uri.fsPath)!
    }

    const data: PnpmWorkspacPositionData = {
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

    function setActualPosition(data: Record<string, AST.Position>, pairs: AST.YAMLPair[]) {
      pairs.forEach(({ key, value }) => {
        if (key?.type === 'YAMLScalar' && value?.type === 'YAMLScalar') {
          const line = value.loc.start.line
          const lineText = lines[line - 1]
          const column = lineText.indexOf(value.value as unknown as string) + 1
          data[key.value as unknown as string] = { line, column }
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
      logger.error(`readPnpmWorkspacePosition error ${err.message}`)
    }

    this.positionDataMap.set(doc.uri.fsPath, data)

    return data
  }
}
