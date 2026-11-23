# Plugin UI: declarative or app

Sources: ADR-0021 `docs/xeon/decisions/ADR-0021-plugin-ui.md` (§3.2 slots, §3.4 host API, §3.5 choosing a mode); schema in `xeon/packages/contracts/src/extensions/ui.ts`; checks in `xeon/packages/contracts/src/extensions/validate.ts` (`validateUi`) and `xeon/packages/core-authoring/src/app-check.ts`.

A plugin shows UI through `ui.items[]` in its manifest. Each item has one slot (`placement`), one mode (`native` or `app`), and a title.

## Choosing the mode

Default to `native` (declarative). Use `app` only when a row in the second table applies, and write why in `app.reason` (one line).

| Question | Native | App |
|---|---|---|
| Can the widget catalog draw it: lists, tables, status, steps, forms, activity trees | yes: native | |
| Free layout, graph or node editing, canvas, custom charts, continuous animation, drag and drop | | yes: app |
| Must the same screen also work in the CLI or a later web client | yes: native, same tree rendered as text | app, plus a `fallback` native tree |
| Card, status cell, or settings section | native only | not allowed |
| A library that must draw (graph, map, editor) | | app; bundle the library in the folder, no network |
| Trust level `project` | native | banned by default |

Choose per item. One plugin may have a native `card` and an app `page`.

## Slots

| `placement` | Where it shows | Modes | Limit per plugin |
|---|---|---|---|
| `page` | the plugin screen host, opened from the plugin list | native, app | 4 |
| `panel` | right panel beside the open conversation (shown only while a conversation is open) | native, app | 1 |
| `card` | a card in the conversation transcript for one record kind (`forKind`) | native | 1 per kind |
| `status` | one status bar cell: 24 characters, one tone, opens a popover | native | 1 |
| `command` | command palette entry: label, description, action. No screen | none | 16 |
| `settings` | a read-only section in the plugin's settings | native | 1 |

Limits and mode rules are checked by `validateManifest`. A declaration over the limit is refused with `ui_limit`, and one in a mode the slot does not allow with `ui_mode_not_allowed`.

## App declaration

```json
{
  "id": "main",
  "placement": "page",
  "mode": "app",
  "title": "Board",
  "app": { "root": "./ui/app", "entry": "index.html", "bridge": "^1.0.0", "reason": "free card dragging" }
}
```

- `app.root`: a folder inside the extension. `app.entry`: the HTML file inside it. The folder must exist and the entry file must exist (`app_root_missing`, `app_entry_missing`).
- `app.bridge`: the bridge version range. It must match the host's bridge version, or the view does not open.
- `app.reason`: required and non-empty (`ui_reason_empty`). The trust prompt shows it. The scaffold's default text is a warning (`app_reason_placeholder`) until you replace it.
- `app.capabilities`: shell features the app may use: `files`, `notify`, `settingsWrite`, `secrets`. A feature not listed here is refused (`not_declared`).
- `fallback`: a native tree for CLI and for installs where app views are off. Missing fallback is a warning (AU-007).

The page runs in a sandboxed iframe with no network, no inline scripts (load every script from a file), and no access to the app's storage. Colors come only from the theme tokens the shell pushes: `--bg`, `--fg`, `--dim`, `--panel`, `--border`, `--accent`. Spacing should use variables, not inline pixel values.

## Bridge protocol

Handshake: after the page loads, post `{ v: 1, ready: true, bridge: "^1.0.0", nonce }` to `window.parent` (target `"*"`). The nonce is the `n` value in the frame URL hash (`#n=<nonce>`). The host then sends one `MessagePort` in `event.ports[0]`. Every later message goes through that port only.

Requests: `{ v: 1, id, op, args }`. Replies: `{ v: 1, id, ok: true, value }` or `{ v: 1, id, ok: false, error: { kind, detail? } }`. Error kinds: `op_not_allowed`, `args_invalid`, `not_declared`, `extension_off`, `safe_mode`, `too_large`, `rate_limited`, `denied`, `failed`. Message limit 1 MiB, 50 messages per second.

