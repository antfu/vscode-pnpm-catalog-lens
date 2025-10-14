import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: 'src/index.ts',
  format: 'cjs',
  external: ['vscode'],

  // FIXME: https://github.com/antfu/vscode-pnpm-catalog-lens/issues/23
  treeshake: false,
})
