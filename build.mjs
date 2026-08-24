/** Build the single-file Host entry for dsh-decision-log. */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { build } from 'esbuild'

mkdirSync('lib', { recursive: true })

const dshExternal = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-*']

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node22'],
  sourcemap: true,
  external: dshExternal,
  logLevel: 'info',
})

execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--emitDeclarationOnly', '--declaration', '--outDir', 'lib/types'], { stdio: 'inherit' })
