import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { ok } from "@fresnel/contracts";
import type { RemoteAdapter } from "../../../src/app/remote/remote-adapter.ts";
import {
  createFakeRemoteAdapter,
  FAKE_NOW,
  FAKE_OFF_STATUS,
  type FakeRemoteAdapter,
} from "../../../src/app/remote/fake-remote-adapter.ts";
import {
  useRemoteController,
  type RemoteActions,
  type RemoteScreen,
  type RemoteServiceCommands,
} from "../../../src/app/remote/use-remote-controller.ts";
import type { RemoteDevice } from "../../../src/app/remote/remote-types.ts";

// 원격 접속 훅을 얇은 구성 요소에 올려 시험한다. 연결 화면 시험과 같이 linkedom DOM을 전역에 올리고 끝나면 되돌린다.
// 훅의 실제 타이머는 쓰지 않는다. 시험은 읽기 응답이 돌아올 만큼만 기다리고, 마운트는 끝날 때 반드시 푼다.

const GLOBAL_KEYS = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
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
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const key of GLOBAL_KEYS) {
    Object.defineProperty(globalThis, key, {
      value: values[key],
      configurable: true,
      writable: true,
    });
  }
});

afterAll(() => {
  for (const key of GLOBAL_KEYS) {
    const before = saved.get(key);
    if (before === undefined) Reflect.deleteProperty(globalThis, key);
    else Object.defineProperty(globalThis, key, before);
  }
});

const WEB_DEVICE: RemoteDevice = {
  id: "dev-a",
  name: "노트북",
  kind: "web",
  createdAt: 1,
  lastSeenAt: null,
  address: null,
};

const DESKTOP_DEVICE: RemoteDevice = {
  id: "dev-b",
  name: "데스크톱",
  kind: "desktop",
  createdAt: 2,
  lastSeenAt: null,
  address: null,
};

const SERVICE: RemoteServiceCommands = {
  startLocalService: () => Promise.resolve(ok(null)),
  stopLocalService: () => Promise.resolve(ok(null)),
};

/** 훅을 쓰는 가장 얇은 구성 요소. 마지막으로 그린 결과를 `seen`에 남긴다 */
function Probe(props: {
  readonly adapter: RemoteAdapter;
  readonly seen: { current: RemoteScreen | null };
}) {
  const screen = useRemoteController(props.adapter, SERVICE);
  props.seen.current = screen;
  return <p>{screen.state.status.kind}</p>;
}

interface Mounted {
  readonly seen: { current: RemoteScreen | null };
  readonly unmount: () => Promise<void>;
}

/** 구성 요소를 올린다. 떠날 때는 `unmount`로 내린다 */
async function mount(adapter: RemoteAdapter): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const seen: { current: RemoteScreen | null } = { current: null };
  await act(async () => {
    root.render(<Probe adapter={adapter} seen={seen} />);
  });
  return {
    seen,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** 읽기 응답이 모두 돌아올 때까지 한 바퀴 양보한다. 실제 대기는 없다 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setImmediate(() => {
        resolve();
      });
    });
  });
}

/** 마지막으로 그린 결과의 동작. 그린 적이 없으면 시험이 틀린 것이다 */
function actionsOf(seen: { current: RemoteScreen | null }): RemoteActions {
  const screen = seen.current;
  if (screen === null) throw new Error("훅이 아직 그려지지 않았다");
  return screen.actions;
}

describe("원격 접속 훅", () => {
  test("마운트하면 상태와 기기 목록을 한 번씩 읽고 그 결과를 그린다", async () => {
    const fake: FakeRemoteAdapter = createFakeRemoteAdapter({ devices: [WEB_DEVICE] });
    const mounted = await mount(fake);
    await flush();
    expect(fake.calls).toEqual([{ method: "status" }, { method: "devices" }]);
    expect(mounted.seen.current?.state.status).toEqual({ kind: "ready", value: FAKE_OFF_STATUS });
    expect(mounted.seen.current?.state.devices).toEqual({ kind: "ready", value: [WEB_DEVICE] });
    await mounted.unmount();
  });

  test("동작을 부르면 바뀐 상태가 다시 그려진다", async () => {
    const fake = createFakeRemoteAdapter({
      devices: [WEB_DEVICE, DESKTOP_DEVICE],
      now: () => FAKE_NOW,
    });
    const mounted = await mount(fake);
    await flush();
    await act(async () => {
      await actionsOf(mounted.seen).revoke({ id: "dev-a" });
    });
    expect(mounted.seen.current?.state.devices).toEqual({ kind: "ready", value: [DESKTOP_DEVICE] });
    await mounted.unmount();
  });

  test("떠나면 멈추고, 다시 올리면 상태를 새로 읽는다", async () => {
    const fake = createFakeRemoteAdapter();
    const first = await mount(fake);
    await flush();
    await first.unmount();
    const second = await mount(fake);
    await flush();
    const reads = fake.calls.filter((call) => call.method === "status").length;
    expect(reads).toBe(2);
    await second.unmount();
  });
});
