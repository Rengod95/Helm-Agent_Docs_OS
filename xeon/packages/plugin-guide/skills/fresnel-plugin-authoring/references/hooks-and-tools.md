# Hooks, plugin API, tools, drives, layers

Sources: `xeon/packages/contracts/src/extensions/hooks.ts` (registry), `ops.ts` (handler types), `ports.ts` (`ToolResourceDef`), `drive.ts` (loop API); `docs/xeon/F/extensions/spec.md` (replay rules); `docs/xeon/L3/group-sdk/spec.md` (groups).

## Hook folds

A hook name is `<kind>.<target>[.before|after]`, lowercase, with no aliases. A plugin can use only the hooks in its `hooks` array.

- `tap`: every handler runs. Return value is ignored. An error is logged and the next handler runs.
- `first`: handlers run in order. The first non-`undefined` return is the decision, and later handlers do not run. An error becomes the deny value (`closed`). The exception is `tool.call.before` and `agent.spawn.before`: every handler runs, and the strongest decision wins (`block` over `replace` over `ask`; among equal kinds the earlier handler wins). A `block` still stops the run at once.
- `chain`: each handler gets `(payload, current)` and may return a patch that is merged into `current`. An error drops only that handler's patch.
- `collect`: each handler gets `payload` and may return a contribution. Contributions are merged once at the end. An error drops only that contribution.

Handler shapes: tap `(payload, ctx)`; first `(payload, ctx)` returns a decision; chain `(payload, current, ctx)` returns a patch; collect `(payload, ctx)` returns a contribution. `ctx` has `scopeId`, `state` (last committed), `threadId`, `signal`.

Deny values: `tool.call.before` and the guard hooks return `{ block: true, reason }`. Switch, fork, and tree hooks return `{ cancel: true, reason }`. Guard handlers cannot change the value; they only block or pass. `tool.call.before` may also return `{ ask: true, reason }` (asks the user; allowing it lets the policy continue) or `{ replace: { content, details?, isError? }, reason }` (gives the result without running the tool). A hook never grants permission by itself.

Hooks that are listed in this document but not yet fired by this build (`ask.human.before`, `ask.human.after`, `agent.spawn.before`, `agent.spawn.after`) are marked "not fired yet" below. A plugin that declares one gets a `hook_not_fired` warning.

`dispatch: detached` (not awaited): `request.thinking.after`, `thread.mcp.after`, `thread.info.after`, `thread.prompt.before`, `thread.prompt.after`.

## Hook list (50)

Only meanings that the source states are written. Others are listed by name.

- **input** (3): `input.user.before` chain; `input.bash.before` first; `input.agent.before` collect (before an agent starts; contributions can add system-prompt text).
- **request** (9): `request.context.before` chain; `request.system.before` chain; `request.cache.before` chain; `request.provider.before` chain; `request.headers.before` chain (patches provider headers; `null` deletes one); `request.provider.after` tap; `request.stream` tap; `request.model.after` tap; `request.thinking.after` tap (detached).
- **tool** (5): `tool.call.before` first (a `{ block: true, reason }` decision blocks the call); `tool.result` chain (patches the tool result, field by field); `tool.execution.before`, `tool.execution.update`, `tool.execution.after` tap.
- **boundary** (9): `boundary.turn.before` tap (a turn starts); `boundary.step.before` tap (a step starts); `boundary.message.before` tap; `boundary.message.update` tap; `boundary.message.after` chain; `boundary.step.after` chain (a step ends; final validation runs after all handlers); `boundary.settle.before` chain (a turn is about to settle; final validation); `boundary.turn.after` tap; `boundary.settle.after` tap (a turn has settled; the payload has `origin`, `status`, `hasFinalAnswer`, `lastItemId`).
- **thread** (15): `thread.trust.before` first, threadless (folder trust, decided before any thread exists); `thread.resources` collect (contributes resource paths); `thread.start` tap; `thread.mcp.after` tap (detached); `thread.info.after` tap (detached); `thread.switch.before`, `thread.fork.before`, `thread.tree.before` first (can cancel); `thread.compact.before` first, fail-open (a handler error does not block compaction); `thread.compact.after`, `thread.compact.failed`, `thread.tree.after`, `thread.shutdown` tap; `thread.prompt.before`, `thread.prompt.after` tap (detached).
- **guard** (3): `guard.model.before` first (before the provider request is sent, after all `request.provider.before` handlers); `guard.tool.before` first (before a tool runs, after `tool.call.before`); `guard.output.before` first (before model output reaches display or execution).
- **lifecycle** (2): `lifecycle.agent.settled` tap (after the durable `agent.settled` event commits; not the same as `boundary.settle.after`); `lifecycle.lease.rejected` tap (after the durable `lease.rejected` event commits: a drive lock request was refused).
- **ask** (2): `ask.human.before` first (before an approval card opens; `{ cancel: true, reason }` resolves it without a card, `{ answer, reason }` answers a question; a failing handler means the user is asked) [not fired yet]; `ask.human.after` tap (after the card is resolved; the answer is not changed by any hook) [not fired yet].
- **agent** (2): `agent.spawn.before` first (before a subagent is created; `{ block }`, `{ ask }`, or `{ replace: { report }, reason }`, merged like `tool.call.before`) [not fired yet]; `agent.spawn.after` chain (after the child settles; a `{ reportText }` patch replaces the report text, capped at 60,000 characters) [not fired yet].

