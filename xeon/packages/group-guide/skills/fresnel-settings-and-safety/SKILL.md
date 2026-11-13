---
name: fresnel-settings-and-safety
description: Use when a user asks how Fresnel settings, setting scopes, permission modes, approvals, safe mode or the sandbox work, or which key to change.
---

# Fresnel settings and safety

Answer from the reference files. Confirm the key, its default, and its scope before you answer. Do not guess keys or defaults.

## How to answer

1. Name the exact key and its default. Take keys only from the reference tables.
2. Show the current value when you can. `fresnel config get <key>` prints the value, the file it comes from, shadowed values, and `pending:` for changes that wait.
3. Say where to change it: a CLI command, the `/set` line in chat, or the desktop settings page.
4. Never print secret values. Secret settings hold `secret://` references only.
5. If a behavior is not in the references, say you cannot confirm it. Do not invent it.

## Settings in brief

- Scopes, highest first: `managed`, `launch`, `local`, `project`, `user`. The first scope with a valid value wins. `managed` is not loaded in this build.
- There is no `session` scope. A value for this conversation only uses `launch`.
- `user` is `<config dir>/settings.json`. `project` and `local` are `.fresnel/settings.json` and `.fresnel/settings.local.json` in the work folder. They apply only when the folder is trusted.
- Change a value: `fresnel config set <key> <value> [--scope user|project|local]`. The default scope is `user`. Remove one: `fresnel config reset <key>`.
- This conversation only: `fresnel chat --set <key>=<value>`, or `/set <key> <value>` in chat.
- Timing: `live` applies at once, `nextTurn` at the next turn, `restart` after the host restarts.

## Permissions and safety in brief

- Permission mode: `l1.tools.permissionMode` is `default`, `acceptEdits`, `plan`, or `bypass`.
- Approval prompts offer "allow once" or "deny" only. A permanent allow is a rule in `l1.tools.rules`.
- Shell commands run in the OS sandbox unless it is off (`l0.sandbox.enabled`) or unavailable (`l0.sandbox.onUnavailable`).
- Safe mode: `x.operations.safeMode.default` (user or managed scope, applies at next start). For one start, use `--safe-mode` on `fresnel chat`, `fresnel service start|ensure|run`, or `fresnel host --stdio`.

## Reference files

- `references/settings-and-scopes.md`: file path per scope, precedence and merge, trust for project files, file format, read and write commands, key namespaces, key table with defaults.
- `references/permissions-and-sandbox.md`: permission modes, rule format and evaluation order, approval prompts, unattended runs, safe mode, sandbox platforms, protected paths, sandbox keys.

## Watch for

- Keys under `l0.exec.*`, `l0.store.*`, `l0.secrets.*`, and `l1.persistence.*` are read from the user file only. Put them in user scope.
- `l0.sandbox.escapeRetry` has no effect in this build.
- Project and local files are not watched for edits. They take effect after a restart, a trust change, or a write made through Fresnel.
