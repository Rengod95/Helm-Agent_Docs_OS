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
import { removableOf, removeDoneText } from "../../../src/views/workbench/remove-model.ts";
import { SelectionPanel } from "../../../src/views/workbench/selection-panel.tsx";
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

  test("적용 시점마다 다른 문장을 고른다", () => {
    expect(t(removeDoneText("now"))).toBe(t("desktop.workbench.remove.done.now"));
    expect(t(removeDoneText("nextStepBoundary"))).toBe(t("desktop.workbench.remove.done.boundary"));
    expect(t(removeDoneText("restart"))).toBe(t("desktop.workbench.remove.done.restart"));
    expect(t("desktop.workbench.remove.done.now")).not.toBe(
      t("desktop.workbench.remove.done.restart"),
    );
  });

  test("확인 문구는 실행 중인 Turn에서 바로 빠진다고 적는다", () => {
    expect(t("desktop.workbench.remove.body")).toContain("실행 중인 Turn");
  });
});

describe("controller.remove", () => {
  test("ext.remove에 이름을 보내고, 성공하면 자세히를 닫고 목록을 다시 읽는다", async () => {
    const web = entry("web");
    const store = createWorkbenchStore((s) => openDetail(pickPlugin(s, "web"), "web"));
    const sent: string[] = [];
    let listed = 0;
    const commands = commandsWith({
      remove: (name) => {
        sent.push(name);
        return Promise.resolve(ok({ name, appliesAt: "now" }));
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

    expect(done).toBe(true);
    expect(sent).toEqual(["web"]);
    expect(listed).toBe(1);
    expect(store.actions.snapshot().detail).toBeNull();
  });

  test("거절되면 false이고 목록을 다시 읽지 않는다", async () => {
    const store = createWorkbenchStore();
    let listed = 0;
    const commands = commandsWith({
      remove: () => Promise.resolve(err({ kind: "rejected", code: 3405 })),
      list: () => {
        listed += 1;
        return Promise.resolve(ok([]));
      },
    });
    expect(await controllerOf(store, commands).remove("web")).toBe(false);
    expect(listed).toBe(0);
  });

  test("이미 없는 이름(3401)이면 false이고 낡은 목록을 다시 읽는다", async () => {
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
    expect(await controllerOf(store, commands).remove("web")).toBe(false);
    expect(listed).toBe(1);
  });
});

function panelHtml(target: ExtListEntry): string {
  const store = screenStore();
  return renderToString(
    inContexts(
      <SelectionPanel
        state={store.actions.snapshot()}
        entry={target}
        onToggle={noop}
        onDetail={noop}
        onClear={noop}
        onReenable={noop}
        onKeepOff={noop}
        onRemove={noop}
      />,
      store,
    ),
  );
}

/** "지우기" 단추의 여는 태그 */
function removeButtonTag(html: string): string {
  const label = t("desktop.workbench.remove.open");
  const found = [...html.matchAll(/<button[^>]*>/g)].find((m) => {
    const after = html.slice(m.index + m[0].length);
    return after.startsWith(label);
  });
  if (found === undefined) throw new Error("remove button not rendered");
  return found[0];
}

describe("지우기 단추", () => {
  test("사용자 설치본은 누를 수 있다", () => {
    expect(removeButtonTag(panelHtml(entry("web", { origin: "user" })))).not.toContain(
      'disabled=""',
    );
  });

  test("내장 확장은 꺼져 있다", () => {
    expect(removeButtonTag(panelHtml(entry("core-loop", { origin: "builtin" })))).toContain(
      'disabled=""',
    );
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