## Plugin API (`g` in `setup`)

A plugin's `register(id, def, setup)` gives a `RegistrationApi`:

- `on(hook, handler)`: the hook must be listed in the plugin's `hooks`.
- `post(item, { when, requestId })`: needs `usesPost`. `requestId` is required; a second post with the same id is ignored. `when` is `steer`, `followUp`, or `next`. Example item: `{ kind: "context", customType, content, display }`.
- `drive(fn, options?)`: needs `drives`. Registers the drive function (see Drives).
- `state()`, `commit(next)`: state needs `state` in the group definition. Without it, both are refused.
- `record(kind, subject, payload)`, `recordPrivate(kind, payload)`, `readRecords(query)`: kinds must be declared in `recordKinds` or `readsRecordKinds`.
- `capability(key)`: the capability must be in `requires` or `optional`.
- `onDispose(fn)`: cleanup when the plugin is disabled.

A plugin group's `g` (`OrchestrationApi`, from `defineOrchestration`) adds: `settings()`, `delegate(spec, options?)`, `delegateStatus(requestId)`, `cancelDelegates(reason?)`, `metrics`, `registerTool(def)`, `registerCommand(name, def)`, `registerMethod(verb, def)` (the verb must be in `methods`), `registerProvider(name, config)`.

A plain plugin that has no members (for example an app plugin with screen methods and model tools) uses `definePlugin` and `pluginManifest` instead and declares no `orchestration`. Its `g` has the same registration calls, and it is not classified as a Drive or member plugin.

Replay rules for `on` handlers and drives (the same handler may run again after a crash):

- `on` handlers may commit, record, post, delegate, and call idempotent capability methods that take an explicit key.
- Drive functions may do the same, plus `loop.turn`, `loop.spawn`, `loop.ask`, `delegateStatus`, and read-only capability methods.
- `on` handlers may not call read-only capability methods. Neither may do direct file or network I/O, read the clock, or use randomness.
- Request ids are built only from committed values (turn id, step id, committed state fields, dispatch key). Never use `Date.now`, `Math.random`, or closure variables.

## Drives

A drive group is a plugin group whose plugin sets `drives: true` and calls `g.drive`. Minimal shape (from the drive template):

```ts
const group = defineOrchestration<State>({
  manifest: orchestrationManifest(manifestJson), // reads .fresnel-plugin/plugin.json
  state: { schema: stateSchema, initial: initialState, version: 1 },
  settings, // defineSettings("ext.<name>", {...})
  setup(g) {
    g.drive(
      async (loop, st) => {
        if (st.phase === "done") return;
        const out = await loop.turn({ input: { kind: "user", content: "..." }, requestId: `<name>:round:${st.round}` });
        await g.commit({ ...st, round: st.round + 1, phase: out.status === "completed" ? "run" : "done" });
      },
      { limits: { maxTurns: 4 } },
    );
  },
});
export default group;
```

Rules:

- The drive function is called again from the last committed state: after each boundary, after a lock is granted, after an `ask` answer, and after restart.
- Change state only with `g.commit`. Keep no progress in closure variables.
- `loop.ask({ requestId, card })` waits for a person. The drive lock is released while waiting, and the same `requestId` returns the recorded answer.
- `limits` (`maxTurns`, `maxSpawns`, `maxTokens`) caps the drive. A missing field uses the host default, and a value cannot exceed the host ceiling. `loop.budget` shows what is left.
- One thread has one drive lock. A waiting drive group keeps `on`, `post`, and delegation, but its drive function does not run.

Testing (from the drive template): `checkOrchestration` (from `@fresnel/orchestration-sdk/testing`) checks setup declarations. `replayDrive` reruns the drive at every commit point and compares the events. The template in `test/replay.test.ts` shows the harness.

