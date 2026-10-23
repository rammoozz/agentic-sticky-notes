import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, test } from 'node:test'
import { addNote, deleteNote, listNotes, NoteError, projectRoot, updateNote } from './store.ts'
import { isVisible } from './types.ts'

const project = '/work/shop-api'
let home = ''

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sticky-'))
  process.env.STICKY_NOTES_HOME = home
})

const pin = (text: string, extra: Partial<Parameters<typeof addNote>[0]> = {}) =>
  addNote({ project, text, kind: 'todo', scope: 'project', session: 'S1', ...extra })

test('add, list, update, delete', async () => {
  const note = await pin('add rate limit to /login')
  assert.match(note.id, /^n_[a-z0-9]{5}$/)
  assert.deepEqual((await listNotes(project)).map((n) => n.text), ['add rate limit to /login'])

  const done = await updateNote(project, note.id, { done: true })
  assert.equal(done.done, true)
  assert.ok(done.updatedAt >= note.updatedAt)

  await deleteNote(project, note.id)
  assert.deepEqual(await listNotes(project), [])
})

test('quick replies are kept, and older notes read with none', async () => {
  const note = await pin('deploy to prod?', { kind: 'human', actions: ['Deploy now', 'Not yet'] })
  assert.deepEqual(note.actions, ['Deploy now', 'Not yet'])
  await assert.rejects(pin('x', { actions: ['a', 'b', 'c', 'd'] }), NoteError)
  const dir = join(home, readdirSync(home)[0] ?? '')
  const { actions: _, ...old } = note
  writeFileSync(join(dir, 'n_old01.json'), JSON.stringify({ ...old, id: 'n_old01' }))
  const read = (await listNotes(project)).find((n) => n.id === 'n_old01')
  assert.deepEqual(read?.actions, [])
})

test('what needs the human comes first', async () => {
  await pin('keep JWT', { kind: 'decision' })
  await pin('log in to the Stripe dashboard', { kind: 'human' })
  await pin('staging db is read-only', { kind: 'remember' })
  assert.deepEqual((await listNotes(project)).map((n) => n.kind), ['human', 'decision', 'remember'])
})

test('chat notes only show in their own session', async () => {
  await pin('project wide')
  await pin('only today', { scope: 'chat', session: 'S1' })
  const notes = await listNotes(project)
  assert.equal(notes.filter((n) => isVisible(n, 'S1')).length, 2)
  assert.equal(notes.filter((n) => isVisible(n, 'S2')).length, 1)
})

test('a chat note needs a session', async () => {
  await assert.rejects(pin('x', { scope: 'chat', session: null }), NoteError)
})

test('bad input and unknown ids are NoteErrors', async () => {
  await assert.rejects(pin('x'.repeat(281)), NoteError)
  await assert.rejects(pin('   '), NoteError)
  await assert.rejects(updateNote(project, 'n_zzzzz', { done: true }), NoteError)
  await assert.rejects(deleteNote(project, 'n_zzzzz'), NoteError)
  await assert.rejects(deleteNote(project, '../other/n_zzzzz'), NoteError)
  await assert.rejects(updateNote(project, '../../etc/passwd', { done: true }), NoteError)
})

test('a broken file is skipped, not fatal', async () => {
  await pin('good note')
  const dir = join(home, readdirSync(home)[0] ?? '')
  writeFileSync(join(dir, 'n_broke.json'), '{ half a no')
  writeFileSync(join(dir, 'n_wrong.json'), JSON.stringify({ v: 2, id: 'n_wrong' }))
  assert.deepEqual((await listNotes(project)).map((n) => n.text), ['good note'])
})

test('20 writers at once keep 20 notes and leave no tmp files', async () => {
  await Promise.all(Array.from({ length: 20 }, (_, i) => pin('note ' + i)))
  assert.equal((await listNotes(project)).length, 20)
  const dir = join(home, readdirSync(home)[0] ?? '')
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.tmp')), [])
})

test('a subfolder of a git repo maps to the repo root', () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'sticky-repo-')))
  execFileSync('git', ['init', '-q'], { cwd: repo })
  mkdirSync(join(repo, 'src'))
  assert.equal(projectRoot(join(repo, 'src')), repo)
  const plain = realpathSync(mkdtempSync(join(tmpdir(), 'sticky-plain-')))
  assert.equal(projectRoot(plain), plain)
})
