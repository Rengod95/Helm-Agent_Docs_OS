import { describe, expect, test } from "bun:test";
import { err, ok, type Result } from "@fresnel/contracts";
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
  type OrderPortError,
} from "../../../src/workbench/canvas/order-flow.ts";

interface Replies {
  readonly get?: Result<HooksOrderGetResult, OrderPortError>;
  readonly set?: Result<HooksOrderSetResult, OrderPortError>;
  readonly reset?: Result<HooksOrderResetResult, OrderPortError>;
  readonly preview?: Result<HooksOrderPreviewResult, OrderPortError>;
  /** 있으면 모든 호출이 이 오류 값으로 실패한다(던지지 않고 err를 돌려준다) */
  readonly fail?: OrderPortError;
}

interface Calls {
  get: number;
  set: HooksOrderSetParams[];
  reset: HooksOrderResetParams[];
  preview: HooksOrderPreviewParams[];
}

/** 호출을 기록하는 가짜 포트. 응답이 없는 메서드를 부르면 시험 설정 오류로 거절한다 */
function fakePort(replies: Replies): { port: HookOrderPort; calls: Calls } {
  const calls: Calls = { get: 0, set: [], reset: [], preview: [] };
  const answer = <T>(
    reply: Result<T, OrderPortError> | undefined,
    name: string,
  ): Promise<Result<T, OrderPortError>> => {
    if (replies.fail !== undefined) return Promise.resolve(err(replies.fail));
    if (reply === undefined) return Promise.reject(new Error(`no reply for ${name}`));
    return Promise.resolve(reply);
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

/** 성공 값을 꺼낸다. err면 시험을 실패시킨다(그 뒤 값 검사를 이어 하려고 쓴다) */
function okValue<T>(r: Result<T, OrderPortError>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.kind}`);
  return r.value;
}

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
    const { port, calls } = fakePort({ preview: ok(preview) });

    const out = okValue(await proposeOrder(port, "pre", ["allow", "guard"], nameOf));

    expect(calls.preview).toEqual([{ hook: "pre", order: ["allow", "guard"] }]);
    expect(calls.set).toEqual([]);
    expect(out.order).toEqual(["allow", "guard"]);
    expect(out.warning.severity).toBe("guard");
    expect(out.warning.guardLosesFirst).toEqual(["Guard"]);
    expect(out.warning.guardMayBeSkipped).toEqual(["Guard"]);
  });

  test("아무 노트도 없으면 severity none이다", async () => {
    const { port, calls } = fakePort({ preview: ok(CLEAN_PREVIEW) });

    const out = okValue(await proposeOrder(port, "pre", ["allow", "guard"], nameOf));

    expect(out.warning.severity).toBe("none");
    expect(out.warning.skipped).toEqual([]);
    expect(calls.set).toEqual([]);
  });

  test("미리보기가 돌려준 순서를 그대로 싣는다", async () => {
    const { port } = fakePort({
      preview: ok({ ...CLEAN_PREVIEW, order: ["guard", "allow"] }),
    });

    const out = okValue(await proposeOrder(port, "pre", ["allow", "guard"], nameOf));

    expect(out.order).toEqual(["guard", "allow"]);
  });

  test("포트가 err를 돌려주면 그 값을 그대로 돌려주고 set은 부르지 않는다", async () => {
    const { port, calls } = fakePort({ fail: { kind: "offline" } });

    expect(await proposeOrder(port, "pre", ["allow"], nameOf)).toEqual(err({ kind: "offline" }));
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
    const { port, calls } = fakePort({ set: ok(set) });

    const out = await commitOrder(port, "pre", ["guard", "allow", "guard"]);

    expect(calls.set).toEqual([{ hook: "pre", order: ["guard", "allow", "guard"] }]);
    expect(calls.preview).toEqual([]);
    expect(out).toEqual(ok({ saved: ["guard", "allow"], appliesAt: "nextStepBoundary" }));
  });

  test("포트가 err를 돌려주면 그 값을 그대로 돌려준다", async () => {
    const { port, calls } = fakePort({
      set: err({ kind: "rejected", code: 3102, detail: "bad order" }),
    });

    expect(await commitOrder(port, "pre", ["allow"])).toEqual(
      err({ kind: "rejected", code: 3102, detail: "bad order" }),
    );
    expect(calls.set).toEqual([{ hook: "pre", order: ["allow"] }]);
  });
});

describe("resetOrder", () => {
  test("hook을 생략하면 빈 인자로 reset을 부른다", async () => {
    const reset: HooksOrderResetResult = { hooks: ["pre", "post"], appliesAt: "nextStepBoundary" };
    const { port, calls } = fakePort({ reset: ok(reset) });

    const out = await resetOrder(port);

    expect(calls.reset).toEqual([{}]);
    expect(out).toEqual(ok({ hooks: ["pre", "post"], appliesAt: "nextStepBoundary" }));
  });

  test("hook을 주면 그 훅만 지운다", async () => {
    const reset: HooksOrderResetResult = { hooks: ["pre"], appliesAt: "nextStepBoundary" };
    const { port, calls } = fakePort({ reset: ok(reset) });

    const out = await resetOrder(port, "pre");

    expect(calls.reset).toEqual([{ hook: "pre" }]);
    expect(out).toEqual(ok({ hooks: ["pre"], appliesAt: "nextStepBoundary" }));
  });

  test("포트가 err를 돌려주면 그 값을 그대로 돌려준다", async () => {
    const { port } = fakePort({ fail: { kind: "unsupported" } });

    expect(await resetOrder(port, "pre")).toEqual(err({ kind: "unsupported" }));
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
    const { port, calls } = fakePort({ get: ok(got) });

    const out = await readOrders(port);

    expect(calls.get).toBe(1);
    expect(out).toEqual(
      ok({
        pre: { applied: ["allow", "guard"], saved: ["guard", "allow"], pending: true },
        post: { applied: ["allow"], saved: [], pending: false },
      }),
    );
  });

  test("훅이 없으면 빈 기록이다", async () => {
    const { port } = fakePort({ get: ok({ hooks: [] }) });

    expect(await readOrders(port)).toEqual(ok({}));
  });

  test("포트가 err를 돌려주면 그 값을 그대로 돌려준다", async () => {
    const { port } = fakePort({ fail: { kind: "switching" } });

    expect(await readOrders(port)).toEqual(err({ kind: "switching" }));
  });
});
