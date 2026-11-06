import { describe, expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import { listLoaded, pickGroup, type WorkbenchState } from "@fresnel/client/workbench";
import type {
  ExtGetResult,
  ExtHealthEntry,
  ExtListEntry,
  HookEntry,
} from "@fresnel/contracts/wire";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { EngineStoreContext } from "../../../src/state/engine/index.ts";
import { SafeModeContext } from "../../../src/views/safe-mode-context.ts";
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
import { ExtensionsScreen } from "../../../src/views/workbench/extensions-screen.tsx";
import {
  reloadOnExtChanges,
  useWorkbenchController,
  type WorkbenchController,
} from "../../../src/views/workbench/controller.ts";
import { t } from "@fresnel/client/i18n";
import { harness } from "../../state/helpers.ts";
import { fakeCommands } from "../fake-commands.ts";
import { inContexts } from "./support.tsx";

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

/** 이벤트 루프를 한 바퀴 돌려 이미 풀린 읽기들의 뒤처리를 끝낸다. 시험의 가짜 명령은 모두 바로 풀린다 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * 서버 렌더(`renderToString`)는 스토어의 처음 상태만 읽는다(zustand의 `getInitialState`). 그래서 값을 바꾼 뒤의 그림은
 * 그 값을 처음 상태로 가진 스토어로 그린다. 화면 코드는 같다.
 */
function renderSeeded(state: WorkbenchState): string {
  return renderToString(
    inContexts(
      <ExtensionsScreen />,
      createWorkbenchStore(() => state),
    ),
  );
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

describe("목록이 다시 읽히면 자동 꺼짐 표시는 스토어를 따른다", () => {
  const REVIEW_OFF = entry("review", {
    layer: "L3",
    isGroup: true,
    status: "disabled",
    autoDisabled: true,
  });
  const REVIEW_ON = entry("review", {
    layer: "L3",
    isGroup: true,
    status: "enabled",
    autoDisabled: false,
  });
  // 자동 꺼짐 표시는 고른 확장의 선택 패널(다시 켜기)에 보인다. 고르지 않은 목록 위에는 없다
  const reenableText = t("desktop.workbench.reenable");

  test("확장 설정 알림을 받으면 목록을 다시 읽고, 같은 화면이 선택 패널과 개수를 새 값으로 그린다", async () => {
    const store = createWorkbenchStore();
    const seen: { listener: (() => void) | null; listed: readonly ExtListEntry[] } = {
      listener: null,
      listed: [WEB, REVIEW_OFF],
    };
    const commands = commandsWith({
      list: () => Promise.resolve(ok(seen.listed)),
      onChanged: (listener) => {
        seen.listener = listener;
        return () => {
          seen.listener = null;
        };
      },
    });
    const controller = controllerOf(store, commands);
    await controller.reload();

    const before = renderSeeded(pickGroup(store.actions.snapshot(), "review"));
    expect(before).toContain(reenableText);

    const stop = reloadOnExtChanges(commands.workbench, () => controller.reload());
    seen.listed = [WEB, REVIEW_ON];
    seen.listener?.();
    await settle();

    expect(store.actions.snapshot().entries).toEqual([WEB, REVIEW_ON]);
    const after = renderSeeded(pickGroup(store.actions.snapshot(), "review"));
    expect(after).not.toContain(reenableText);

    stop();
    expect(seen.listener).toBeNull();
  });
});

describe("scope: 전역 범위의 호출 인자는 범위를 붙이기 전과 같다", () => {
  test("목록은 대화 없이(threadId 없이) 읽고, 켜기·끄기는 사용자 범위로 쓴다", async () => {
    const store = createWorkbenchStore((s) => listLoaded(s, ENTRIES));
    const listed: (string | undefined)[] = [];
    const written: unknown[] = [];
    const commands = commandsWith({
      list: (threadId) => {
        listed.push(threadId);
        return Promise.resolve(ok(ENTRIES));
      },
      toggle: (request) => {
        written.push(request);
        return Promise.resolve(ok(null));
      },
    });

    await controllerOf(store, commands).toggle("web", false);

    expect(listed).toStrictEqual([undefined]);
    expect(written).toStrictEqual([{ key: "ext.web.enabled", value: false, scope: "user" }]);
  });
});

/** 안전 모드 값을 씌운 상태에서 컨트롤러를 받는다(서버 렌더라 효과는 돌지 않는다) */
function controllerInSafeMode(
  store: WorkbenchStore,
  commands: Commands,
  safe: boolean,
): WorkbenchController {
  const seen: { controller: WorkbenchController | null } = { controller: null };
  function Probe(): ReactNode {
    seen.controller = useWorkbenchController();
    return null;
  }
  const snapshot = safe ? { active: true, cause: null, startupFailures: 1, suggest: false } : null;
  renderToString(
    <EngineStoreContext value={harness().store.read}>
      <CommandsContext value={commands}>
        <WorkbenchStoreContext value={store}>
          <SafeModeContext value={snapshot}>
            <Probe />
          </SafeModeContext>
        </WorkbenchStoreContext>
      </CommandsContext>
    </EngineStoreContext>,
  );
  if (seen.controller === null) throw new Error("probe did not render");
  return seen.controller;
}

describe("안전 모드: 훅 질문은 스토어에 담기지 않는다", () => {
  const ASKED_HOOK: HookEntry = {
    hook: "no-rm-rf",
    fold: "first",
    handlers: 1,
    registrations: ["a"],
    external: true,
    keepOffQuestion: { rule: "consecutive", consecutive: 5, windowFailures: 5 },
  };

  test("안전 모드면 훅 질문을 읽어도 알림이 비고, 아니면 질문이 담긴다", async () => {
    const commands = commandsWith({ hooks: () => Promise.resolve(ok([ASKED_HOOK])) });
    const inSafe = createWorkbenchStore();
    const normal = createWorkbenchStore();
    await controllerInSafeMode(inSafe, commands, true).reloadOrders();
    await controllerInSafeMode(normal, commands, false).reloadOrders();
    expect(inSafe.read.getState().hookNotices).toEqual([]);
    expect(normal.read.getState().hookNotices).toEqual([
      {
        hook: "no-rm-rf",
        question: { rule: "consecutive", consecutive: 5, windowFailures: 5 },
        off: false,
        point: null,
      },
    ]);
  });
});
