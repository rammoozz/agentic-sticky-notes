// Builds docs/sticky-notes.zip (the plugin) and docs/marketplace.json (points at it),
// so Claude Code can install the plugin straight from the hosting site.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'

const SITE = 'https://agentic-sticky.web.app'
const ZIP = 'docs/sticky-notes.zip'
const FILES = [
  '.claude-plugin/plugin.json',
  'bin/sticky',
  'dist/sticky.js',
  'hooks/hooks.json',
  'hooks/pane.tsx',
  'skills',
  'src/types.ts',
  'types/index.d.ts',
  'README.md',
]

const plugin = JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf8'))
const local = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'))

rmSync(ZIP, { force: true })
execFileSync('zip', ['-q', '-X', '-r', ZIP, ...FILES], { stdio: 'inherit' })
const sha256 = createHash('sha256').update(readFileSync(ZIP)).digest('hex')

const marketplace = {
  name: local.name,
  owner: local.owner,
  description: plugin.description,
  plugins: [
    {
      name: plugin.name,
      description: plugin.description,
      version: plugin.version,
      source: { source: 'archive', url: SITE + '/sticky-notes.zip', sha256 },
    },
  ],
}
writeFileSync('docs/marketplace.json', JSON.stringify(marketplace, null, 2) + '\n')
console.log('packed ' + ZIP + ' ' + sha256.slice(0, 12) + ', wrote docs/marketplace.json')
