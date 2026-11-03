import { describe, expect, test } from "bun:test";
import type {
  HooksOrderGetResult,
  HooksOrderPreviewParams,
  HooksOrderPreviewResult,
  HooksOrderResetParams,
  HooksOrderResetResult,
  HooksOrderSetParams,
  HooksOrderSetResult,
} from "@fresnel/contracts/wire";
import {
  commitOrder,
  proposeOrder,
  readOrders,
  resetOrder,
  type HookOrderPort,
} from "../../../src/workbench/canvas/order-flow.ts";

interface Replies {
  readonly get?: HooksOrderGetResult;
  readonly set?: HooksOrderSetResult;
  readonly reset?: HooksOrderResetResult;
  readonly preview?: HooksOrderPreviewResult;
  /** 있으면 모든 호출이 이 오류로 거절된다 */
  readonly fail?: Error;
}

interface Calls {
  get: number;
  set: HooksOrderSetParams[];
  reset: HooksOrderResetParams[];
  preview: HooksOrderPreviewParams[];
}

/** 호출을 기록하는 가짜 포트. 응답이 없는 메서드를 부르면 거절한다 */
function fakePort(replies: Replies): { port: HookOrderPort; calls: Calls } {
  const calls: Calls = { get: 0, set: [], reset: [], preview: [] };
  const answer = <T>(value: T | undefined, name: string): Promise<T> => {
    if (replies.fail !== undefined) return Promise.reject(replies.fail);
    if (value === undefined) return Promise.reject(new Error(`no reply for ${name}`));
    return Promise.resolve(value);
  };
  const port: HookOrderPort = {
    get: () => {
      calls.get += 1;
      return answer(replies.get, "get");
    },
    set: (params) => {
      calls.set.push(params);
      return answer(replies.set, "set");
    },
    reset: (params) => {
      calls.reset.push(params);
      return answer(replies.reset, "reset");
    },
    preview: (params) => {
      calls.preview.push(params);
      return answer(replies.preview, "preview");
    },
  };
  return { port, calls };
}

/** 거절된 값을 돌려준다. 이행되면 undefined라서 toBe가 실패한다 */
const rejectionOf = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );

const NAMES = new Map([
  ["allow", "Allow"],
  ["guard", "Guard"],
]);
const nameOf = (id: string): string => NAMES.get(id) ?? id;

const CLEAN_PREVIEW: HooksOrderPreviewResult = {
  hook: "pre",
  order: ["allow", "guard"],
  saveable: true,
  skips: [],
  valueChanges: [],
  autoDisable: [],
  guardRisk: [],
};

describe("proposeOrder", () => {
  test("guard가 맨 앞을 잃는 이동은 severity guard이고 set은 부르지 않는다", async () => {
    const preview: HooksOrderPreviewResult = {
      hook: "pre",
      order: ["allow", "guard"],
      saveable: true,
      skips: [],
      valueChanges: [],
      autoDisable: [],
      guardRisk: [
        {
          registrationId: "guard",
          extension: "sec",
          mayBeSkipped: true,
          losesFirstPosition: true,
          by: [{ registrationId: "allow", extension: "x", tier: 1 }],
        },
      ],
    };
    const { port, calls } = fakePort({ preview });

    const out = await proposeOrder(port, "pre", ["allow", "guard"], nameOf);

    expect(calls.preview).toEqual([{ hook: "pre", order: ["allow", "guard"] }]);
    expect(calls.set).toEqual([]);
    expect(out.order).toEqual(["allow", "guard"]);
    expect(out.warning.severity).toBe("guard");
    expect(out.warning.guardLosesFirst).toEqual(["Guard"]);
    expect(out.warning.guardMayBeSkipped).toEqual(["Guard"]);
  });

  test("아무 노트도 없으면 severity none이다", async () => {
    const { port, calls } = fakePort({ preview: CLEAN_PREVIEW });

    const out = await proposeOrder(port, "pre", ["allow", "guard"], nameOf);

    expect(out.warning.severity).toBe("none");
    expect(out.warning.skipped).toEqual([]);
    expect(calls.set).toEqual([]);
  });

  test("미리보기가 돌려준 순서를 그대로 싣는다", async () => {
    const { port } = fakePort({ preview: { ...CLEAN_PREVIEW, order: ["guard", "allow"] } });

    const out = await proposeOrder(port, "pre", ["allow", "guard"], nameOf);

    expect(out.order).toEqual(["guard", "allow"]);
  });

  test("포트의 오류는 그대로 올라온다", async () => {
    const boom = new Error("preview failed");
    const { port, calls } = fakePort({ fail: boom });

    expect(await rejectionOf(proposeOrder(port, "pre", ["allow"], nameOf))).toBe(boom);
    expect(calls.set).toEqual([]);
  });
});

