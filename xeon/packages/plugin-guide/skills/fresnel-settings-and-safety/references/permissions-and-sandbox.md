# Permissions and sandbox

## Permission modes (`l1.tools.permissionMode`)

| Mode | read tools (`read`, `grep`) | write tools (`write`, `edit`) | exec (`bash`) |
|---|---|---|---|
| `default` | allow | ask | ask |
| `acceptEdits` | allow | allow | ask |
| `plan` | allow | deny | deny |
| `bypass` | allow | allow | allow |

- `bypass` applies only when `l1.tools.bypassAllowed` is `true` (managed-only key, default `true`). When it is `false`, bypass acts as `default`. Under bypass, deny rules still apply and ask rules are skipped.
- A project or local file can set `bypass` in a trusted folder. Tools that replace a built-in tool ignore a bypass set by a repository file.

Ways to set the mode:

- This conversation: `fresnel chat --set l1.tools.permissionMode=plan`, or `/set l1.tools.permissionMode plan` in chat.
- Default: `fresnel config set l1.tools.permissionMode acceptEdits`, optionally with `--scope project` or `--scope local`.
- Desktop: the composer's mode chip lists default, acceptEdits, and plan, and lists bypass only when `l1.tools.bypassAllowed` is `true`.
- Subagents get the stricter of the parent's mode and the mode their definition asks for.

## Evaluation order for each tool call

1. Collect every rule that matches the call, from all tiers.
2. A matching `deny` denies the call. The highest-tier, highest-priority deny is reported.
3. In `plan` mode, a `write` or `exec` call is denied.
4. Bypass: if `bypassAllowed` is true, allow. Otherwise treat the mode as `default`.
5. If rules match: the highest tier wins, then the highest priority. If that group has an `ask`, the result is ask; otherwise allow.
6. No rule matched: the mode table decides.
7. An ask that no one can answer is denied.

- A bash `allow` is downgraded to `ask` when the command contains `;`, `&`, `|`, `<`, `>`, a backtick, a newline, or `$(`. Deny and ask rules are not changed.
- Built-in defaults: read-risk tools are allowed, `read` is allowed for workspace files, and `bash` is `ask`.

## Tiers

Lowest to highest: `default` (built-in rules), `extension` (no way to add rules yet), `user` (rules from `user`, `project`, `local`, and `launch` scopes), `managed` (managed scope; not loaded in this build).

A higher-tier rule beats a lower one, so a user `allow` overrides the built-in `bash` ask. A `deny` at any tier beats every allow. An `allow` in `project` or `local` never auto-approves a tool that replaces a built-in tool.

## Rule format (`l1.tools.rules`)

```json
{ "l1.tools.rules": [ { "id": "user.allow-git-status", "action": "tool.call", "effect": "allow",
  "resource": { "tool": "bash", "args": [{ "pointer": "/command", "pattern": "^git status$" }] } } ] }
```

- `id`: unique within the file. `action`: always `tool.call`. `effect`: `allow`, `ask`, or `deny`.
- `priority`: optional integer 0 to 999, default 500. Higher wins within a tier.
- `resource`: every given field must match. All fields are optional.
  - `tool`: name glob (`*` and `?` only). `capability`, `mcpServer`: globs.
  - `risk`: any of `read`, `write`, `exec`. `classes`: any of `spawn`, `user_interaction`, `shared_state_write`, `external_send`.
  - `args`: up to 16 conditions. `pointer` is an RFC 6901 JSON Pointer such as `/command`. `pattern` is a JavaScript regular expression with no flags, not anchored. Anchor with `^` and `$`.
  - `caller`: `main`, `subagent`, or `subagent:<name>`. `minDepth`: depth at or beyond this. `mode`: any of `default`, `acceptEdits`, `plan`, `bypass`.
- Up to 512 rules per scope. A rule that fails the schema, has a bad pattern or pointer, or has a priority outside 0 to 999 is not loaded.
- Permanent allow for one folder: put the rule in `project` or `local` (trusted folder). For all folders: `user`.

## Approval prompts

- Tool call: the CLI reads `y` (allow once) or `n` (deny; optional feedback text goes back to the model). The desktop shows an approval card with the same choices.
- Remember scope: every request kind offers only `once` in this build. `thread` and `always` are rejected. For a permanent allow, add a rule to `l1.tools.rules`.
- Plan: allow (optionally with the next mode) or deny with feedback. Question and review: answer or deny.
- Print mode (`fresnel chat -p ...`): no one can answer, so requests are denied. `--auto-approve` (print mode only) allows tool requests; questions, plans, and reviews stay denied.

Unattended main-conversation turns (for example scheduled runs) follow `l1.tools.unattended.approval`:

- `wait`: wait for an answer, no time limit.
- `expire` (default): wait `l1.tools.unattended.timeoutSeconds` (default 3600), then deny.
- `deny`: deny at once.

Subagents, nested calls, and calls from other surfaces are always denied at once when no one can answer.

Other approval settings:

- MCP tools: `l2.mcp.approvalMode`, default `prompt`. `prompt` asks, `auto` allows, `deny` denies. A server definition can override one tool.
- Web: `l2.web.policy.allow`, `ask`, and `deny` take domain lists. `l2.web.policy.unseenUrl` (default `ask`) decides URLs not from the conversation. `l2.web.policy.allowPrivateNetwork` (default `false`) allows private addresses; loopback and metadata addresses stay blocked.
- Agent writes to memory and skills: `l2.knowledge.write.approval` (default `true`). Approval of secret-reference use is set by the keys under `l0.secrets.approval` (`default` is `per-session`; `writeHosts` is `per-use`).

## Safe mode

