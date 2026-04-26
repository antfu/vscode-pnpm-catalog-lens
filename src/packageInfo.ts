import pacote from 'pacote'
import { workspace } from 'vscode'
import { logger } from './utils'

export interface PackageInfo {
  description?: string
  version?: string
  time?: string
  homepage?: string
}

export async function fetchPackageInfo(name: string, cwd?: string): Promise<PackageInfo | undefined> {
  if (!isValidPackageName(name))
    return undefined

  if (!onlineEnabled())
    return undefined

  try {
    const pack = await pacote.packument(name, {
      fullMetadata: true,
      ...(cwd ? { cwd } : {}),
    })

    const version = pack['dist-tags']?.latest
    if (!version)
      return undefined

    const manifest = pack.versions?.[version]

    return {
      description: manifest?.description,
      version,
      time: pack.time?.[version],
      homepage: manifest?.homepage,
    }
  }
  catch (err) {
    logger.error(`fetchPackageInfo failed for ${name}:`, err)
    return undefined
  }
}

function onlineEnabled(): boolean {
  return !!workspace.getConfiguration('npm').get('fetchOnlinePackageInfo')
}

function isValidPackageName(name: string): boolean {
  // Following rules from https://github.com/npm/validate-npm-package-name
  if (!name || name.length > 214 || /^[-_.\s]/.test(name))
    return false

  const match = name.match(/^(?:@([^/~\s)('!*]+)\/)?([^/~)('!*\s]+)$/)
  if (!match)
    return false

  const scope = match[1]
  if (scope && encodeURIComponent(scope) !== scope)
    return false

  return encodeURIComponent(match[2]) === match[2]
}
