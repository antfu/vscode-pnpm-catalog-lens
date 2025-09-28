import type { Location, TextDocument } from 'vscode'
import type { AST } from 'yaml-eslint-parser'
import { findUp } from 'find-up'
import YAML from 'js-yaml'
import { Range, Uri, workspace } from 'vscode'
import { parseYAML } from 'yaml-eslint-parser'
import { WORKSPACE_FILES } from './constants'
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
  manager: 'PNPM' | 'Yarn'
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

    const data = await this.readWorkspace(workspaceDoc)
    const positionData = this.readWorkspacePosition(workspaceDoc)

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

    const file = await findUp([WORKSPACE_FILES.YARN, WORKSPACE_FILES.PNPM], {
      type: 'file',
      cwd: path,
    })

    if (!file) {
      logger.error(`No workspace file (${WORKSPACE_FILES.YARN} or ${WORKSPACE_FILES.PNPM}) found in`, path)
      return null
    }

    const workspaceInfo: WorkspaceInfo = { path: file, manager: file.includes(WORKSPACE_FILES.YARN) ? 'Yarn' : 'PNPM' }
    this.findUpCache.set(path, workspaceInfo)
    return workspaceInfo
  }

  private async readWorkspace(doc: TextDocument | Uri): Promise<WorkspaceData> {
    if (doc instanceof Uri) {
      doc = await workspace.openTextDocument(doc)
    }
    if (this.dataMap.has(doc.uri.fsPath)) {
      return this.dataMap.get(doc.uri.fsPath)!
    }
    const data = YAML.load(doc.getText()) as WorkspaceData
    this.dataMap.set(doc.uri.fsPath, data)
    const disposable = workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.fsPath === doc.uri.fsPath) {
        this.dataMap.delete(doc.uri.fsPath)
        disposable.dispose()
      }
    })

    return data
  }

  private readWorkspacePosition(doc: TextDocument) {
    if (this.positionDataMap.has(doc.uri.fsPath)) {
      return this.positionDataMap.get(doc.uri.fsPath)!
    }

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
      logger.error(`readWorkspacePosition error ${err.message}`)
    }

    this.positionDataMap.set(doc.uri.fsPath, data)

    return data
  }
}
