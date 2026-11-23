---
name: fresnel-plugin-authoring
description: Use when creating, changing, validating, packaging, or installing a Fresnel plugin or plugin group; the format is .fresnel-plugin/plugin.json, not other plugin manifests.
---

# Fresnel plugin authoring

Fresnel plugins use one format: `.fresnel-plugin/plugin.json` with `"schemaVersion": 2`. Other formats, such as `.codex-plugin/` or `.claude-plugin/`, are not Fresnel plugins. Never copy one into a Fresnel plugin. Start from the Plugin Builder templates or from `xeon/examples/viewdemo`.

## Rules

- Required top-level keys: `schemaVersion`, `name`, `version`, `entry`, `plugins`, `purpose`, `description`. Authoring and review refuse an empty `purpose` or `description`.
- `layer` and `hooks` belong inside each `plugins[]` item. A top-level `layer`, `hooks`, `views`, `phases`, or `composition` fails (`legacy_field`).
- One extension has one `entry` file, and it registers all of its plugins. The root plugin omits `id`.
- `name`: lowercase letters, digits, and hyphens, 2 to 32 characters, no underscore, not reserved.
- Every hook passed to `g.on(...)` must be listed in that plugin's `hooks`. A listed hook that is never used is a warning.
- `g.post` needs `usesPost: true`. `g.drive` needs `drives: true` and a plugin group member.
- In `setup`, register methods, tools, and commands with `g.registerMethod`, `g.registerTool`, and `g.registerCommand`. A plain plugin (`definePlugin`, no `orchestration`) has them too.
- Never request `trust.level: "builtin"`. Authoring and install refuse it.
- Source entries are usually `.ts` (`./src/index.ts`). Install needs a bundled `.js` or `.mjs` entry, which packaging writes as `./dist/index.js`.
- Put no secrets in the extension. Validation flags secret literals in source (AU-009).

## Build order (Plugin Builder tools)

0. `authoring_guide`: read this guide (topics, bodies, reference files) through the Plugin Builder when the guide skills are not loaded.
1. `authoring_kinds`: list the kinds (optional).
2. `authoring_start` with `kind`, `name`, `dir`: the user must confirm kind and name.
3. `authoring_compose` (plugin groups only): save the composition draft.
4. `authoring_scaffold` with `mode` `hook`, `inject`, `drive`, `app`, or `native`: write the files into an empty or missing folder. `app` writes a plugin with its own screen (`ui/app/`), read and write methods, and a model tool. `native` writes a plugin with one declarative screen (`ui/native/main.view.json`) and one read method. Read `references/ui.md` before choosing one.
5. Edit the files, then `authoring_validate`. Repeat until there are no errors.
6. `authoring_trial`: the user confirms, because it uses model calls. `authoring_replay`: development mode only.
7. `authoring_submit` with the `turnId` of a turn in the Test run (the evidence): it sends the folder to the review inbox as a draft. Nothing is installed; the user approves it in the review inbox, and only then can the plugin be used. `authoring_package` (optional): packs one bundle file the user can keep; the user confirms.
8. `authoring_stop`: close the session. Files stay.

These tools are deferred: find them with tool search before you call them.

Templates: `xeon/packages/core-authoring/templates/single-plugin/` (single plugin), `xeon/packages/core-authoring/templates/` (inject and drive), and `xeon/packages/orchestration-sdk/templates/` (drive, policy, and observe groups). The `app` and `native` skeletons are text in `xeon/packages/core-authoring/src/app-skeleton.ts` and `native-skeleton.ts`.

## Reference files

| File | Read it for |
|---|---|
| `references/manifest.md` | every manifest field, required fields, naming rules, valid examples |
| `references/hooks-and-tools.md` | hook names and folds, handler shapes, group and drive API, tool definition, layers |
| `references/install-and-flow.md` | install folders, trust levels, project extensions, each Plugin Builder step and its confirmation |
| `references/ui.md` | plugin screens: declarative or app (own code) mode, the six slots, the app bridge ops, confirmation lines, app state and methods |
