import { describe, expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import { listLoaded } from "@fresnel/client/workbench";
import type {
  ExtGetResult,
  ExtHealthEntry,
  ExtListEntry,
  HookEntry,
} from "@fresnel/contracts/wire";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { EngineStoreContext } from "../../../src/state/engine/index.ts";
import {
  createWorkbenchStore,
  WorkbenchStoreContext,
  type WorkbenchStore,
} from "../../../src/state/workbench/index.ts";
import {
  CommandsContext,
  type Commands,
  type WorkbenchCommands,
} from "../../../src/views/commands.ts";
import {
  useWorkbenchController,
  type WorkbenchController,
} from "../../../src/views/workbench/controller.ts";
import { harness } from "../../state/helpers.ts";
import { fakeCommands } from "../fake-commands.ts";

function entry(name: string, over: Partial<ExtListEntry> = {}): ExtListEntry {
  return {
    name,
    displayName: name,
    layer: "L2",
    isGroup: false,
    version: "1.0.0",
    location: "/x",
    origin: "user",
    requestedGrade: "user",
    effectiveGrade: "user",
    tier: null,
    status: "enabled",
    plugins: [{ registrationId: name, layer: "L2", status: "enabled", inGroup: false }],
    diagnostics: [],
    autoDisabled: false,
    safeModeExcluded: null,
    hookCount: 1,
    ...over,
  };
}

const WEB = entry("web");
const CORE = entry("core-loop", { layer: "L1", tier: "core", origin: "builtin" });
const ENTRIES = [WEB, CORE];

const detailOf = (e: ExtListEntry): ExtGetResult => ({
  entry: e,
  manifest: {},
  hooks: [],
  bindings: [],
});

/** 이전에 읽어 둔 자세히. 실패한 재읽기가 이 값을 그대로 남기는지 본다 */
const CORE_BEFORE: ExtGetResult = {
  ...detailOf(CORE),
  hooks: [
    { registrationId: "core-loop", hook: "tool.call.before", budgetClass: "fast", budgetMs: 5 },
  ],
};

const HEALTH: ExtHealthEntry = {
  name: "web",
  registrationId: "web",
  consecutiveFailures: 2,
  windowFailures: 2,
  windowMs: 1000,
  autoDisabled: false,
  lastFailureAt: "2026-11-04T10:00:00Z",
  lastError: "timeout",
};

/** 기본 순서는 core, web이고 적용 순서는 web, core다. 덮어쓰기가 이기는지 본다 */
const HOOK: HookEntry = {
  hook: "tool.call.before",
  fold: "first",
  handlers: 2,
  registrations: ["web", "core-loop"],
  external: false,
  order: [
    {
      registrationId: "core-loop",
      extension: "core-loop",
      tier: 0,
      status: "enabled",
      error: null,
    },
    { registrationId: "web", extension: "web", tier: 1, status: "enabled", error: null },
    { registrationId: "old", extension: "old", tier: null, status: "disabled", error: null },
  ],
};

const APPLIED = {
  hooks: [{ hook: "tool.call.before", saved: [], applied: ["web", "core-loop"], pending: false }],
};

function commandsWith(over: Partial<WorkbenchCommands>): Commands {
  return fakeCommands({ workbench: { ...fakeCommands().workbench, ...over } });
}

function controllerOf(store: WorkbenchStore, commands: Commands): WorkbenchController {
  const seen: { controller: WorkbenchController | null } = { controller: null };
  function Probe(): ReactNode {
    seen.controller = useWorkbenchController();
    return null;
  }
  renderToString(
    <EngineStoreContext value={harness().store.read}>
      <CommandsContext value={commands}>
        <WorkbenchStoreContext value={store}>
          <Probe />
        </WorkbenchStoreContext>
      </CommandsContext>
    </EngineStoreContext>,
  );
  if (seen.controller === null) throw new Error("probe did not render");
  return seen.controller;
}

describe("reload: 목록 뒤의 보조 읽기", () => {
  test("자세히, 실패 장부, 훅 순서를 읽고, 실패한 자세히는 이전 값을 그대로 둔다", async () => {
    const store = createWorkbenchStore();
    store.actions.detailsLoaded("core-loop", CORE_BEFORE);
    const commands = commandsWith({
      list: () => Promise.resolve(ok(ENTRIES)),
      get: (name) => Promise.resolve(name === "web" ? ok(detailOf(WEB)) : err({ kind: "failed" })),
      health: () => Promise.resolve(ok([HEALTH])),
      hooks: () => Promise.resolve(ok([HOOK])),
      orderGet: () => Promise.resolve(ok(APPLIED)),
    });

    await controllerOf(store, commands).reload();

    const state = store.actions.snapshot();
    expect(state.list).toBe("ready");
    expect(state.entries).toEqual(ENTRIES);
    expect(state.details).toEqual({ web: detailOf(WEB), "core-loop": CORE_BEFORE });
    expect(state.health).toEqual({ web: HEALTH });
    expect(state.order).toEqual({ "tool.call.before": ["web", "core-loop"] });
  });

  test("훅 순서 읽기 하나가 실패하면 이전 순서를 그대로 두고 목록은 ready다", async () => {
    const store = createWorkbenchStore();
    store.actions.ordersLoaded({ "tool.call.before": ["web"] });
    const commands = commandsWith({
      list: () => Promise.resolve(ok(ENTRIES)),
      get: () => Promise.resolve(ok(detailOf(WEB))),
      health: () => Promise.resolve(ok([HEALTH])),
      hooks: () => Promise.resolve(ok([HOOK])),
      orderGet: () => Promise.resolve(err({ kind: "failed" })),
    });

    await controllerOf(store, commands).reload();

    const state = store.actions.snapshot();
    expect(state.list).toBe("ready");
    expect(state.order).toEqual({ "tool.call.before": ["web"] });
    expect(state.health).toEqual({ web: HEALTH });
  });

  test("목록 읽기가 실패하면 보조 읽기는 하지 않고 목록은 오류다", async () => {
    const store = createWorkbenchStore((s) => listLoaded(s, ENTRIES));
    const asked: string[] = [];
    const commands = commandsWith({
      list: () => Promise.resolve(err({ kind: "offline" })),
      get: (name) => {
        asked.push(name);
        return Promise.resolve(ok(detailOf(WEB)));
      },
    });

    await controllerOf(store, commands).reload();

    const state = store.actions.snapshot();
    expect(state.list).toBe("error");
    expect(state.entries).toEqual(ENTRIES);
    expect(asked).toEqual([]);
    expect(state.details).toEqual({});
  });
});
