---
name: fresnel-agent-assets
description: Use when creating, editing, or deciding where a Fresnel skill, memory entry, MCP server, schedule, or subagent definition belongs.
---

# Fresnel agent assets

Find the row for the asset, then read its reference file before you write. "Work folder" means the project folder of the current conversation.

| Asset | File location | Manage with |
|---|---|---|
| User skill | `<data dir>/skills/<name>/SKILL.md` | `skill_view` to read; `skill_manage` to create, edit, patch, write_file, remove |
| Work-folder skill | `<work folder>/.fresnel/skills/<name>/SKILL.md`, only if the folder is trusted | `skill_view` only. Agents cannot write it |
| User-info memory | `<data dir>/memory/USER.md` (store `user`) | `memory_manage` |
| Environment memory | `<data dir>/memory/MEMORY.md` (store `env`) | `memory_manage` |
| MCP server | `l2.mcp.servers` in `<config dir>/settings.json`, or in `.fresnel/settings.json` and `.fresnel/settings.local.json` of a trusted work folder. `.fresnel/mcp.json` in a trusted work folder is read too. A `.mcp.json` from another tool is not read; the user can import it as a plugin draft | No model tool adds, edits, or removes one. Inspect with `mcp_servers`, `mcp_list_resources`, `mcp_read_resource` |
| Schedule | `<state dir>/schedule/state.json` (engine-written) | `schedule_create` only. No model tool lists, cancels, or updates |
| Subagent definition | `<config dir>/extensions/<plugin>/agents/<name>.md` (installed default plugins only) | `agent` tool runs a definition by name. Files in `<config dir>/agents` or `.fresnel/agents` are not loaded |

Base directories:

| Dir | macOS | Linux | Windows |
|---|---|---|---|
| `<data dir>` | `~/Library/Application Support/fresnel` | `$XDG_DATA_HOME/fresnel`, else `~/.local/share/fresnel` | `%LOCALAPPDATA%\fresnel\data` |
| `<config dir>` | `~/Library/Application Support/fresnel/config` | `$XDG_CONFIG_HOME/fresnel`, else `~/.config/fresnel` | `%APPDATA%\fresnel` |
| `<state dir>` | `~/Library/Application Support/fresnel/state` | `$XDG_STATE_HOME/fresnel`, else `~/.local/state/fresnel` | `%LOCALAPPDATA%\fresnel\state` |

If `FRESNEL_HOME` is set, the three dirs are `$FRESNEL_HOME/data`, `$FRESNEL_HOME/config`, and `$FRESNEL_HOME/state`.

Rules:

- Read before you write. `skill_view` returns a `treeHash`; pass it as `baseHash`. Memory writes use the `fileHash` from the latest snapshot or write result.
- A write can wait for the user's approval, and the turn pauses until they answer. `queued` means a proposal the user must approve. `approval_denied` means the user refused: do not retry the same change.
- Never write secret values into any asset. In MCP config, reference them as `secret://<name>`.
- Keep each fact in one place. Do not write the same fact to both memory stores, or to memory and a skill.

Reference files:

| File | Read it for |
|---|---|
| `references/skills-and-memory.md` | Skill format, roots and precedence, `skill_view` and `skill_manage`, memory format and `memory_manage`, threat scan, approval, settings |
| `references/mcp-schedule-agents.md` | MCP server declaration and tools, `schedule_create` rules and storage, subagent definition format and the `agent` tool |
