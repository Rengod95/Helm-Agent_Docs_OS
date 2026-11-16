# Settings and scopes

## Scopes and where they live

| Scope | Location | Set by | Notes |
|---|---|---|---|
| `managed` | none defined | none | Not loaded in this build. Writes return `managed_read_only`. |
| `launch` | this conversation's event log | `chat --set`, `/set`, desktop controls | Follows the conversation history, not a file. Key must allow `launch`. |
| `local` | `<work folder>/.fresnel/settings.local.json` | `config set --scope local` | Trusted folder and a conversation in it required. |
| `project` | `<work folder>/.fresnel/settings.json` | `config set --scope project` | Same as `local`. |
| `user` | `<config dir>/settings.json` | `config set` (default) | Hand edits are picked up live. |

User file by OS:

- macOS: `~/Library/Application Support/fresnel/config/settings.json`
- Linux: `$XDG_CONFIG_HOME/fresnel/settings.json` (default `~/.config/fresnel/settings.json`)
- Windows: `%APPDATA%\fresnel\settings.json`
- `FRESNEL_HOME=<dir>` overrides all three: `<dir>/config/settings.json`.

`fresnel config get <key>` prints the exact path in its `source:` line.

## Precedence and merge

- Order: `managed` > `launch` > `local` > `project` > `user`.
- For each key, the highest scope with a valid value wins. Lower values are listed as `shadowed:`.
- A value is skipped if it fails the key's type or range, or its scope is not allowed for the key. The next lower value applies.
- The merge unit is the whole key. Objects and arrays are replaced, not merged.
- Exception: `l1.tools.rules` combines rules from every scope.
- No value anywhere: the default applies.

## Trust for project and local files

- `.fresnel/settings.json` and `settings.local.json` are trust-requiring. A folder with them needs a decision before they apply.
- A folder with no trust-requiring resources is trusted automatically. Writing project or local values still needs an explicit allow for that folder.
- Commands: `fresnel trust status`, `fresnel trust list`, `fresnel trust allow|deny [--scope folder|parent|session]`.
  - `folder`: saved for this folder. `parent`: saved for the parent folder (only if one exists). `session`: this host process only.
- Undecided folders follow `x.loading-trust.defaultProjectTrust` (default `ask`, which means untrusted). `always` trusts; `never` denies.
- Decisions are stored in `<config dir>/trust.json`.

## File format

```json
{ "l1.tools.permissionMode": "acceptEdits", "l1.loop.maxSteps": 50 }
```

- A flat JSON object. Keys are full dotted names. Values match each key's type.
- Unknown keys are kept on write and ignored at runtime.
- Invalid JSON, or a top-level value that is not an object, makes Fresnel ignore the whole file until it is fixed. `config get` warns on stderr with the line and column.
- Fresnel rewrites the file as 2-space JSON and keeps unknown keys.
- `fresnel config schema --scope user --out <file>` writes a JSON Schema for editors.

## Read and write commands

| Task | Command |
|---|---|
| Value, source, shadowed, pending | `fresnel config get <key>... [--json]` |
| Definitions and values | `fresnel config list [--prefix <text>] [--deprecated] [--json]` |
| Set (default scope `user`) | `fresnel config set <key> <value> [--scope user\|project\|local]` |
| Remove a scope's value | `fresnel config reset <key> [--scope user\|project\|local]` |
| JSON Schema of a file | `fresnel config schema --scope managed\|user\|project\|local [--out <file>]` |
| This conversation only | `fresnel chat --set <key>=<value>` (repeatable), or in chat `/set <key> <value>` |
| Default model here | in chat `/model <provider/model>` (sets `l1.models.default`, `launch` scope) |

- `<value>` is parsed as JSON first, then taken as plain text. `config set l0.os.log.level debug` works. `config set l1.loop.maxSteps 50` stores a number. Quote arrays as JSON, for example `'["git status"]'`.
- `config set` does not accept `launch`. Use `chat --set` or `/set`, and only for keys whose allowed scopes include `launch`.
- `--scope project|local` needs a conversation in that work folder.
- Desktop: the settings page has sections (general, shortcuts, notifications, models, secrets, permissions, sandbox, tools, plugins, sessions, connection, execution, data). Keys outside them are changed from the CLI or the settings file editor.
- Wire methods: `settings.get`, `settings.set`, `settings.reset`, `settings.list`, `settings.readFile`, `settings.writeFile`.

`settings.set` checks, in order: unknown key (`settings.unknownKey`), reserved key (`settings.reserved`), scope not allowed (`settings.scopeNotAllowed`), locked by managed (`settings.locked`), secret not a `secret://` reference (`settings.secretValue`), invalid value (`settings.invalidValue`).

## When a change applies

- `live`: at the next read. `nextTurn`: from the next turn. `restart`: after the host restarts.
- `config get` and `config list` print `pending: nextTurn` or `pending: restart` for those keys.

## Key namespaces

Layers follow the docs: F = contracts, X = extension system, L0 = platform, L1 = core, L2 = capabilities, L3 = plugin groups, L4 = apps.

