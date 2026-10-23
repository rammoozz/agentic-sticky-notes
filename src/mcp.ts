import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import pkg from '../package.json' with { type: 'json' }
import { NoteSchema } from './note.ts'
import { addNote, deleteNote, listNotes, NoteError, noteLine, projectRoot, updateNote } from './store.ts'
import { isVisible, KINDS, NOTE_ID, SCOPES, type Note } from './types.ts'

// The mod stamps the live session id here. Other MCP apps leave it empty.
const session = z.string().optional().describe('Filled in automatically. Leave empty.')
const id = z.string().regex(NOTE_ID).describe('The note id, e.g. n_k3f9x')
const text = z.string().trim().min(1).max(280)
const actions = z
  .array(z.string().trim().min(1).max(40))
  .max(3)
  .describe('For a human note: up to 3 short replies the user can press, your recommended one first, e.g. ["Deploy now", "Not yet"].')

const ADD_DESCRIPTION =
  'Pin a short sticky note the user sees beside the chat, so it is not lost in a long talk. ' +
  'Use kind "human" when you need the user: a choice only they can make, a login or key, an approval, ' +
  'or a manual step. Give it actions: short replies the user can press, your recommended one first. ' +
  'Then keep going with a safe default if you can. ' +
  'Also pin decisions ("decision"), work pushed to later ("todo"), and rules or facts to keep ("remember"). ' +
  'One idea per note. Use scope "chat" if it only matters in this conversation.'

type Reply = {
  content: { type: 'text'; text: string }[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

const reply = (message: string, structuredContent: Record<string, unknown>): Reply => ({
  content: [{ type: 'text', text: message }],
  structuredContent,
})

/** A wrong id is Claude's to fix, so it comes back as a tool error, not a crash. */
async function guarded(run: () => Promise<Reply>): Promise<Reply> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof NoteError) return { content: [{ type: 'text', text: err.message }], isError: true }
    throw err
  }
}

export async function startMcp(): Promise<void> {
  const project = projectRoot(process.env.CLAUDE_PROJECT_DIR ?? process.cwd())
  const sessionOf = (stamped: string | undefined) =>
    stamped ?? process.env.CLAUDE_CODE_SESSION_ID ?? null
  const server = new McpServer({ name: 'sticky-notes', version: pkg.version })

  server.registerTool(
    'note_add',
    {
      title: 'Pin a sticky note',
      description: ADD_DESCRIPTION,
      inputSchema: {
        text,
        kind: z.enum(KINDS).default('todo'),
        scope: z.enum(SCOPES).default('project'),
        actions: actions.default([]),
        session,
      },
      outputSchema: { note: NoteSchema },
    },
    (args) =>
      guarded(async () => {
        const note = await addNote({
          project,
          text: args.text,
          kind: args.kind,
          scope: args.scope,
          actions: args.actions,
          session: sessionOf(args.session),
        })
        return reply('Pinned ' + noteLine(note), { note })
      }),
  )

  server.registerTool(
    'note_list',
    {
      title: 'List sticky notes',
      description:
        'List the sticky notes of this project and this chat, what needs the user first. ' +
        'Done notes are left out unless include_done is true.',
      inputSchema: { include_done: z.boolean().default(false), session },
      outputSchema: { notes: z.array(NoteSchema) },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const viewer = sessionOf(args.session)
      const notes = (await listNotes(project)).filter(
        (n) => isVisible(n, viewer) && (args.include_done || !n.done),
      )
      return reply(notes.length ? notes.map(noteLine).join('\n') : 'No notes.', { notes })
    },
  )

  server.registerTool(
    'note_update',
    {
      title: 'Change a sticky note',
      description:
        'Change a note\'s text or kind, or mark it done (done: true) the moment the work is handled. ' +
        'Prefer this over adding a near copy.',
      inputSchema: {
        id,
        text: text.optional(),
        kind: z.enum(KINDS).optional(),
        done: z.boolean().optional(),
        actions: actions.optional(),
        session,
      },
      outputSchema: { note: NoteSchema },
    },
    (args) =>
      guarded(async () => {
        const patch: Partial<Pick<Note, 'text' | 'kind' | 'done' | 'actions'>> = {}
        if (args.text !== undefined) patch.text = args.text
        if (args.kind !== undefined) patch.kind = args.kind
        if (args.done !== undefined) patch.done = args.done
        if (args.actions !== undefined) patch.actions = args.actions
        const note = await updateNote(project, args.id, patch)
        return reply('Updated ' + noteLine(note) + (note.done ? ' (done)' : ''), { note })
      }),
  )

  server.registerTool(
    'note_delete',
    {
      title: 'Delete a sticky note',
      description: 'Delete a note for good. To check one off, use note_update with done: true instead.',
      inputSchema: { id, session },
      outputSchema: { note: NoteSchema },
      annotations: { destructiveHint: true },
    },
    (args) =>
      guarded(async () => {
        const note = await deleteNote(project, args.id)
        return reply('Deleted ' + noteLine(note), { note })
      }),
  )

  await server.connect(new StdioServerTransport())
}