- Turn on: `x.operations.safeMode.default` = `true`. User or managed scope only. Applies at the next host start.
- One start only: `fresnel chat --safe-mode`, `fresnel service start|ensure|run --safe-mode`, or `fresnel host --stdio --safe-mode`. `fresnel host --stdio --no-safe-mode` turns it off for one start even when the setting is on.
- Still loaded: guard and core units, and built-in L1 and L2 units.
- Not loaded: user and project extensions (including the default Helm plugin), built-in L3 groups, and all external hooks.
- `x.operations.safeMode.suggestAfter` (default 3, range 1 to 100): after that many consecutive failed starts, the start screen suggests safe mode.

## Sandbox

- Shell commands (`bash`) run inside the OS sandbox.
- MCP stdio servers run in it when their source says so: `l2.mcp.sandbox.projectSource` (default `true`) covers project and extension sources; `l2.mcp.sandbox.userSource` (default `false`) covers user settings.
- File tools (`read`, `write`, `edit`, `grep`) are not OS-sandboxed. They check the allowed roots and the protected-path list.
- Network: open by default. Commands reach any host except those in `l0.sandbox.network.blockedDomains`, which is checked first (default empty). There is no allowlist setting.

### Filesystem rules for sandboxed commands

- Reads: allowed everywhere the user can read, by default. This includes credential files such as `~/.ssh`, `~/.aws`, and `~/.npmrc`. Writes: only under the workspace roots, the temp directory, and `l0.sandbox.writeRoots.extra`.
- Read and write denied, always: Fresnel's secrets and data directories and the sops age key file.
- Read and write denied, when listed: `l0.sandbox.protectedPaths.extra` (absolute or `~/` paths). The shell and file tools can neither read nor write those paths. Nothing is blocked for reading by default; the user adds what should be blocked.
- The agent can add a folder to that list with the `sandbox_protect` tool when you ask it to, and list what is blocked and the suggested folders with `sandbox_protected`. Additions go to the user scope only, and the tools cannot remove protection; to unblock a path, edit `l0.sandbox.protectedPaths.extra` yourself. A path added this way applies from the next shell or file call, including later in the same turn.
- Write denied by default, reads allowed: `~/.ssh`, `~/.aws`, `~/.kube`, `~/.config/gcloud`, `~/.git-credentials`, `~/.gnupg`, `.env` and `.env.*` (except `.env.example`), `~/.claude`, `~/.codex`, `~/.pi`, the other agent and password-manager folders, the CLI credential files (`~/.npmrc`, `~/.netrc`, `~/.config/gh`, `~/.docker/config.json`, `~/.pypirc`), and the macOS keychains or Linux keyrings. Writing to them stays refused even if their folder is added as a write root.
- Write denied: Fresnel's config directory; `.git/config`, `.git/hooks`, `.gitmodules` in a work folder; shell startup files (`~/.bashrc`, `~/.zshrc`, `~/.profile`, `~/.gitconfig`, and similar); `~/.local/bin`; `~/Library/LaunchAgents` (macOS); `~/.config/systemd/user` (Linux).

### Platforms

| Platform | Backend | Requires |
|---|---|---|
| macOS | Seatbelt (built into macOS) | `rg` (ripgrep) |
| Linux x64 or arm64, WSL2 | bubblewrap with seccomp | `bwrap` 0.4.0 or newer, `socat`, `rg` |
| WSL1, other CPU types, Windows native, other OS | none | Unavailable, reason `unsupported_os` |

A missing helper makes the sandbox unavailable with reason `missing_dependency`, and the status carries install hints. `fresnel doctor` checks `rg`, `bwrap`, and `socat`.

### Status and failure

- `l0.sandbox.enabled` = `false`: commands run without isolation (reason `disabled`). Recorded as the `tool.sandbox_bypassed` event.
- Unavailable (missing dependency, unsupported OS, failed self test): `l0.sandbox.onUnavailable` decides.
  - `disable_execute` (default): shell calls fail with `sandbox_unavailable`.
  - `run_unsandboxed`: commands run without isolation, recorded as `tool.sandbox_bypassed`.
- Self test: at startup, then every `l0.sandbox.selfTestIntervalMin` minutes (default 60; 0 = startup only). A failed item makes the sandbox unavailable with reason `self_test_failed`. Items: `protected_read_denied`, `fresnel_data_write_denied`, `network_denied`, `workspace_write_allowed`, `env_allowlist`, `git_hooks_write_denied`.

### Sandbox keys

| Key | Default | Scopes | Effect |
|---|---|---|---|
| `l0.sandbox.enabled` | `true` | managed, user | `false` turns isolation off. |
| `l0.sandbox.onUnavailable` | `disable_execute` | managed, user | Behavior when the sandbox cannot run. |
| `l0.sandbox.nestedNamespaces` | `false` | managed, user | Lets a browser run inside the sandbox. Weakens isolation. |
| `l0.sandbox.writeRoots.extra` | `[]` | managed, user | Extra writable directories. |
| `l0.sandbox.escapeRetry` | `false` | managed, user | No effect in this build (see below). |
| `l0.sandbox.selfTestIntervalMin` | `60` | managed, user | Minutes between self tests, 0 to 1440. |
| `l0.sandbox.protectedPaths.extra` | `[]` | managed, user, project | Adds paths the shell and file tools can neither read nor write. |
| `l0.sandbox.network.blockedDomains` | `[]` | managed, user, project | Blocks domains. |

Project and local files can only tighten the sandbox: add protected paths or blocked domains.

## Known limits

- Managed settings are not loaded, so nothing can be enforced from a managed file in this build. For the same reason `bypassAllowed` stays `true`.
- `l0.sandbox.escapeRetry` has no effect. No code path sets the policy that would allow running outside the sandbox.
