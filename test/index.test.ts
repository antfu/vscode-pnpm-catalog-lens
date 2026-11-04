import { describe, expect, it } from 'vitest'
import { getCatalogIncludePaths } from '../src/pnpm-includes'

describe('getCatalogIncludePaths', () => {
  it('returns YAML sources that own catalog settings', () => {
    expect(getCatalogIncludePaths({
      './config/catalog.yaml': ['catalog'],
      '../shared/catalogs.yml': ['catalogs', 'overrides'],
      './config/all.yaml': '*',
      './config/packages.yaml': ['packages'],
    })).toEqual([
      './config/catalog.yaml',
      '../shared/catalogs.yml',
      './config/all.yaml',
    ])
  })

  it('ignores invalid sources and settings that cannot define catalogs', () => {
    expect(getCatalogIncludePaths({
      'config/catalog.yaml': ['catalog'],
      './config/catalog.json': ['catalog'],
      './config/overrides.yaml': ['overrides'],
      './config/invalid.yaml': 'catalog',
    })).toEqual([])
  })
})