| Prefix | Layer | Contents |
|---|---|---|
| `x.` | X | `x.operations` (budgets, auto-disable, safe mode, trace, hook order), `x.loading-trust` (project trust, extension search paths, isolation restarts), `x.ui` (app policy), `x.primitives` |
| `l0.` | L0 | `l0.os` (log level, telemetry, directories), `l0.store`, `l0.exec` (shell timeouts, output spill), `l0.secrets` (secret use approval, age key), `l0.process`, `l0.sandbox` |
| `l1.` | L1 | `l1.tools` (permission mode, rules, output limits, unattended approval), `l1.models` (default model, thinking level, routing), `l1.loop`, `l1.agents` (subagent depth and concurrency), `l1.context`, `l1.persistence`, `l1.tasks` |
| `l2.` | L2 | `l2.workspace` (read, grep, shell limits), `l2.web` (search, fetch, web policy), `l2.knowledge` (skills, memory, write approval), `l2.mcp` (servers, approval mode, sandbox), `l2.work`, `l2.artifacts`, `l2.dialog`, `l2.schedule` |
| `l3.` | L3 | Plugin groups: `l3.group-sdk`, `l3.learning`, `l3.authoring` |
| `ext.<name>.enabled` | per extension | Turns one extension on or off, live. Non-built-in extensions also have `ext.<name>.isolation` (`none` or `process`, restart, user or managed only). |
| `l4.` | L4 | App settings: `l4.cli`, `l4.ui`, `l4.desktop`, `l4.host-service`, `l4.remote` |
| `f.` | F | No keys are declared. |

## Key table

"All" means all five scopes: `managed`, `user`, `project`, `local`, `launch`.

| Key | Default | Values or range | Scopes | Applies |
|---|---|---|---|---|
| `l1.tools.permissionMode` | `default` | `default`, `acceptEdits`, `plan`, `bypass` | all | live |
| `l1.tools.bypassAllowed` | `true` | boolean | managed | live |
| `l1.tools.rules` | `[]` | policy rule objects, max 512 per scope | all | live |
| `l1.tools.unattended.approval` | `expire` | `wait`, `deny`, `expire` | all | nextTurn |
| `l1.tools.unattended.timeoutSeconds` | `3600` | 1 to 604800 | all | nextTurn |
| `l1.tools.output.maxLines` | `2000` | 100 to 100000 | managed, user, project, local | nextTurn |
| `l1.tools.output.maxBytes` | `51200` | 1024 to 1048576 | managed, user, project, local | nextTurn |
| `l1.models.default` | `null` | `provider/modelId[:level]` | all | nextTurn |
| `l1.models.thinkingLevel` | `medium` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` | all | nextTurn |
| `l1.loop.maxSteps` | `0` | 0 to 10000 (0 = no limit) | all | nextTurn |
| `l1.agents.maxDepth` | `1` | 0 to 5 | managed, user, project, local | nextTurn |
| `l1.agents.maxConcurrent` | `8` | 1 to 32 | managed, user, project, local | nextTurn |
| `l0.sandbox.enabled` | `true` | boolean | managed, user | nextTurn |
| `l0.sandbox.onUnavailable` | `disable_execute` | `disable_execute`, `run_unsandboxed` | managed, user | nextTurn |
| `l0.sandbox.network.blockedDomains` | `[]` | domain list | managed, user, project | restart |
| `l0.sandbox.protectedPaths.extra` | `[]` | paths | managed, user, project | nextTurn |
| `l0.sandbox.writeRoots.extra` | `[]` | paths | managed, user | nextTurn |
| `l0.sandbox.credentialFiles` | `allow` | `allow`, `deny` | managed, user | nextTurn |
| `l0.sandbox.nestedNamespaces` | `false` | boolean | managed, user | restart |
| `l0.sandbox.selfTestIntervalMin` | `60` | 0 to 1440 (0 = at startup only) | managed, user | restart |
| `l0.secrets.approval.default` | `per-session` | `none`, `per-session`, `per-use` | managed, user | nextTurn |
| `l0.os.log.level` | `info` | `debug`, `info`, `warn`, `error` | managed, user, local, launch | live |
| `x.operations.safeMode.default` | `false` | boolean | managed, user | restart |
| `x.operations.safeMode.suggestAfter` | `3` | 1 to 100 | managed, user | restart |
| `x.operations.autoDisable.enabled` | `true` | boolean | managed, user, local | live |
| `x.loading-trust.defaultProjectTrust` | `ask` | `ask`, `always`, `never` | managed, user | restart |
| `x.ui.apps` | `true` | boolean | managed, user | restart |
| `x.ui.allowProjectApps` | `false` | boolean | managed, user | restart |
| `l2.mcp.approvalMode` | `prompt` | `prompt`, `auto`, `deny` | all | nextTurn |
| `l2.mcp.sandbox.projectSource` | `true` | boolean | managed, user | nextTurn |
| `l2.mcp.sandbox.userSource` | `false` | boolean | managed, user | nextTurn |
| `l2.web.search.provider` | `auto` | `auto` or a provider id | all | nextTurn |
| `l2.web.policy.unseenUrl` | `ask` | `ask`, `allow`, `deny` | managed, user, local, launch | nextTurn |
| `l2.knowledge.write.approval` | `true` | boolean | managed, user | live |
| `l2.workspace.shell.defaultTimeoutSec` | `0` | 0 to 86400 (0 = no limit) | all | nextTurn |
| `ext.<name>.enabled` | `true` (`false` for `ext.account-rotation`, `ext.provider-anthropic-oauth`) | boolean | all | live |

## Notes

- No `session` scope exists. Per-conversation values use `launch`. The `session` window in usage reporting is unrelated.
- `ext.<name>.enabled` defaults to `true` unless the extension manifest sets `defaultEnabled: false`.
- Safety-loosening keys (`l0.sandbox.*` except `protectedPaths.extra` and `network.blockedDomains`, and `x.operations.safeMode.*`) accept only managed or user values.
- `l0.exec.*`, `l0.store.*`, `l0.secrets.*`, and `l1.persistence.*` are read by their packages from the user file only. Put them in user scope.
