import { expect, test, type TestBody } from 'claude-code/testing'
import type { Note } from '../src/types.ts'

const ADD = 'mcp__plugin_sticky-notes_notes__note_add'
const SERVER = 'plugin:sticky-notes:notes'

const PANE = {
  plugin: 'sticky-notes',
  component: 'Pane',
  requestId: 'sticky-notes',
  props: {
    title: 'Sticky notes',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const note = (id: string, text: string, extra: Partial<Note> = {}): Note => ({
  v: 1,
  id,
  text,
  kind: 'todo',
  scope: 'project',
  session: 'S1',
  project: '/work/shop-api',
  done: false,
  actions: [],
  createdAt: '2026-10-23T12:00:00.000Z',
  updatedAt: '2026-10-23T12:00:00.000Z',
  ...extra,
})

const BOARD: Note[] = [
  note('n_human', 'log in to Stripe', { kind: 'human', scope: 'chat', actions: ['Done, go on', 'Skip Stripe'] }),
  note('n_todo1', 'add rate limit to /login'),
  note('n_other', 'from another chat', { scope: 'chat', session: 'S2' }),
  note('n_done1', 'fix the refresh race', { done: true }),
]

// Stands in for the engine and the notes MCP server beneath the mod.
function engine(on: Parameters<TestBody>[1], board: Note[]) {
  const calls: { tool: string; args: Record<string, unknown> }[] = []
  const opened: string[] = []
  on('session.id', () => ({ value: 'S1' }))
  on('mcp.connect', () => ({ value: { isConnected: true, server: SERVER } }))
  on('mcp.call', (_, e) => {
    calls.push({ tool: e.tool, args: e.args })
    // The shape Claude Code 2.1.309 really returns: the structured result as JSON text.
    return { value: { content: [{ type: 'text', text: JSON.stringify({ notes: board }) }], isError: false } }
  })
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'notes' } }))
  return { calls, opened }
}

test('a note tool call gets the live session id, and a human note notifies', async ($, on) => {
  engine(on, BOARD)
  const seen: Record<string, unknown>[] = []
  const notified: string[] = []
  on('tool.call', (_, e) => {
    seen.push(e)
    return { result: {} }
  })
  on('ui.notify', (_, e) => {
    notified.push(e.text)
    return { value: { isSent: true, channel: 'kitty' } }
  })

  await $.tool.call({ tool: ADD, text: 'log in to Stripe', kind: 'human' })

  expect(seen[0]?.session).toBe('S1')
  expect(notified).toEqual(['Needs you: log in to Stripe'])
})

test('the pane shows this chat and the project, what needs you first', async ($, on) => {
  engine(on, BOARD)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work/shop-api', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /open/ }))?.text).toBe('2 open · 1 need you')
    expect(await ui.find({ type: 'Text', text: 'log in to Stripe' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /NEEDS YOU/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'from another chat' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'fix the refresh race' })).toBeUndefined()
    await ui.unmount()
  }
})

test('done marks the note through the notes server', async ($, on) => {
  const { calls } = engine(on, BOARD)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work/shop-api', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'done-n_todo1' })
  await ui.unmount()

  expect(calls.find((c) => c.tool === 'note_update')?.args).toEqual({
    id: 'n_todo1',
    done: true,
    session: 'S1',
  })
})

test('an empty board says how notes get there', async ($, on) => {
  engine(on, [])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /No notes for this project yet/ })).toBeDefined()
  await ui.unmount()
})

test('a notes server that is down never stops the session from starting', async ($, on) => {
  const registered: string[] = []
  on('session.id', () => ({ value: 'S1' }))
  on('mcp.connect', () => ({ value: { isConnected: true, server: SERVER } }))
  on('mcp.call', () => {
    throw new Error('no connected MCP tool "note_list"')
  })
  on('command.register', (_, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/work/shop-api', surface: 'terminal', isInteractive: true })

  expect(registered).toEqual(['notes'])
})

test('a quick reply answers Claude as the user and checks the note off', async ($, on) => {
  const { calls } = engine(on, BOARD)
  const submitted: { text: string; asUser: boolean }[] = []
  on('prompt.submit', (_, e) => {
    submitted.push({ text: e.text, asUser: 'asUser' in e.origin && e.origin.asUser === true })
    return { text: e.text }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work/shop-api', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'reply-n_human-0' })
  await ui.unmount()

  expect(submitted).toEqual([{ text: 'Re sticky note n_human (log in to Stripe): Done, go on', asUser: true }])
  expect(calls.find((c) => c.tool === 'note_update')?.args).toEqual({ id: 'n_human', done: true, session: 'S1' })
})

test('close keeps the pane shut for plain notes, but a note that needs you opens it again', async ($, on) => {
  const { opened } = engine(on, BOARD)
  on('tool.call', () => ({ result: {} }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'kitty' } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'close' })
  await ui.unmount()

  await $.tool.call({ tool: ADD, text: 'add retries', kind: 'todo' })
  expect(opened).toEqual([])
  await $.tool.call({ tool: ADD, text: 'approve the deploy', kind: 'human' })
  expect(opened).toEqual(['sticky-notes'])
})
