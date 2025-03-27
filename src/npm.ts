import process from 'node:process'
import * as vscode from 'vscode'
import which from 'which'

export async function getNPMCommandPath(): Promise<string | undefined> {
  // Original implementation from Microsoft/vscode npmMain.ts
  if (vscode.workspace.isTrusted && canRunNpmInCurrentWorkspace()) {
    try {
      return await which(process.platform === 'win32' ? 'npm.cmd' : 'npm')
    }
    catch {
      return undefined
    }
  }
  return undefined
}

function canRunNpmInCurrentWorkspace() {
  // Original implementation from Microsoft/vscode npmMain.ts
  if (vscode.workspace.workspaceFolders) {
    return vscode.workspace.workspaceFolders.some(f => f.uri.scheme === 'file')
  }
  return false
}
