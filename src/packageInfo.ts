import { getLatestVersion } from 'fast-npm-meta'
import { workspace } from 'vscode'
import { logger } from './utils'

export interface PackageInfo {
  version: string
  publishedAt?: string
  deprecated?: string
}

const CACHE_TTL = 5 * 60 * 1000
const cache = new Map<string, { at: number, info: PackageInfo }>()

export async function fetchPackageInfo(name: string): Promise<PackageInfo | undefined> {
  if (!isValidPackageName(name) || !onlineEnabled())
    return undefined

  const cached = cache.get(name)
  if (cached && Date.now() - cached.at < CACHE_TTL)
    return cached.info

  try {
    const meta = await getLatestVersion(name, { metadata: true })
    if (!meta.version)
      return undefined

    const info: PackageInfo = {
      version: meta.version,
      publishedAt: meta.publishedAt ?? undefined,
      deprecated: meta.deprecated,
    }
    cache.set(name, { at: Date.now(), info })
    return info
  }
  catch (err) {
    logger.error(`fetchPackageInfo failed for ${name}:`, err)
    return undefined
  }
}

// Same gate as VS Code's built-in npm extension uses for package.json hovers
function onlineEnabled(): boolean {
  return !!workspace.getConfiguration('npm').get('fetchOnlinePackageInfo')
}

// The name is interpolated into a URL path, so reject anything that is not a plain npm package name
function isValidPackageName(name: string): boolean {
  // Rules from https://github.com/npm/validate-npm-package-name
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
