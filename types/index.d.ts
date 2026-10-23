// The one definition of a note. Self-contained on purpose: the engine reads
// this contract for the mod's $.state and refuses imports in it. src/types.ts
// re-exports these for the CLI, the MCP server and the store.

export type Kind = 'human' | 'todo' | 'decision' | 'remember'
export type Scope = 'project' | 'chat'

export interface Note {
  v: 1
  id: string // "n_" + 5 base36 chars, e.g. "n_k3f9x"
  text: string // one idea, 1-280 chars
  kind: Kind
  scope: Scope
  session: string | null // Claude Code session that pinned it
  project: string // git root (or folder) it belongs to
  done: boolean
  /** Quick replies for a human note, the recommended one first. Pressing one answers Claude. */
  actions: string[]
  createdAt: string // ISO 8601
  updatedAt: string
}

declare module 'claude-code' {
  interface PluginState {
    'sticky-notes': { notes: Shaped<Note[]>; showDone: boolean }
  }
}
