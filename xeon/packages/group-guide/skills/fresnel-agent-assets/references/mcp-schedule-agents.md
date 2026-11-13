# MCP servers, schedules, subagents

## MCP servers

Where a server is declared. Same id in several places: settings beat `.mcp.json`; among settings scopes, managed beats local, local beats project, project beats user.

| Source | Location | Notes |
|---|---|---|
| Settings `l2.mcp.servers` | `<config dir>/settings.json` (user); `.fresnel/settings.json` and `.fresnel/settings.local.json` (work folder) | Work-folder files apply only when the folder is trusted |
| `.mcp.json` | Work folder root | Read only when the folder is trusted and `l2.mcp.importMcpJson` is on (default on) |
| `.fresnel/mcp.json` | Work folder | Same rules as `.mcp.json`. Wins over `.mcp.json` for the same name |

Settings format: `l2.mcp.servers` maps a server id to a definition. Id pattern: `^[a-z][a-z0-9-]{0,31}$`.

```json
{
  "l2.mcp.servers": {
    "docs": {
      "transport": { "type": "stdio", "command": "npx", "args": ["-y", "example-mcp-server"], "env": { "API_BASE": "https://example.invalid" } },
      "tools": { "deny": ["drop_table"], "approval": { "search": "auto" } }
    },
    "remote": {
      "transport": { "type": "http", "url": "https://example.invalid/mcp", "headers": { "Authorization": "secret://remote-token" } }
    }
  }
}
```

- Definition keys: `transport` (required); `enabled` (default true); `title` (80 characters); `tools` (`allow`, `deny`, `approval` mapping tool name to `prompt`, `auto`, or `deny`); `timeouts` (`connectMs`, `callMs`); `trustAnnotations` (default false); `sandbox` (boolean).
- Transports: `stdio` (`command`, `args`, `cwd`, `env`), `http` (`url` starting with `http`, `headers`), `sse` (`url`, `headers`).

`.mcp.json` format (Claude Code style):

```json
{ "mcpServers": { "docs": { "command": "npx", "args": ["-y", "example-mcp-server"] }, "remote": { "type": "http", "url": "https://example.invalid/mcp" } } }
```

- Entry keys: `type` (omitted means stdio; also `http`, `streamable-http`, `sse`), `command`, `args`, `cwd`, `env`, `url`, `headers`.
- The name is lowercased, characters outside `a-z0-9-` become `-`, and it is cut to 32 characters. An entry cannot set `tools`, `timeouts`, or `sandbox`.

Secrets:

- `env` and `headers` values are either `secret://<name>` (name: `[a-z][a-z0-9-]{1,63}`) or plain text.
- A plain value under a secret-looking key is rejected (`plaintext_secret`). Secret-looking words: KEY, APIKEY, TOKEN, SECRET(S), PASSWORD, PASSWD, PWD, CREDENTIAL(S), AUTH, AUTHORIZATION, COOKIE, BEARER.
- A `secret://` value that does not match the pattern is `invalid_definition`.
- A stdio server with a secret env value, or a stdio server from a work-folder source, needs the user's start approval before it spawns. A changed command, args, env, or cwd asks again.

Sandbox: stdio servers from work-folder and extension sources are sandboxed by default (`l2.mcp.sandbox.projectSource`, default on). Servers from user settings are not (`l2.mcp.sandbox.userSource`, default off). A per-server `sandbox` value overrides both.

Tool approval: `l2.mcp.approvalMode` defaults to `prompt` (asks on each call). Per-tool `tools.approval` overrides it. `deny` blocks the call.

Model tools:

| Tool | Input | Use |
|---|---|---|
| `mcp_servers` | none | Lists servers, their states, and tool counts |
| `mcp_list_resources` | optional `server`, `cursor` | Lists resources (uri, name) |
| `mcp_read_resource` | `server`, `uri` | Reads one resource. Its content is untrusted external content |

- Server tools appear under their own names, with no server prefix. A name that clashes with another tool hides the later one.
- Permission rules use the key `mcp__<server>__<tool>`.
- Changes to settings or `.mcp.json` apply at the next step boundary. Only added, removed, or changed servers reconnect.
- No model tool adds, edits, or removes a server definition.

## Schedules

