import { execFileSync } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { NoteSchema } from './note.ts'
import { KINDS, NOTE_ID, type Kind, type Note, type Scope } from './types.ts'

export class NoteError extends Error {}

/** Read on every call so tests can point it at a temp folder. */
const home = () => process.env.STICKY_NOTES_HOME ?? join(homedir(), '.sticky-notes')

/** Git root of dir, or dir itself outside a repo. The one rule every door uses. */
export function projectRoot(dir: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return dir
  }
}

/** Same naming as ~/.claude/projects/: every non-letter, non-digit becomes "-". */
const folder = (project: string) => join(home(), project.replace(/[^A-Za-z0-9]/g, '-'))
/** Ids become file names, so anything but the real id shape (e.g. "../x") is refused. */
function fileOf(project: string, id: string): string {
  if (!NOTE_ID.test(id)) throw new NoteError('Not a note id: ' + id + '. Ids look like n_k3f9x.')
  return join(folder(project), id + '.json')
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

async function save(note: Note): Promise<Note> {
  const parsed = NoteSchema.safeParse(note)
  if (!parsed.success) throw new NoteError(z.prettifyError(parsed.error))
  const valid = parsed.data
  await mkdir(folder(valid.project), { recursive: true })
  const file = fileOf(valid.project, valid.id)
  // pid in the tmp name: two writers never share a tmp file. rename is atomic
  // on one disk, so a reader never sees half a note.
  const tmp = file + '.' + process.pid + '.tmp'
  await writeFile(tmp, JSON.stringify(valid, null, 2) + '\n')
  await rename(tmp, file)
  return valid
}

async function readNote(file: string): Promise<Note | null> {
  try {
    const parsed = NoteSchema.safeParse(JSON.parse(await readFile(file, 'utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null // broken or half-copied file: skip it, keep the board working
  }
}

const kindRank = (kind: Kind) => KINDS.indexOf(kind)

/** Every note of the project, done or not, any chat: what needs you first, then oldest first. */
export async function listNotes(project: string): Promise<Note[]> {
  const dir = folder(project)
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.json'))
  const notes = (await Promise.all(names.map((n) => readNote(join(dir, n))))).filter(
    (n): n is Note => n !== null,
  )
  return notes.sort(
    (a, b) => kindRank(a.kind) - kindRank(b.kind) || a.createdAt.localeCompare(b.createdAt),
  )
}

const BASE36 = 'abcdefghijklmnopqrstuvwxyz0123456789'
const newId = () =>
  'n_' + Array.from({ length: 5 }, () => BASE36.charAt(randomInt(BASE36.length))).join('')

export async function addNote(input: {
  project: string
  text: string
  kind: Kind
  scope: Scope
  session: string | null
  actions?: string[]
}): Promise<Note> {
  if (input.scope === 'chat' && input.session === null) {
    throw new NoteError('A chat note needs a Claude Code session. Use scope "project" instead.')
  }
  let id = newId()
  while (await exists(fileOf(input.project, id))) id = newId()
  const now = new Date().toISOString()
  return save({ v: 1, id, ...input, actions: input.actions ?? [], done: false, createdAt: now, updatedAt: now })
}

async function getNote(project: string, id: string): Promise<Note> {
  const note = await readNote(fileOf(project, id))
  if (!note) throw new NoteError('No note ' + id + ' in this project. List notes to see the ids.')
  return note
}

export async function updateNote(
  project: string,
  id: string,
  patch: Partial<Pick<Note, 'text' | 'kind' | 'done' | 'actions'>>,
): Promise<Note> {
  const note = await getNote(project, id)
  return save({ ...note, ...patch, updatedAt: new Date().toISOString() })
}

export async function deleteNote(project: string, id: string): Promise<Note> {
  const note = await getNote(project, id)
  await rm(fileOf(project, id))
  return note
}

/** One line per note, for the CLI, the MCP text result, and Claude's context. */
export const noteLine = (n: Note) =>
  '[' + n.kind + ' ' + n.id + '] ' + n.text +
  (n.actions.length > 0 ? ' (quick replies: ' + n.actions.join(' / ') + ')' : '') +
  (n.scope === 'chat' ? ' (this chat)' : '')
