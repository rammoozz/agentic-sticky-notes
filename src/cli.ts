import { basename } from 'node:path'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { startMcp } from './mcp.ts'
import { addNote, deleteNote, listNotes, NoteError, noteLine, projectRoot, updateNote } from './store.ts'
import { isVisible, KINDS, type Kind, type Note } from './types.ts'

const HELP = `sticky: sticky notes for this project

  sticky add <text> [--kind ${KINDS.join('|')}] [--chat] [--action <reply>]...
  sticky ls [--all] [--json]
  sticky done <id>
  sticky undo <id>
  sticky edit <id> <text>
  sticky rm <id>
  sticky context    SessionStart hook: reads the hook JSON on stdin
  sticky mcp        start the MCP server on stdio`

/** The most notes handed to Claude at session start, to keep the context small. */
const CONTEXT_CAP = 25

const HookInput = z.object({ session_id: z.string().optional(), cwd: z.string().optional() })

const isKind = (k: string): k is Kind => (KINDS as readonly string[]).includes(k)

function needId(id: string | undefined): string {
  if (!id) throw new NoteError('Give a note id, e.g. sticky done n_k3f9x')
  return id
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ''
  let input = ''
  for await (const chunk of process.stdin) input += String(chunk)
  return input
}

function parseHookInput(raw: string): z.infer<typeof HookInput> {
  try {
    return HookInput.parse(JSON.parse(raw || '{}'))
  } catch {
    return {}
  }
}

async function context(): Promise<void> {
  const input = parseHookInput(await readStdin())
  const project = projectRoot(process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd())
  const session = input.session_id ?? process.env.CLAUDE_CODE_SESSION_ID ?? null
  const open = (await listNotes(project)).filter((n) => !n.done && isVisible(n, session))
  if (open.length === 0) return
  const shown = open.slice(0, CONTEXT_CAP)
  const lines = [
    'Sticky notes for ' + basename(project) + ' (sticky-notes plugin). Keep them in mind. ' +
      'When one is handled, mark it done with note_update.',
    ...shown.map((n) => '- ' + noteLine(n)),
  ]
  if (open.length > shown.length) lines.push('- and ' + (open.length - shown.length) + ' more: call note_list')
  console.log(lines.join('\n'))
}

function row(n: Note, session: string | null): string {
  const where = n.scope === 'project' ? '' : n.session === session ? '  (this chat)' : '  (other chat)'
  const replies = n.actions.map((a) => '[' + a + ']').join(' ')
  return '  ' + n.kind.padEnd(10) + n.id + '  ' + n.text + (replies ? '  ' + replies : '') + where + (n.done ? '  (done)' : '')
}

async function main(argv: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      kind: { type: 'string', short: 'k' },
      chat: { type: 'boolean' },
      action: { type: 'string', multiple: true },
      all: { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  const [command, ...rest] = positionals
  const project = projectRoot(process.cwd())
  const session = process.env.CLAUDE_CODE_SESSION_ID ?? null

  switch (command) {
    case 'add': {
      const kind = values.kind ?? 'todo'
      if (!isKind(kind)) throw new NoteError('--kind must be one of: ' + KINDS.join(', '))
      const note = await addNote({
        project,
        text: rest.join(' '),
        kind,
        scope: values.chat ? 'chat' : 'project',
        session,
        actions: values.action ?? [],
      })
      console.log('pinned ' + noteLine(note))
      return
    }
    case 'ls': {
      const all = await listNotes(project)
      const notes = values.all ? all : all.filter((n) => !n.done && isVisible(n, session))
      if (values.json) {
        console.log(JSON.stringify(notes, null, 2))
        return
      }
      const open = notes.filter((n) => !n.done).length
      console.log(basename(project) + ' · ' + open + ' open')
      for (const n of notes) console.log(row(n, session))
      return
    }
    case 'done':
    case 'undo': {
      const note = await updateNote(project, needId(rest[0]), { done: command === 'done' })
      console.log((note.done ? 'done ' : 'open ') + noteLine(note))
      return
    }
    case 'edit': {
      const note = await updateNote(project, needId(rest[0]), { text: rest.slice(1).join(' ') })
      console.log('edited ' + noteLine(note))
      return
    }
    case 'rm': {
      const note = await deleteNote(project, needId(rest[0]))
      console.log('deleted ' + noteLine(note))
      return
    }
    case 'context':
      return context()
    case 'mcp':
      return startMcp()
    default:
      console.log(HELP)
      if (command !== undefined && !values.help) process.exitCode = 1
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  const isArgError = err instanceof TypeError && 'code' in err && String(err.code).startsWith('ERR_PARSE_ARGS')
  if (err instanceof NoteError || isArgError) {
    console.error('sticky: ' + err.message)
    process.exit(1)
  }
  throw err
})
