import { z } from 'zod'
import { KINDS, SCOPES, type Note } from './types.ts'

export const NoteSchema = z.object({
  v: z.literal(1),
  id: z.string().regex(/^n_[a-z0-9]{5}$/),
  text: z.string().trim().min(1).max(280),
  kind: z.enum(KINDS),
  scope: z.enum(SCOPES),
  session: z.string().nullable(),
  project: z.string().min(1),
  done: z.boolean(),
  // Older notes have no actions: they read as none.
  actions: z.array(z.string().trim().min(1).max(40)).max(3).default([]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}) satisfies z.ZodType<Note>
