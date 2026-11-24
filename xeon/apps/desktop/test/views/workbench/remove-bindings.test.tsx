import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { openDetail, pickPlugin } from "@fresnel/client/workbench";
import { err, ok } from "@fresnel/contracts";
import type { CapabilityBinding, ExtListEntry } from "@fresnel/contracts/wire";
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
import { bindingRowsOf, unmetCountOf } from "../../../src/views/workbench/bindings-model.ts";
import {
  useWorkbenchController,
  type WorkbenchController,
} from "../../../src/views/workbench/controller.ts";
import {
  REMOVE_BODY_TEXT,
  REMOVE_REQUESTED_TEXT,
  removableOf,
} from "../../../src/views/workbench/remove-model.ts";
import { DetailActions } from "../../../src/views/workbench/detail-actions.tsx";
import { harness } from "../../state/helpers.ts";
import { fakeCommands } from "../fake-commands.ts";
import { entry, inContexts, screenStore } from "./support.tsx";

const noop = (): void => undefined;

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

describe("지우기 판단", () => {
  test("사용자 위치의 설치본만 지운다", () => {
    expect(removableOf({ origin: "user" })).toBe(true);
    expect(removableOf({ origin: "builtin" })).toBe(false);
    expect(removableOf({ origin: "managed" })).toBe(false);
    expect(removableOf({ origin: "project" })).toBe(false);
    expect(removableOf({})).toBe(false);
  });

  test("지우기 요청은 리뷰에 올렸다는 문장이다(바로 지웠다고 쓰지 않는다)", () => {
    expect(REMOVE_REQUESTED_TEXT).toBe("desktop.workbench.remove.requested");
    expect(t(REMOVE_REQUESTED_TEXT)).toContain("리뷰");
  });

  test("확인 상자 본문은 리뷰로 보낸다고 적고, 바로 지운다거나 Turn이라고 쓰지 않는다", () => {
    expect(REMOVE_BODY_TEXT).toBe("desktop.workbench.remove.body");
    const body = t(REMOVE_BODY_TEXT);
    expect(body).toContain("지우기 요청을 리뷰로 보내요. 리뷰에서 승인하면 이 플러그인이 지워지고");
    expect(body).not.toContain("Turn");
    expect(body).not.toContain("바로");
  });
});

describe("controller.remove", () => {
  test("plugin.requestRemove에 이름을 보내고, 요청이 되면 자세히를 닫고 목록을 다시 읽는다", async () => {
    const web = entry("web");
    const store = createWorkbenchStore((s) => openDetail(pickPlugin(s, "web"), "web"));
    const sent: string[] = [];
    let listed = 0;
    const commands = commandsWith({
      remove: (name) => {
        sent.push(name);
        return Promise.resolve(ok({ itemId: "rvw_1" }));
      },
      list: () => {
        listed += 1;
        return Promise.resolve(ok([web]));
      },
      get: () => Promise.resolve(err({ kind: "offline" })),
      health: () => Promise.resolve(ok([])),
      hooks: () => Promise.resolve(ok([])),
      orderGet: () => Promise.resolve(ok({ hooks: [] })),
    });

    const done = await controllerOf(store, commands).remove("web");

    expect(done).toEqual({ outcome: "removed", refusal: null });
    expect(sent).toEqual(["web"]);
    expect(listed).toBe(1);
    expect(store.actions.snapshot().detail).toBeNull();
  });

  test("거절되면 failed이고 목록을 다시 읽지 않는다", async () => {
    const store = createWorkbenchStore();
    let listed = 0;
    const commands = commandsWith({
      remove: () => Promise.resolve(err({ kind: "rejected", code: 3405 })),
      list: () => {
        listed += 1;
        return Promise.resolve(ok([]));
      },
    });
    expect(await controllerOf(store, commands).remove("web")).toEqual({
      outcome: "failed",
      refusal: null,
    });
    expect(listed).toBe(0);
  });

  test("꼭 기대는 쪽이 있어 거절되면(3627) refused와 그 목록을 돌려주고 목록을 다시 읽지 않는다", async () => {
    const store = createWorkbenchStore();
    let listed = 0;
    const dependency = {
      reason: "required_by",
      plugin: "web",
      items: [
        {
          from: "notes",
          target: "web",
          kind: "hard",
          range: null,
          problem: "depended_on",
          found: null,
        },
      ],
    } as const;
    const commands = commandsWith({
      remove: () => Promise.resolve(err({ kind: "rejected", code: 3627, dependency })),
      list: () => {
        listed += 1;
        return Promise.resolve(ok([]));
      },
    });
    expect(await controllerOf(store, commands).remove("web")).toEqual({
      outcome: "refused",
      refusal: dependency,
    });
    expect(listed).toBe(0);
  });

  test("이미 없는 이름(3401)이면 gone이고 낡은 목록을 다시 읽는다", async () => {
    const store = createWorkbenchStore();
    let listed = 0;
    const commands = commandsWith({
      remove: () => Promise.resolve(err({ kind: "rejected", code: 3401 })),
      list: () => {
        listed += 1;
        return Promise.resolve(ok([]));
      },
      health: () => Promise.resolve(ok([])),
      hooks: () => Promise.resolve(ok([])),
      orderGet: () => Promise.resolve(ok({ hooks: [] })),
    });
    expect(await controllerOf(store, commands).remove("web")).toEqual({
      outcome: "gone",
      refusal: null,
    });
    expect(listed).toBe(1);
  });
});

