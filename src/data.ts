import { findUp } from 'find-up'
import { type TextDocument, Uri, workspace } from 'vscode'
import YAML from 'js-yaml'
import { logger } from './utils'

export interface PnpmWorkspacData {
  catalog?: Record<string, string>
  catalogs?: Record<string, Record<string, string>>
}

export class PnpmWorkspaceManager {
  private dataMap = new Map<string, PnpmWorkspacData>()
  private findUpCache = new Map<string, string>()

  async resolveCatalog(doc: TextDocument, name: string, catalog: string) {
    const workspace = await this.findPnpmWorkspace(doc.uri.fsPath)
    if (!workspace) {
      return null
    }
    const data = await this.readPnpmWorkspace(Uri.file(workspace))

    const map = catalog === 'default'
      ? (data.catalog || data.catalogs?.default)
      : data.catalogs?.[catalog]

    if (!map) {
      return null
    }

    return map[name]
  }

  private async findPnpmWorkspace(path: string) {
    if (this.findUpCache.has(path)) {
      return this.findUpCache.get(path)
    }

    const file = await findUp('pnpm-workspace.yaml', {
      type: 'file',
      cwd: path,
    })

    if (!file) {
      logger.error('pnpm-workspace.yaml not found in', path)
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
}
