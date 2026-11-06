import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { ok } from "@fresnel/contracts";
import type { UiNode } from "@fresnel/contracts/extensions";
import type { HostConnection } from "@fresnel/contracts/wire";
import { createPluginUiRuntime } from "../../../src/plugin-ui/runtime.ts";
import { createUiStore, type UiState } from "../../../src/state/ui/index.ts";
import type { ReadonlyStore } from "../../../src/state/shared/readonly-store.ts";
import { createConfirmQueue } from "../../../src/views/plugin/confirm-host.tsx";
import { PluginUiProvider } from "../../../src/views/plugin/plugin-context.tsx";
import { Providers } from "../../../src/views/providers.tsx";
import { StatusCellBox } from "../../../src/views/status-bar.tsx";
import { extGetOf, uiEntryOf } from "../../plugin-ui/support.ts";
import { fakeConnection, type ExtTable } from "../../state/fake-connection.ts";
import { harness, thr } from "../../state/helpers.ts";
import { fakeCommands } from "../fake-commands.ts";

// 값을 읽지 못한 상태 칸 감추기(효과가 도는 길). 서버 렌더는 효과를 돌리지 않으므로 linkedom DOM에 실제로 올려 본다.
// 읽기 연결은 대역이다: 확장 메서드가 실패하면 칸 전체가 숨고 진단 로그가 한 줄 남고, 성공하면 보이고 로그가 없다.

const TREE: UiNode = { type: "Chip", bind: { text: { path: "/status/phase" } } };
const ENTRY = uiEntryOf({ id: "phase", placement: "status", title: "단계", tree: TREE });

const STATUS_OK = { phase: "converge" };

type Warned = { readonly event: string; readonly fields: unknown };

function selectedThread(): ReadonlyStore<UiState> {
  const store = createUiStore();
  store.actions.selectThread(thr(1));
  const state = store.read.getState();
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => undefined };
}

/** 칸 하나를 DOM에 올리고 읽기가 끝나도록 기다린 뒤 칸의 DOM과 남은 로그를 돌려준다 */
async function mountCell(extTable: ExtTable): Promise<{
  readonly cell: Element | null;
  readonly warned: readonly Warned[];
  readonly stop: () => Promise<void>;
}> {
  const fake = fakeConnection(
    {
      "ext.get": () => Promise.resolve(extGetOf()),
      "command.list": () => Promise.resolve({ commands: [] }),
    },
    extTable,
  );
  const runtime = createPluginUiRuntime({
    withConnection: async <T,>(run: (connection: HostConnection) => Promise<T>) =>
      ok(await run(fake.connection)),
    appRootsInvoke: undefined,
    framesSupported: true,
  });
  const warned: Warned[] = [];
  const commands = fakeCommands({
    pluginUi: {
      withConnection: async <T,>(run: (connection: HostConnection) => Promise<T>) =>
        ok(await run(fake.connection)),
      current: () => fake.connection,
    },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <Providers engine={harness().store.read} ui={selectedThread()} commands={commands}>
        <PluginUiProvider
          value={{
            runtime,
            confirm: createConfirmQueue(),
            openExternal: () => Promise.resolve(),
            logger: { warn: (event, fields) => void warned.push({ event, fields }) },
          }}
        >
          <StatusCellBox entry={ENTRY} />
        </PluginUiProvider>
      </Providers>,
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
  return {
    cell: container.querySelector("[data-status-cell]"),
    warned,
    stop: () => act(async () => root.unmount()),
  };
}

const GLOBAL_KEYS = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "getComputedStyle",
  "IS_REACT_ACT_ENVIRONMENT",
] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();

beforeAll(() => {
  const { window, document } = parseHTML("<!doctype html><html><body></body></html>");
  for (const key of GLOBAL_KEYS) saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const values: Record<(typeof GLOBAL_KEYS)[number], unknown> = {
    window,
    document,
    navigator: window.navigator,
    Node: window.Node,
    HTMLElement: window.HTMLElement,
    // linkedom에 없는 브라우저 함수 둘(테마 읽기가 부른다): 값이 없는 빈 스타일과 항상 거짓인 미디어 질의
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const key of GLOBAL_KEYS) {
    Object.defineProperty(globalThis, key, {
      value: values[key],
      configurable: true,
      writable: true,
    });
  }
  Object.assign(window, {
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    matchMedia: () => ({ matches: false }),
  });
});

// 다른 시험 파일이 같은 프로세스에서 도므로 올린 전역을 원래대로 돌려 놓는다
afterAll(() => {
  for (const key of GLOBAL_KEYS) {
    const before = saved.get(key);
    if (before === undefined) Reflect.deleteProperty(globalThis, key);
    else Object.defineProperty(globalThis, key, before);
  }
});

describe("status cell hides when its value cannot be read", () => {
  test("a failing read hides the whole cell and logs one line with the extension and screen", async () => {
    const shown = await mountCell({
      "ext.helm.status": () => Promise.reject(new Error("methodNotFound")),
    });
    expect(shown.cell?.getAttribute("data-status-failed")).toBe("");
    expect(shown.cell?.getAttribute("class")).toContain("hidden");
    expect(shown.warned).toEqual([
      {
        event: "desktop.status_cell.hidden",
        fields: { extension: "helm", screen: "phase", reason: "read_failed" },
      },
    ]);
    await shown.stop();
  });

  test("a good read keeps the cell visible with its text and logs nothing", async () => {
    const shown = await mountCell({ "ext.helm.status": () => Promise.resolve(STATUS_OK) });
    expect(shown.cell?.getAttribute("data-status-failed")).toBeNull();
    expect(shown.cell?.getAttribute("class")).not.toContain("hidden");
    expect(shown.cell?.textContent).toContain("converge");
    expect(shown.warned).toEqual([]);
    await shown.stop();
  });
});