Pushes from the host: `{ v: 1, push, value }` with `push` one of `theme` (`{ scheme, tokens }`, apply to `:root`), `host`, `event`, `invalidate` (the engine changed this plugin's state: read again), `ping` (`{ n }`, answer with a `pong` request).

| `op` | `args` | What it does | Needs |
|---|---|---|---|
| `query` | `{ verb, params? }` | calls one of your read methods | `methods` entry with `readOnly: true` |
| `call` | `{ verb, params? }` | calls one of your write methods | `methods` entry with `readOnly: false`; the shell asks the user every time (see below) |
| `events` | `{ kinds, limit? }` | reads your record kinds in the open conversation | your own kinds or `readsRecordKinds` |
| `settings` | `{ keys }` | reads your own setting values | your own keys |
| `host` | none | fixed context: open conversation, connection, locale, theme, your extension state | nothing |
| `command` | `{ name, args? }` | runs one of your slash commands | a command you registered |
| `post` | `{ threadId, text }` | puts text in the conversation input (a user sends it) | trust level that allows it (built-in plugins today) |
| `requestApproval` | `{ threadId, verb, params? }` | asks the user to approve a write method with an approval card | a method with `approval: true` |
| `navigate` | `{ target }` | opens one of your screens, a thread or turn, the extension page, or an external `http(s)` link (after a confirmation line) | nothing for own views and threads |
| `pickFile`, `pickFolder`, `listFolder`, `readFolderFile`, `saveFile` | per op | OS file dialogs and folder reads, inside the folder the user picked | `files` |
| `notify` | `{ title, body? }` | OS notification (body 400 characters at most) | `notify` |
| `writeSetting` | `{ key, value }` | writes one of your own user-scope settings | `settingsWrite` |
| `registerSecret` | `{ name, value }` | registers one of your own secrets | `secrets` |
| `resize` | `{ height }` | sets the height of a panel | nothing |
| `log` | `{ message }` | a diagnostic line (512 characters at most) | nothing |
| `pong` | `{ n }` | answers `ping` | nothing |

The shell checks each request against the op list, the argument schema, your manifest, and your extension state (on, safe mode). The engine checks again.

## Confirmation lines

- A frame `call` or `command` shows a confirmation line each time, with your method's `label` (up to 48 characters) in place of the verb. The user cannot switch these off, and there is no "do not ask again" memory.
- A method with `approval: true` shows the standard approval card before it runs. This card also cannot be switched off.
- A method with `readOnly: true` runs without a line.

## Engine side: the state and the methods

Screen calls and model calls must reach the same state through the same function. The app scaffold shows the shape: one `registerMethod` per read and write method, one `registerTool` for the model, and one `addItem` that all of them call.

- The state belongs to a conversation (thread). `g.state()` works only when the thread is open. A read with no thread, or with `ctx.threadOpen === false`, must answer with an empty value, not fail. A write with no thread must refuse with a value such as `{ ok: false, reason: "no_thread" }`.
- Every method must be listed in the manifest `methods` (verb, `params` and `result` as JSON Schema, `readOnly`). A method registered but not declared is refused by the host; a declared method never registered fails the check (`method_unregistered`, `method_undeclared`).
- Keep `params` and `result` small and closed (`additionalProperties: false`). The manifest schemas are documents, not compiled checks: parse `params` again in the handler (the scaffold uses a TypeBox `parse`).
- The model tool declares no `risk` (the default is `exec`). A plugin that is not built in and declares `read` or `write` has its tool refused at registration (`tool_risk_reserved`), and the registration stays off.
- Live updates: poll with `query` no more often than every 5 seconds, or wait for `invalidate`. The shell sends `invalidate` after the extension's state or a record changes; a burst of changes within 100 ms arrives as one. Re-read with `query` when it arrives.

## Reference

- Minimal bridge handshake and ping: `xeon/examples/viewdemo/ui/app/app.js`, and the manifest in `xeon/examples/viewdemo/.fresnel-plugin/plugin.json`.
- A larger board example (drag and drop, one read method and two write methods, two model tools that share their functions with the methods): `xeon/examples/kanban`.
- Scaffold: `authoring_scaffold` with `mode: "app"` writes the manifest, `src/index.ts`, and `ui/app/` (`index.html`, `app.js`, `bridge.js`, `theme.css`). `authoring_validate` checks the folder, the entry file, and the method registrations.
