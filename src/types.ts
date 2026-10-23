// No runtime imports on purpose: the mod in hooks/ imports this file, and a mod
// may only import local files and 'claude-code'.
import type { Kind, Note, Scope } from '../types/index.d.ts'

export type { Kind, Note, Scope }

/** In the order the pane and `sticky context` list them: what needs you first. */
export const KINDS = ['human', 'todo', 'decision', 'remember'] as const satisfies readonly Kind[]
export const SCOPES = ['project', 'chat'] as const satisfies readonly Scope[]

// Stops compiling if types/index.d.ts gains a kind or scope these lists lack.
const allKinds: [Exclude<Kind, (typeof KINDS)[number]>] extends [never] ? true : false = true
const allScopes: [Exclude<Scope, (typeof SCOPES)[number]>] extends [never] ? true : false = true
void allKinds
void allScopes

/** Project notes show everywhere in the project; chat notes only in their own session. */
export const isVisible = (note: Note, session: string | null): boolean =>
  note.scope === 'project' || note.session === session
