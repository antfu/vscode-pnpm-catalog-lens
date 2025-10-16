import type { PackageManager } from './types'

export const catalogPrefix = 'catalog:'

export const PACKAGE_MANAGERS = ['pnpm', 'yarn', 'bun'] as const

export const PACKAGE_MANAGERS_NAME: Record<PackageManager, string> = {
  pnpm: 'PNPM',
  yarn: 'Yarn',
  bun: 'Bun',
} as const

export const WORKSPACE_FILES: Record<PackageManager, string> = {
  pnpm: 'pnpm-workspace.yaml',
  yarn: '.yarnrc.yml',
  bun: 'package.json',
} as const

export const BUN_LOCKS = ['bun.lockb', 'bun.lock']
