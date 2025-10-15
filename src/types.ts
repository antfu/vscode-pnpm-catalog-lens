import type { PACKAGE_MANAGERS } from './constants'

export type PackageManager = (typeof PACKAGE_MANAGERS)[number]