describe("commitOrder", () => {
  test("set을 hook과 order로 한 번 부르고 saved와 appliesAt을 돌려준다", async () => {
    const set: HooksOrderSetResult = {
      hook: "pre",
      saved: ["guard", "allow"],
      appliesAt: "nextStepBoundary",
    };
    const { port, calls } = fakePort({ set });

    const out = await commitOrder(port, "pre", ["guard", "allow", "guard"]);

    expect(calls.set).toEqual([{ hook: "pre", order: ["guard", "allow", "guard"] }]);
    expect(calls.preview).toEqual([]);
    expect(out).toEqual({ saved: ["guard", "allow"], appliesAt: "nextStepBoundary" });
  });

  test("포트의 오류는 그대로 올라온다", async () => {
    const boom = new Error("set failed");
    const { port } = fakePort({ fail: boom });

    expect(await rejectionOf(commitOrder(port, "pre", ["allow"]))).toBe(boom);
  });
});

describe("resetOrder", () => {
  test("hook을 생략하면 빈 인자로 reset을 부른다", async () => {
    const reset: HooksOrderResetResult = { hooks: ["pre", "post"], appliesAt: "nextStepBoundary" };
    const { port, calls } = fakePort({ reset });

    const out = await resetOrder(port);

    expect(calls.reset).toEqual([{}]);
    expect(out).toEqual({ hooks: ["pre", "post"], appliesAt: "nextStepBoundary" });
  });

  test("hook을 주면 그 훅만 지운다", async () => {
    const reset: HooksOrderResetResult = { hooks: ["pre"], appliesAt: "nextStepBoundary" };
    const { port, calls } = fakePort({ reset });

    const out = await resetOrder(port, "pre");

    expect(calls.reset).toEqual([{ hook: "pre" }]);
    expect(out.hooks).toEqual(["pre"]);
  });

  test("포트의 오류는 그대로 올라온다", async () => {
    const boom = new Error("reset failed");
    const { port } = fakePort({ fail: boom });

    expect(await rejectionOf(resetOrder(port, "pre"))).toBe(boom);
  });
});

describe("readOrders", () => {
  test("get을 한 번 부르고 훅마다 applied, saved, pending을 모은다", async () => {
    const got: HooksOrderGetResult = {
      hooks: [
        { hook: "pre", saved: ["guard", "allow"], applied: ["allow", "guard"], pending: true },
        { hook: "post", saved: [], applied: ["allow"], pending: false },
      ],
    };
    const { port, calls } = fakePort({ get: got });

    const out = await readOrders(port);

    expect(calls.get).toBe(1);
    expect(out).toEqual({
      pre: { applied: ["allow", "guard"], saved: ["guard", "allow"], pending: true },
      post: { applied: ["allow"], saved: [], pending: false },
    });
  });

  test("훅이 없으면 빈 기록이다", async () => {
    const { port } = fakePort({ get: { hooks: [] } });

    expect(await readOrders(port)).toEqual({});
  });

  test("포트의 오류는 그대로 올라온다", async () => {
    const boom = new Error("get failed");
    const { port } = fakePort({ fail: boom });

    expect(await rejectionOf(readOrders(port))).toBe(boom);
  });
});
