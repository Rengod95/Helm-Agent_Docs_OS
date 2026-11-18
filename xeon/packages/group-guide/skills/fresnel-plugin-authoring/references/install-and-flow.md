# Install, trust, and the Plugin Builder flow

Sources: `xeon/packages/platform-os/src/dirs.ts`, `xeon/apps/host/src/assemble.ts` (`userExtensionsDir`), `xeon/packages/ext-host/src/loading-trust/discover.ts`, `xeon/packages/ext-host/src/loading-trust/trust/levels.ts`, `xeon/apps/host/src/assembly/project-extensions.ts`, `xeon/packages/plugin-builder/src/{install,pack,scaffold,group-tools,group-drive}.ts`, `docs/xeon/L3/authoring/spec.md`.

## Where extensions live

| Kind | Folder | Trust ceiling |
|---|---|---|
| User (installed extensions) | `<config>/extensions/<name>/` | `user` |
| Project | `<work folder>/.fresnel/extensions/<name>/` | `project` |
| Built-in | shipped with the app | `builtin` (authors cannot use it) |

`<config>` by platform:

- macOS: `~/Library/Application Support/fresnel/config`
- Linux: `$XDG_CONFIG_HOME/fresnel` when `XDG_CONFIG_HOME` is an absolute path, else `~/.config/fresnel`
- Windows: `%APPDATA%\fresnel`
- With `FRESNEL_HOME` set: `<FRESNEL_HOME>/config`

Discovery looks one level deep for `<dir>/<name>/.fresnel-plugin/plugin.json`. Folders whose names start with `.` are skipped, so `.staging-<name>` is ignored. Symlinks are resolved. A project symlink that leaves `.fresnel/extensions` is skipped.

## Trust

- Levels, highest first: `builtin`, `user`, `project`, `untrusted`.
- The location sets a ceiling: the user folder gives `user`; the project folder gives `project`.
- The manifest `trust.level` may lower the ceiling but not raise it. A higher request fails (`trust_exceeds_source`). Omitting it gives the ceiling.
- `user` and `project` extensions may load, `on`, `post`, `drive`, and register tools, commands, and providers. `untrusted` is not loaded.
- Authored code cannot request `builtin`: authoring reports AU-002, and install refuses with `builtin_trust`.
- Safe mode disables user and project extensions.

## Project extensions

- A project's extensions load only when that work folder is trusted. An undecided folder loads nothing, and this path does not prompt. The client that opened the folder asks.
- The `.fresnel/` folder is a trust-gated resource. An empty `.fresnel/` needs no trust.

## Enabling

- Enable or disable an extension with the setting `ext.<name>.enabled`, which X reserves. Changes apply at a step boundary.
- The root plugin defaults to on unless `defaultEnabled` is `false`. Other plugins default to off. The templates set `defaultEnabled: false`, so a new extension stays off until it is enabled.

## Install rules (`installExtension`)

- Refuses: a source that is not an absolute path; a missing or non-JSON manifest; an invalid manifest; `trust.level: "builtin"`; an entry that is not `.js` or `.mjs`; an entry file that does not exist.
- Copies into a staging folder `.staging-<name>`, then replaces `<extensions dir>/<name>` (an existing folder with that name is replaced).
- If a preview hash is given, the copy is hashed again. A mismatch refuses with `source_changed`.
- `install.ts` only writes the folder. Loading the new version is the extension system's job (the authoring spec says `ext.reload` applies it at a step boundary).

## Plugin Builder

The `authoring` plugin group provides eleven tools (`authoring_guide` reads this guide, the other ten build). They are deferred, so find them with tool search. The group is a built-in plugin group.

| Tool | Input | What it does | Refuses when | User confirms |
|---|---|---|---|---|
| `authoring_kinds` | `layer?`, `query?` | lists kinds, status, and decisions. Read-only | never | no |
| `authoring_start` | `kind` (`single-plugin`), `name`, `dir`, `displayName?` | opens a session. `dir` is absolute, or relative to the work folder | another session is open; kind blocked; name not allowed; relative `dir` with no work folder (`needs_folder`: ask the user for a folder) | kind and name. "No" closes the session |
| `authoring_compose` | `sessionId`, `composition` | checks and saves the composition draft (plugin groups) | kind and name not yet confirmed | no |
| `authoring_scaffold` | `sessionId` | writes the files into `dir` | folder not empty; files already exist | no |
| `authoring_validate` | `sessionId` | runs manifest, composition, drive replay, and AU checks. A pass moves on to trial | no files yet (`not_scaffolded`) | no. After 3 runs in a row with the same error codes and paths, it asks whether to keep fixing; "no" ends the session |
| `authoring_trial` | `sessionId`, `prompt`, `profile?` | starts a Test run on the folder | validation has not passed | yes (it uses model calls). Denied runs ask again on the next call |
| `authoring_replay` | `sessionId`, `maxCommits?` | replays the drive | not in development mode (`l3.authoring.devMode`, default off): `dev_mode_required` | no |
| `authoring_package` | `sessionId`, `out?` | builds the bundle | validation has not passed | yes, before anything is written |
| `authoring_submit` | `sessionId`, `purpose?`, `turnId?` | sends the folder to the review inbox as a draft (nothing is installed; the user approves it there) | validation has not passed; no Test run yet (`no_evidence`: start `authoring_trial` first); no `turnId` (`no_evidence`: pass a turn of that Test run) | no. The review inbox is the approval step |
| `authoring_stop` | `sessionId?` | closes the session. Files stay. The write guard is lifted | never | no |

Notes:

- `authoring_trial` accepts `prompt` and `profile`, but the current code starts the Test run on the folder only and does not pass them on.
- `authoring_scaffold` only writes into an empty or missing folder. To work on an existing extension, edit its files directly.
- Plugin group templates: `scaffold` picks `drive` when the composition has a drive block or no composition is given; `policy` when every `on` block hooks only `tool.call.before`; `observe` otherwise. Single plugins use `xeon/packages/plugin-builder/templates/single-plugin/`.
- Placeholders `__ID__`, `__TITLE__`, `__VERSION__` are filled in. The version starts at `0.1.0`.
- Write guard: while a session is open, a write or exec tool call must stay inside `dir`. Shell command strings are not inspected for paths; only the working folder is checked.
- An open session survives restarts; the session posts a status notice when a conversation resumes.

## Packaging (`packExtension`)

- Writes `<dir>/dist/package` by default (rebuilt each time), or `out` if given. `out` must be an absolute path that is missing or empty.
- Refuses when validation has errors.
- Skips top-level `src`, `test`, `node_modules`, `dist`, `.git`, `package.json`, `tsconfig.json`, `bun.lock`, and secret-looking names (`.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_*`, `credentials*`).
- Bundles the entry into one `dist/index.js` and writes the manifest with `entry: "./dist/index.js"`.
- Kept external (provided by the host): `@fresnel/contracts` and its subpaths, `@fresnel/group-sdk`, and `typebox`. Other imports are bundled in.
