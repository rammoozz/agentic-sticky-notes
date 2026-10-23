---
name: note
description: Pin a sticky note the user sees beside the chat, so it is not lost in a long talk. Use on your own, without being asked, when you need the user (a choice only they can make, a login or key, an approval, a step they must do by hand), when a decision is made, when work is pushed to later, or when a rule or fact should stick. Also use on "note that", "remember", "pin", "don't forget", "later".
argument-hint: [what to pin]
---

# Sticky notes

Asked to pin: $ARGUMENTS

If the line above has text after the colon, pin exactly that and stop.

## When to pin

Pin a `human` note whenever you need the user: a choice only they can make, a login or key, an approval, or a step they must do by hand. Also pin decisions you make together and work pushed to later. If the user's CLAUDE.md says when to pin, follow that instead.

## Kinds

- `human`: you need the user. Say what you need in one line, e.g. "log in to Stripe so I can read the webhook secret". When there are clear answers, add `actions`: up to 3 short replies, your recommended one first, e.g. `["Deploy now", "Not yet"]`. Pressing one sends it to you as the user's message. If you can keep going with a safe default, pin it and keep going; say which default you took. If you can't, pin it and stop.
- `todo`: work for later.
- `decision`: what was chosen, and the short why.
- `remember`: a rule or fact to keep, e.g. "staging db is read-only".

## How

- One idea per note, under 120 characters. Todos start with a verb.
- `scope: "project"` if it is true for the repo beyond this talk. `scope: "chat"` if it only matters in this conversation.
- Call `note_list` first and use `note_update` instead of adding a near copy.
- At most 2 new notes per turn unless the user asks for more.
- When a note is handled, mark it done with `note_update` (`done: true`) right away. That includes `human` notes the user answered in the chat.
- Tell the user what you pinned in a few words. Don't paste the note list into the reply.
- No MCP tools (for example in a subagent)? Use Bash: `sticky add "text" --kind human` (add `--chat` for a chat note), `sticky ls`, `sticky done <id>`.
