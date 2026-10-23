# Sticky Notes

Sticky notes Claude pins while it works, so nothing gets lost in a long chat. The main one: when Claude needs you (a choice only you can make, a login, an approval, a manual step), it pins a red **NEEDS YOU** note and your terminal sends a notification. It also pins decisions, todos for later, and rules to keep.

Notes show in a pane beside the chat in Claude Code. They come back into Claude's context at every session start, `/clear`, resume and `/compact`. They are plain JSON files, one per note, in `~/.sticky-notes/<project>/`, so a `sticky` CLI can read and change them from any terminal.

## What's in it

| Part | What it does |
| :- | :- |
| MCP server `notes` | Tools `note_add`, `note_list`, `note_update`, `note_delete`. Works in any MCP app. |
| `sticky` CLI | `sticky add "text" --kind human`, `sticky ls`, `sticky done <id>`, `sticky undo <id>`, `sticky edit <id> "text"`, `sticky rm <id>` |
| Skill `note` | Tells Claude when to pin (your CLAUDE.md can change the rule). Also runs as `/sticky-notes:note <text>`. |
| SessionStart hook | Hands Claude the open notes (up to 25) when a session starts, clears, resumes or compacts. |
| Mod (Claude Code only) | The pane, `/notes` to open it, the notification for `human` notes, and the live session id on note tool calls. |

**Project** notes show in every session in the repo (the git root, so starting Claude in `src/` is the same board). **Chat** notes show only in the conversation that pinned them. Claude picks for each note.

## Install

Needs Node 22.18 or later. Tested with Claude Code 2.1.309. Mods are new and can change between Claude Code releases. If the mod stops loading, everything except the pane keeps working.

Install from GitHub, in one line at the Claude Code prompt:

```sh
/plugin install sticky-notes --marketplace rammoozz/agentic-sticky-notes
```

Or load a local copy for one session:

```sh
claude --plugin-dir /path/to/agentic-sticky-notes
```

By default Claude pins when it needs you, when you decide something, and when work is pushed to later. For your own rule, add a line to your CLAUDE.md, for example: `Pin sticky notes only when you need me.`

To use `sticky` in your own terminal, run `npm link` in this repo. Inside Claude Code, the plugin puts `sticky` on the Bash tool's PATH for you.

### Other MCP apps

Point them at the same server. Notes go to the same files:

```json
{ "mcpServers": { "sticky-notes": { "command": "node", "args": ["/path/to/agentic-sticky-notes/dist/sticky.js", "mcp"] } } }
```

They don't get the pane. Chat notes there use the session id the server started with.

## Develop

```sh
npm install
npm run check          # tsc (src + mod), node tests, build dist/sticky.js
claude plugin validate .
claude plugin test     # mod tests in hooks/*.test.tsx
```

`dist/sticky.js` is committed so installs need no `npm install`. Run `npm run build` before you commit.

The landing page in `docs/` is the Firebase Hosting site `agentic-sticky` (https://agentic-sticky.web.app). Deploy it with `firebase deploy --only hosting`. Bump `version` in `.claude-plugin/plugin.json` when the plugin changes, or installed copies won't update. `STICKY_NOTES_HOME` moves the notes folder, which is handy for tests.
