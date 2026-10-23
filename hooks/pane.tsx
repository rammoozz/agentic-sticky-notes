import { atom, read, update } from 'claude-code'
import type { EngineInterface, McpToolResult, Register } from 'claude-code'
import { isVisible, type Kind, type Note } from '../src/types.ts'

// The mod holds no note logic: it reads and writes through the plugin's own
// MCP server, so the store and its zod checks stay the only path to the files.

const PANE = 'sticky-notes'
const NOTE_TOOL = /^mcp__plugin_sticky-notes_notes__/
const ADD_TOOL = 'mcp__plugin_sticky-notes_notes__note_add'

// Bump the shape tag when Note changes: it declines what an older version stored.
const notes = atom({ plugin: 'sticky-notes', key: 'notes' } as const, [], { shape: 'note-v2' })
const showDone = atom({ plugin: 'sticky-notes', key: 'showDone' } as const, false)
// True once the person closes the pane: only a note that needs them opens it again.
const hidden = atom({ plugin: 'sticky-notes', key: 'hidden' } as const, false)

const LABEL: Record<Kind, string> = {
  human: 'NEEDS YOU',
  todo: 'TODO',
  decision: 'DECISION',
  remember: 'REMEMBER',
}
const COLOR: Record<Kind, string> = { human: 'red', todo: 'yellow', decision: 'green', remember: 'cyan' }

/** Calls one of the `notes` server's tools, stamped with this session's live id. */
async function callNotes($: EngineInterface, tool: string, args: Record<string, unknown>) {
  try {
    const conn = await $.mcp.connect('notes')
    if (!conn.isConnected) return undefined
    const res = await $.mcp.call(conn.server, tool, { ...args, session: await $.session.id() })
    return res.isError ? undefined : res
  } catch {
    return undefined // server not up yet, or its tools are turned off: the next poll tries again
  }
}

/**
 * The notes in a note_list result. Claude Code hands a tool's structured result
 * back as JSON text in `content` (seen on 2.1.309), so read either shape.
 */
function notesOf(res: McpToolResult | undefined): Note[] | undefined {
  if (!res) return undefined
  let data = res.structuredContent
  const first = res.content[0]
  if (data === undefined && first?.text !== undefined) {
    try {
      data = JSON.parse(first.text)
    } catch {
      return undefined
    }
  }
  const list = (data as { notes?: unknown } | null | undefined)?.notes
  return Array.isArray(list) ? (list as Note[]) : undefined
}

async function refresh($: EngineInterface): Promise<Note[]> {
  const list = notesOf(await callNotes($, 'note_list', { include_done: true }))
  if (list) await update($, notes, () => list)
  return list ?? []
}

async function setDone($: EngineInterface, id: string, done: boolean) {
  await callNotes($, 'note_update', { id, done })
  await refresh($)
}

async function remove($: EngineInterface, id: string) {
  await callNotes($, 'note_delete', { id })
  await refresh($)
}

/** A quick reply answers Claude as the user's own message, and checks the note off. */
async function answer($: EngineInterface, note: Note, reply: string) {
  // Not awaited: submit waits until Claude is idle, and the press shouldn't hang on that.
  void $.prompt.submit({ text: 'Re sticky note ' + note.id + ' (' + note.text + '): ' + reply, asUser: true })
  await setDone($, note.id, true)
}

async function openPane($: EngineInterface, focus: boolean) {
  await update($, hidden, () => false)
  await $.ui.open({ id: PANE, title: 'Sticky notes', closeOnEscape: true, ...(focus ? { focus: true } : {}) })
}

async function closePane($: EngineInterface) {
  await update($, hidden, () => true)
  await $.ui.close({ id: PANE })
}