`scanDriveSource` flags these in drive code: `Date.now` (SD-01), `new Date()` (SD-02), `Math.random` (SD-03), `crypto.randomUUID` (SD-04), `crypto.getRandomValues` (SD-05), `performance.now` (SD-06), `fetch` (SD-07), fs modules and `Bun.file`/`Bun.write` (SD-08), other `Bun.*` (SD-09). SD-10 (warning): state kept outside scope state.

Group kinds in the templates: `policy` blocks tool calls from a `tool.call.before` first handler and keeps no state. `observe` counts turns in a `boundary.settle.after` tap and records them. `drive` runs turns from committed state.

## Tools (`ToolResourceDef`)

Register with `g.registerTool(def)` in `setup`, in a plugin group or in a `definePlugin` plugin.

| Field | Rule |
|---|---|
| `name` | `^[a-zA-Z0-9_-]{1,64}$`, checked at registration (`resource_name_invalid`) |
| `description` | text the model reads |
| `parameters` | TypeBox schema for the arguments |
| `replay` | required. `"safe"`: safe to run again when the outcome is unknown. `"unsafe"`: do not run again |
| `exposure` | `"always"` (default) or `"deferred"` (found only through tool search) |
| `risk` | `"read"`, `"write"`, or `"exec"`. Omitted: derived from `hints`, else `"exec"`. Non-builtin extensions cannot declare `read` or `write`, or `hints.readOnly: true`; the load fails (`tool_risk_reserved`). Use `exec` or omit it |
| `hints` | `{ readOnly?, destructive?, idempotent?, openWorld? }` |
| `replaces` | a built-in tool name. Only if the manifest `replaces` lists it |
| `execute(args, ctx)` | `args` is JSON. `ctx` has `threadId`, `signal`, `toolCallId`, `caller`. Return a JSON-serializable value |

The model sees the short name when it is unique and not reserved. On a collision it sees `<extension>__<name>` (`docs/xeon/X/operations/spec.md`, a proposal).

### Minimal tool and method (copy this shape)

A plugin that gives the model a tool, or a screen a method to call, is a plugin group. The manifest (`.fresnel-plugin/plugin.json`) has `orchestration: {}` and one plugin with `layer: "L3"`; a method verb must also be listed in `methods`. Use the scaffold (`authoring_scaffold`, mode `app`) when the plugin needs its own screen; it writes this shape for you. Do not search the disk for examples.

```ts
import { parse } from "@fresnel/contracts";
import { defineOrchestration, orchestrationManifest } from "@fresnel/orchestration-sdk";
import { Type } from "typebox";
import manifestJson from "../.fresnel-plugin/plugin.json" with { type: "json" };

const helloParams = Type.Object({ name: Type.String() }, { additionalProperties: false });

const group = defineOrchestration({
  manifest: orchestrationManifest(manifestJson),
  setup(g) {
    g.registerTool({
      name: "greeter_hello", // letters, digits, _ and - only
      description: "Say hello to a name",
      parameters: helloParams,
      replay: "safe", // risk is left out: external plugins cannot declare read or write
      execute: (args) => {
        const checked = parse(helloParams, args);
        if (!checked.ok) return Promise.resolve({ ok: false, reason: "invalid_input" });
        return Promise.resolve({ ok: true, text: `hello ${checked.value.name}` });
      },
    });
    g.registerMethod("hello", {
      // the verb "hello" must be listed in the manifest `methods`
      handler: (params) => Promise.resolve({ ok: true, echoed: params }),
    });
  },
});

export default group;
```

During a Test run the plugin loads under an internal name. `defineOrchestration` registers under the name the host gives, so keep the shape above. State (`state: { schema, initial, version }`, `g.state()`, `g.commit()`) is optional; the scaffold in mode `app` shows it.

## Layers

Repo layers (`xeon/AGENTS.md`), in import order: F (0) `packages/contracts`; X (1) `packages/ext-host`; L0 (2) `packages/platform-*`; L1 (3) `packages/core-*`; L2 (4) `packages/cap-*`; L3 (5) `packages/plugin-*`; L4 (6) `apps/*`. A package imports only lower layers.

Manifest `layer` values are different. They say which layer a plugin sits in: `L1`, `L2`, `L3`, or `plugin`. Write `plugin` for your own extensions. A plugin group's root plugin is `L3`.

Group terms:

- Plugin group: an extension with `group` and an `L3` plugin. Its members switch on and off together.
- Drive group: a plugin group whose plugin registers a drive.
- Policy and observe groups: template kinds (see Drives).