describe("지우기 확인의 보내기", () => {
  test("확인은 이름 하나만 plugin.requestRemove로 넘긴다(저장 데이터 옵션은 없다)", async () => {
    const seen: unknown[][] = [];
    const commands = commandsWith({
      remove: (...args) => {
        seen.push(args);
        return Promise.resolve(ok({ itemId: "rvw_1" }));
      },
      list: () => Promise.resolve(ok([])),
    });
    const done = await controllerOf(createWorkbenchStore(), commands).remove("web");
    expect(done).toEqual({ outcome: "removed", refusal: null });
    expect(seen).toEqual([["web"]]);
  });
});

/** 상세의 머리 행동을 그린다(plugHead: 시스템 머리줄 오른쪽). 지우기는 "…" 메뉴 안에 있다 */
function headerHtml(target: ExtListEntry): string {
  const store = screenStore();
  return renderToString(
    inContexts(
      <DetailActions entry={target} profiles={{ set: null, reload: noop }} onRemove={noop} />,
      store,
    ),
  );
}

const MENU = `aria-label="${t("desktop.workbench.detail.menu")}"`;

describe("지우기 메뉴", () => {
  test("사용자 설치본은 머리에 지우기가 든 메뉴가 있다", () => {
    expect(headerHtml(entry("web", { origin: "user" }))).toContain(MENU);
  });

  test("내장 확장은 지울 수 없어 메뉴를 두지 않는다", () => {
    expect(headerHtml(entry("notes", { origin: "builtin" }))).not.toContain(MENU);
  });
});

const BINDINGS: readonly CapabilityBinding[] = [
  {
    capability: "search.web",
    provider: { registrationId: "web", version: "1.2.0" },
    consumers: [
      { registrationId: "review", relation: "requires" },
      { registrationId: "notes", relation: "optional" },
    ],
    unmet: false,
  },
  {
    capability: "mail.send",
    provider: null,
    consumers: [{ registrationId: "inbox", relation: "requires" }],
    unmet: true,
  },
  { capability: "calendar.read", provider: null, consumers: [], unmet: true },
];

describe("기능 연결 행", () => {
  test("공급자 없는 기능을 앞에 두고 같은 쪽은 기능 id 순서다", () => {
    const rows = bindingRowsOf(BINDINGS);
    expect(rows.map((r) => r.capability)).toEqual(["calendar.read", "mail.send", "search.web"]);
    expect(unmetCountOf(rows)).toBe(2);
  });

  test("공급자는 등록 id와 버전, 받는 쪽은 필수와 선택으로 가른다", () => {
    const row = bindingRowsOf(BINDINGS).find((r) => r.capability === "search.web");
    expect(row).toEqual({
      capability: "search.web",
      provider: "web 1.2.0",
      requires: ["review"],
      optional: ["notes"],
      unmet: false,
    });
  });
});