async function toggleDone($: EngineInterface) {
  await update($, showDone, (shown) => !shown)
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const list = await refresh($)
    // Picks up notes changed by the CLI or another session: mods can't watch files.
    $.clock.every(3000, () => void refresh($))
    const session = await $.session.id()
    if (list.some((n) => !n.done && isVisible(n, session)) && !(await read($, hidden))) {
      void openPane($, false)
    }
    await $.command.register({ name: 'notes', description: 'Show or hide the sticky notes pane' })
    return next(e)
  })

  // /clear, /resume and /branch start over $.state, and session.start does not fire again.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await refresh($)
    return next(e)
  }).catch(($, e, next) => next(e)) // a failed refresh must not hold up the session

  // /notes toggles the pane.
  on('command.run', { command: 'notes' }, async ($) => {
    if ((await $.ui.panes()).some((p) => p.id === PANE)) {
      await closePane($)
    } else {
      await refresh($)
      await openPane($, true)
    }
    return {}
  })

  // Closed with its close mark or Esc: remember it, so plain notes don't pop it back up.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await update($, hidden, () => true)
    return next(e)
  }).catch(($, e, next) => next(e)) // never keep the pane from closing

  // The MCP server keeps the session id it was started with, which goes stale
  // after /clear. Stamp the live one onto every note tool call.
  on('tool.call', { tool: NOTE_TOOL }, async ($, e, next) => {
    // The matcher only lets note tools through, which take a session argument.
    const result = await next({ ...e, session: await $.session.id() } as typeof e)
    await refresh($)
    if (e.tool === ADD_TOOL && !result.deny && !result.isError) {
      const needsYou = e.kind === 'human'
      if (needsYou || !(await read($, hidden))) void openPane($, false)
      if (needsYou) void $.ui.notify('Needs you: ' + String(e.text), { title: 'Sticky note' })
    }
    return result
  }).catch(($, e, next) => next(e)) // fail open: a broken stamp or redraw never blocks a note

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const session = await $.session.id()
    const all = (await read($, notes)).filter((n) => isVisible(n, session))
    const shown = await read($, showDone)
    const open = all.filter((n) => !n.done)
    const done = all.filter((n) => n.done)
    const needYou = open.filter((n) => n.kind === 'human').length

    // The quote border already leaves a blank row above and below each card.
    const card = (n: Note) => (
      <Box key={n.id} flexDirection="column" borderStyle="quote" borderColor={n.done ? 'gray' : COLOR[n.kind]}>
        <Box flexDirection="row" columnGap={2}>
          <Text dimColor>
            {LABEL[n.kind]} · {n.id}
          </Text>
          <Box flexGrow={1} />
          <Button
            key={'done-' + n.id}
            label={n.done ? 'undo' : 'done'}
            plain
            onPress={() => setDone($, n.id, !n.done)}
          />
          <Button key={'rm-' + n.id} label="delete" plain dimColor onPress={() => remove($, n.id)} />
        </Box>
        <Text dimColor={n.done} strikethrough={n.done}>
          {n.text}
        </Text>
        {!n.done && n.actions.length > 0 && (
          <Box flexDirection="row" columnGap={2}>
            {n.actions.map((reply, i) => (
              // The first reply is the one Claude recommends, so it is the one that stands out.
              <Button key={'reply-' + n.id + '-' + i} label={reply} plain={i > 0 || undefined} onPress={() => answer($, n, reply)} />
            ))}
          </Box>
        )}
      </Box>
    )

    const section = (title: string, list: Note[]) =>
      list.length === 0 ? null : (
        <Box key={title} flexDirection="column">
          <Text dimColor>{title}</Text>
          {list.map(card)}
        </Box>
      )

    const closeButton = <Button key="close" label="close" plain dimColor onPress={() => closePane($)} />

    if (all.length === 0) {
      return (
        <Box flexDirection="column" rowGap={1}>
          <Box flexDirection="row">
            <Text>No notes for this project yet.</Text>
            <Box flexGrow={1} />
            {closeButton}
          </Box>
          <Text dimColor>Claude pins what needs you, decisions and todos here as you talk.</Text>
          <Text dimColor>From a terminal: sticky add "text"</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text weight="semibold">
            {open.length} open{needYou > 0 ? ' · ' + needYou + ' need you' : ''}
          </Text>
          <Box flexGrow={1} />
          {closeButton}
        </Box>
        <Text> </Text>
        {section('THIS CHAT', open.filter((n) => n.scope === 'chat'))}
        {section('PROJECT', open.filter((n) => n.scope === 'project'))}
        {done.length > 0 && (
          <Box flexDirection="row" columnGap={2}>
            <Text dimColor>{done.length} done</Text>
            <Button key="toggle-done" label={shown ? 'hide' : 'show'} plain onPress={() => toggleDone($)} />
          </Box>
        )}
        {shown && done.length > 0 && section('DONE', done)}
      </Box>
    )
  })
}
