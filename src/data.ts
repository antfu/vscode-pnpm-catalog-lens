import type { $Fetch } from 'ofetch'
import type { Location, TextDocument } from 'vscode'
import type { AST } from 'yaml-eslint-parser'
import * as cp from 'node:child_process'
import { dirname } from 'node:path'
import process from 'node:process'
import { findUp } from 'find-up'
import YAML from 'js-yaml'
import { Range, Uri, workspace } from 'vscode'
import { parseYAML } from 'yaml-eslint-parser'
import { workspaceFileName } from './constants'
import { logger } from './utils'

export interface PnpmWorkspaceData {
  catalog?: Record<string, string>
  catalogs?: Record<string, Record<string, string>>
}

export interface PnpmWorkspacePositionData {
  catalog: Record<string, [AST.Position, AST.Position]>
  catalogs: Record<string, Record<string, [AST.Position, AST.Position]>>
}

export interface JumpLocationParams {
  workspacePath: string
  versionPosition: AST.Position
}

export interface ViewPackageInfo {
  description: string
  version?: string
  time?: string
  homepage?: string
}

export class PnpmWorkspaceManager {
  private dataMap = new Map<string, PnpmWorkspaceData>()
  private findUpCache = new Map<string, string>()
  private positionDataMap = new Map<string, PnpmWorkspacePositionData>()

  constructor(private fetch: $Fetch, private npmCommandPath: string | undefined) {}

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

    const versionRange = positionMap?.[name]
    let definition: Location | undefined
    if (versionRange) {
      definition = {
        uri: Uri.file(workspacePath),
        range: new Range(versionRange[0].line - 1, versionRange[0].column, versionRange[1].line - 1, versionRange[1].column),
      }
    }

    return { version, definition }
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

  public async readPnpmWorkspace(doc: TextDocument | Uri): Promise<PnpmWorkspaceData> {
    if (doc instanceof Uri) {
      doc = await workspace.openTextDocument(doc)
    }
    if (this.dataMap.has(doc.uri.fsPath)) {
      return this.dataMap.get(doc.uri.fsPath)!
    }
    const data = YAML.load(doc.getText()) as PnpmWorkspaceData
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

    const data: PnpmWorkspacePositionData = {
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
      logger.error(`readPnpmWorkspacePosition error ${err.message}`)
    }

    this.positionDataMap.set(doc.uri.fsPath, data)

    return data
  }

  private onlineEnabled() {
    // Original implementation from Microsoft/vscode packageJSONContribution.ts
    return !!workspace.getConfiguration('npm').get('fetchOnlinePackageInfo')
  }

  private isValidNPMName(name: string): boolean {
    // Original implementation from Microsoft/vscode packageJSONContribution.ts
    // following rules from https://github.com/npm/validate-npm-package-name,
    // leading slash added as additional security measure
    if (!name || name.length > 214 || name.match(/^[-_.\s]/)) {
      return false
    }
    const match = name.match(/^(?:@([^/~\s)('!*]+)\/)?([^/~)('!*\s]+)$/)
    if (match) {
      const scope = match[1]
      if (scope && encodeURIComponent(scope) !== scope) {
        return false
      }
      const name = match[2]
      return encodeURIComponent(name) === name
    }
    return false
  }

  public async fetchPackageInfo(pack: string, resource: Uri | undefined): Promise<ViewPackageInfo | undefined> {
    if (!this.isValidNPMName(pack)) {
      return undefined // avoid unnecessary lookups
    }
    let info: ViewPackageInfo | undefined
    if (this.npmCommandPath) {
      info = await this.npmView(this.npmCommandPath, pack, resource)
    }
    if (!info && this.onlineEnabled()) {
      info = await this.npmjsView(pack)
    }
    return info
  }

  private npmView(npmCommandPath: string, pack: string, resource: Uri | undefined): Promise<ViewPackageInfo | undefined> {
    // Original implementation from Microsoft/vscode packageJSONContribution.ts
    return new Promise((resolve) => {
      const args = ['view', '--json', '--', pack, 'description', 'dist-tags.latest', 'homepage', 'version', 'time']
      const cwd = resource && resource.scheme === 'file' ? dirname(resource.fsPath) : undefined

      // corepack npm wrapper would automatically update package.json. disable that behavior.
      // COREPACK_ENABLE_AUTO_PIN disables the package.json overwrite, and
      // COREPACK_ENABLE_PROJECT_SPEC makes the npm view command succeed
      //   even if packageManager specified a package manager other than npm.
      const env = { ...process.env, COREPACK_ENABLE_AUTO_PIN: '0', COREPACK_ENABLE_PROJECT_SPEC: '0' }
      let options: cp.ExecFileOptions = { cwd, env }
      let commandPath: string = npmCommandPath
      if (process.platform === 'win32') {
        options = { cwd, env, shell: true }
        commandPath = `"${npmCommandPath}"`
      }
      cp.execFile(commandPath, args, options, (error, stdout) => {
        if (!error) {
          try {
            const content = JSON.parse(stdout)
            const version = content['dist-tags.latest'] || content.version
            resolve({
              description: content.description,
              version,
              time: content.time?.[version],
              homepage: content.homepage,
            })
            return
          }
          catch {
            // ignore
          }
        }
        resolve(undefined)
      })
    })
  }

  private async npmjsView(pack: string): Promise<ViewPackageInfo | undefined> {
    // Original implementation from Microsoft/vscode packageJSONContribution.ts
    const queryUrl = `https://registry.npmjs.org/${encodeURIComponent(pack)}`
    try {
      const obj = await this.fetch(queryUrl)
      const version = obj['dist-tags']?.latest || Object.keys(obj.versions).pop() || ''
      return {
        description: obj.description || '',
        version,
        time: obj.time?.[version],
        homepage: obj.homepage || '',
      }
    }
    catch {
      // ignore
    }
    return undefined
  }
}
