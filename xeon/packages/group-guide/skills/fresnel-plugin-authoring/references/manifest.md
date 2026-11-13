# Manifest: `.fresnel-plugin/plugin.json`

Location: `<extension root>/.fresnel-plugin/plugin.json`. The format is `schemaVersion: 2`. Version 1 is not read.

Sources: schema in `xeon/packages/contracts/src/extensions/manifest.ts`; checks in `xeon/packages/contracts/src/extensions/validate.ts` (`validateManifest`); authoring checks (AU-001 to AU-012) in `xeon/packages/plugin-builder/src/validate.ts`.

Unknown top-level keys are removed with a warning (`unknown_key`). Any error refuses the whole manifest.

## Top-level fields

| Field | Required | Rule |
|---|---|---|
| `schemaVersion` | yes | the number `2` |
| `name` | yes | `^[a-z][a-z0-9-]{1,31}$`: lowercase letters, digits, hyphens. No underscore |
| `version` | yes | strict SemVer, such as `0.1.0`. No ranges |
| `entry` | yes | relative path inside the root, such as `./src/index.ts`. Install needs `.js` or `.mjs` |
| `plugins` | yes | array of 1 to 16 plugin items (below) |
| `displayName` | no | up to 64 characters |
| `description` | no | up to 1024 characters |
| `author` | no | object: `name` (required, up to 128), `email?`, `url?` |
| `homepage`, `repository` | no | up to 512 characters each |
| `license` | no | up to 128 characters |
| `keywords` | no | up to 16 strings, each up to 64 characters |
| `defaultEnabled` | no | boolean. The root plugin defaults to `true`; other plugins default to `false`. A plugin's own `defaultEnabled` wins |
| `components` | no | `skills`, `commands`, `agents`: arrays of paths. `mcpServers`: one path. Only `agents` (subagent `.md` files) is confirmed to be read |
| `userConfig` | no | map from key (`^[a-zA-Z][a-zA-Z0-9_]{0,63}$`) to `{ setting, title, description?, sensitive?, required? }`. `setting` is `ext.<name>.<key>`. `sensitive: true` stores the value as a secret reference |
| `group` | no | presence makes the extension a plugin group (see Group) |
| `ui` | no | Plugin UI contributions. Example: `xeon/examples/viewdemo/.fresnel-plugin/plugin.json`. Full rules: `docs/xeon/F/extensions/spec.md` |
| `methods` | no | up to 64 `{ verb, params, result, readOnly, approval?, label? }`. `verb` matches `^[a-z][A-Za-z0-9]{0,47}$`. Wire name `ext.<name>.<verb>`. `readOnly` with `approval: true` fails (`method_invalid`) |
| `isolation` | no | `"none"` or `"process"`. Not allowed for `builtin` |
| `trust` | no | `{ "level", "reason"? }`. Authored code requests `user`, `project`, or `untrusted`, and a level above the install location's ceiling is refused. See install-and-flow.md |

## Plugin items (`plugins[]`)

| Field | Required | Rule |
|---|---|---|
| `layer` | yes | `"L1"`, `"L2"`, `"L3"`, or `"plugin"`. Write `"plugin"` for your own extensions. One extension cannot mix `"plugin"` with L1 to L3 (`layer_mixed_external`) |
| `hooks` | yes | array of hook names (up to 64; `[]` is allowed). No duplicates. List every hook you pass to `g.on` |
| `id` | no | `^[a-z][a-z0-9-]{1,31}$`, unique in the extension. Omit it for the root plugin. At most one root |
| `title` | no | up to 64 characters |
| `defaultEnabled` | no | see the top-level field |
| `usesPost` | no | `true` if the plugin calls `g.post` |
| `drives` | no | `true` if the plugin calls `g.drive`. Drives need a plugin group member |
| `requires` | no | `[{ "id", "range" }]`: capabilities the plugin needs. `range` is a SemVer range |
| `optional` | no | same shape. An id cannot be in both `requires` and `optional` |
| `provides` | no | `[{ "id", "version" }]`. The prefixes `core`, `ext`, `grp`, `x` are reserved |
| `recordKinds` | no | `[{ "kind", "version", "description", "payload" }]`. `version` is at least 1. `description` is 1 to 500 characters. `payload` is an object |
| `readsRecordKinds` | no | kinds read from other extensions: a full kind, or a prefix ending in `.*` |
| `replaces` | no | built-in tool names this plugin replaces. Leave it unset unless you must. Activation needs user approval |

