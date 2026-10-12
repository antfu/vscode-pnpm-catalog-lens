import { describe, expect, it, vi } from 'vitest'

vi.mock('vscode', () => ({ Range: class {}, env: { language: 'en' } }))
vi.mock('reactive-vscode', () => ({ useLogger: () => ({}) }))
vi.mock('../src/generated/meta', () => ({ displayName: 'Catalog Lens' }))

const { fromNow } = await import('../src/utils')

describe('fromNow', () => {
  const now = Date.parse('2026-01-01T00:00:00Z')

  it('formats past dates', () => {
    expect(fromNow(now - 10 * 1000, now)).toBe('now')
    expect(fromNow(now - 45 * 1000, now)).toBe('45 seconds ago')
    expect(fromNow(now - 3 * 3600 * 1000, now)).toBe('3 hours ago')
    expect(fromNow(now - 40 * 86400 * 1000, now)).toBe('last month')
    expect(fromNow(now - 800 * 86400 * 1000, now)).toBe('2 years ago')
  })
})
