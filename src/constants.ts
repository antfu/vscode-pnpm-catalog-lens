export const catalogPrefix = 'catalog:'

export const PACKAGE_MANAGERS = ['PNPM', 'Yarn', 'Bun'] as const

export const WORKSPACE_FILES = {
  PNPM: 'pnpm-workspace.yaml',
  YARN: '.yarnrc.yml',
  BUN: 'package.json',
} as const

export const BUN_LOCKS = ['bun.lockb', 'bun.lock']