Record kind names match `^(x|grp)\.<name>\.<area>\.<event>$`. `<area>` is `[a-z][a-z0-9_]{0,31}`, and `<event>` is `[a-z][a-z_]*` (no digits or hyphens). A plugin group uses `grp.<name>.`. Other extensions use `x.<name>.`. The `<name>` must be the extension's own name (`record_kind_prefix`).

## Group

`group: {}` makes the extension a plugin group. It needs at least one plugin with `layer: "L3"` (the templates use the root plugin).

- `members`: plugin ids that switch on and off together. Omit it and every plugin is a member. When it is present, the root plugin is always a member. 1 to 16 entries.
- `composition`: a design model for the editor, `{ "blocks": [...], "phases"? }` with 1 to 64 blocks. A block is `{ id, stage, op, plugin?, title?, summary?, hooks?, consumes?, produces? }`. `op` is `on`, `post`, `drive`, `record`, or `register`. Runtime behavior comes from the code, not from the composition.

## Naming

- Not allowed for authored extensions: `core`, `ext`, `grp`, `x`, `fresnel`, `workspace`, `mcp`, `web`, `knowledge`, `work`, `dialog`, `artifact`, `artifacts`, `schedule`, `ui`, `test`, and any name starting with `fresnel-hooks-`.
- Not allowed for any extension: the input source keys `user`, `deleg`, `timer`.
- The Plugin Builder also refuses the names in `RESERVED_GROUP_NAMES` (`xeon/packages/group-sdk/src/define-group.ts`). These include `cap`, `xh`, `sys`, `p`, `auto`, `all`, `none`, `group`, `groups`, `kit`.

## Minimal valid examples

Each example below passes `validateManifest` with no errors. Source form: `entry` points at `.ts`.

Single plugin:

```json
{
  "schemaVersion": 2,
  "name": "my-plugin",
  "version": "0.1.0",
  "entry": "./src/index.ts",
  "plugins": [{ "layer": "plugin", "hooks": ["boundary.settle.after"] }],
  "defaultEnabled": false,
  "trust": { "level": "user" }
}
```

Plugin group with a drive (the drive template shape):

```json
{
  "schemaVersion": 2,
  "name": "my-group",
  "version": "0.1.0",
  "entry": "./src/index.ts",
  "plugins": [{ "layer": "L3", "hooks": ["boundary.settle.after"], "drives": true }],
  "group": {},
  "defaultEnabled": false,
  "trust": { "level": "user" }
}
```

Plugin group with a member and a record kind:

```json
{
  "schemaVersion": 2,
  "name": "my-group",
  "version": "0.1.0",
  "entry": "./src/index.ts",
  "plugins": [
    {
      "layer": "L3",
      "hooks": ["boundary.settle.after"],
      "recordKinds": [
        { "kind": "grp.my-group.turn.counted", "version": 1, "description": "Turn counter", "payload": {} }
      ]
    },
    { "id": "helper", "layer": "L3", "hooks": ["tool.call.before"], "usesPost": true }
  ],
  "group": { "members": ["helper"] },
  "trust": { "level": "user" }
}
```

Packaging copies the normalized manifest and changes only `entry` to `./dist/index.js`.

## Errors you will meet

- `legacy_field`: a top-level `layer`, `hooks`, `usesPost`, `requires`, `optional`, `provides`, `recordKinds`, or `readsRecordKinds` (move them into `plugins[]`); `views` (use `ui`); `composition` or `phases` (use `group.composition`); `kind`, `points`, `usesDrive`.
- `schema_version_unsupported`: `schemaVersion` is not `2`.
- `hook_unknown` / `hook_duplicate`: a hook name that is not in the hook list, or listed twice (see hooks-and-tools.md).
- `hook_undeclared` (error) / `hook_unused` (warning): `g.on` and `hooks` do not match.
- `post_undeclared` / `drive_undeclared`: `usesPost` or `drives` is missing.
- `capability_undeclared`: a capability is used but not in `requires` or `optional`.
- `plugin_root_ambiguous`: more than one plugin omits `id`.
- `group_member_unknown`: `members` names an id that no plugin declares.
- `entry_invalid`: `entry` is absolute or climbs out of the root with `..`.
- `name_reserved`: a reserved name (see Naming).
- AU-002: `trust.level` is `builtin`. AU-009: a secret literal in source. AU-012: a drive breaks the replay rules.