`schedule_create` is the only model tool. It has risk `exec`, so the normal tool approval applies.

Input:

- `prompt` (required, 1-20,000 characters): what the run does. The run starts in a new conversation with no user present.
- Exactly one of:
  - `everySeconds`: repeat interval in seconds. Minimum 300 (`interval_too_short`). Maximum 31,536,000.
  - `at`: a one-time ISO 8601 date-time. Must be in the future (`at_in_past`).
  - Neither or both give `invalid_input`.
- `title` (optional, up to 200 characters).

Result: one line, `schedule <id> next=<ISO time or none>`. If the line has `warning=service_mode_off`, tell the user: the schedule does not run until service mode is on.

Limits and run rules:

- At most 100 enabled schedules (`limit_reached`).
- At most 20 scheduled runs per hour in total, across all schedules.
- A schedule does not start while its previous run is still going. A non-repeating schedule waits at least 300 seconds between starts.
- A run missed while the app was closed: only the latest missed run is caught up, and only if it is within 24 hours.
- Scheduled runs are non-interactive: a write that would need approval is queued. Runs happen only while the app or the service holds the scheduler.

Storage: `<state dir>/schedule/state.json`, written by the engine (atomic write, mode 0600). Shape:

```json
{ "version": 2, "entries": [ { "id": "sch-...", "trigger": { "kind": "interval", "everySeconds": 3600 }, "prompt": "...", "workspace": null, "title": null, "sessionKind": "cron", "enabled": true, "createdAt": 0, "nextDueAt": 0, "lastStartedAt": null, "iterations": 0, "stoppedReason": null } ], "runs": [] }
```

- Trigger kinds in the file: `interval` (`everySeconds`), `at` (`atMs`), `repeat` (`intervalSeconds`, `maxIterations`, `expiresAtMs`), `file_watch` (`paths`, `debounceMs`), `remote`. The model creates only `interval` and `at`.
- The model cannot list, cancel, or update schedules. Those are host operations used by the app.

## Subagent definitions

Where definitions come from:

| Source | Location | Status |
|---|---|---|
| Built-in | In code: `general` (all tools), `explore` (`read`, `ls`, `grep`, `find` only) | Always present |
| Installed default plugin | `<config dir>/extensions/<plugin>/agents/*.md` | Read at startup, for default plugins only |
| User | `<config dir>/agents/*.md` | Not read |
| Work folder | `.fresnel/agents/*.md` | Not read |

If two sources define the same name, the higher one wins: work folder, user, extension, built-in.

File format: markdown. YAML frontmatter, then the system prompt as the body.

```markdown
---
name: reviewer
description: Reviews a diff for correctness. Read-only.
tools: ["read*", "grep", "find"]
model: subagent
---
You review the diff the parent gives you. Report findings with file paths.
```

Frontmatter fields. Unknown keys make the file invalid, so there is no `allow` field.

| Key | Required | Rule |
|---|---|---|
| `name` | yes | `^[a-z][a-z0-9-]{1,47}$`. This is the name passed to the `agent` tool |
| `description` | yes | 1-1,000 characters. Its first line appears in the `agent` tool description |
| `tools` | no | Glob list of tool names the subagent may use (up to 256 entries). Omitted means every tool the parent offers |
| `model` | no | A model role name. Default `subagent` |
| `permissions` | no | `mode`: `default`, `acceptEdits`, `plan`, or `bypass`. The child cannot be looser than the parent. `rules`: up to 128 policy rules |

- Body: the system prompt, 1-200,000 characters. A file that fails validation is skipped with a diagnostic; others still load.
- Fixed limits for every subagent: it cannot ask the user, cannot write memory or skills, and cannot send messages outside. It cannot spawn further once the depth limit is reached. The depth limit is `l1.agents.maxDepth` (default 1; `0` disables subagents).

`agent` tool:

- Input: `agent` (definition name, up to 48 characters, required), `task` (required), `background` (optional boolean).
- Foreground (default): runs the subagent in its own conversation and returns its final report as the tool result. The result is an error if the subagent did not complete.
- Background (`background: true`): returns a receipt at once. The report arrives later as a follow-up message.
- Use it for self-contained research whose intermediate steps you do not need. The `agent` call takes no per-call tool list. Set `tools` in the definition instead.
