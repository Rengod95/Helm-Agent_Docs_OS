import { describe, expect, test } from "bun:test";
import type { AccountEntry, RateLimitEntry } from "@fresnel/client";
import { reprioritizedOf } from "../../src/views/pages/providers/providers-model.ts";
import { summary, thr } from "../state/helpers.ts";
import { engineFake, makeApp, until, type EngineExtra } from "./support.ts";

// 계정과 제공자, 예산과 한도(P-11)의 쓰기를 가짜 엔진 위에서 본다. 편집기는 초안을 바꾸고 저장은 컨트롤러가 `settings.set`
// 한 번으로 쓴다. 쓴 값은 편집기가 만든 값 그대로다(`toEqual`).

const RATE_KEY = "l1.models.rateLimit";
const ACCOUNTS_KEY = "l1.models.accounts";

/** 계정 목록은 객체 배열, 레이트 리밋은 provider → 정책 맵이다. 모양이 맞아야 위젯이 읽기 전용이 되지 않는다 */
const ACCOUNT_TYPE = {
  type: "array",
  items: {
    type: "object",
    properties: {
      provider: { type: "string" },
      accountId: { type: "string" },
      credential: { type: "string" },
      priority: { type: "integer" },
      reservePct: { type: "integer" },
    },
    required: ["provider", "accountId", "credential", "priority", "reservePct"],
    additionalProperties: false,
  },
};
const RATE_TYPE = {
  type: "object",
  additionalProperties: {
    type: "object",
    properties: {
      minIntervalMs: { type: "integer" },
      onLimit: { type: "string" },
      maxWaitMs: { type: "integer" },
    },
    required: ["minIntervalMs", "onLimit", "maxWaitMs"],
    additionalProperties: false,
  },
};

function defOf(key: string, tab: string, label: string) {
  return {
    key,
    type: key === RATE_KEY ? RATE_TYPE : ACCOUNT_TYPE,
    runtimeChange: "live",
    layer: "L1",
    allowedScopes: ["user", "project", "local", "launch"],
    since: "0.1.0",
    ui: { tab, widget: "table", order: 1, label },
  };
}

function setting(key: string, value: unknown) {
  return {
    key,
    value,
    source: { scope: "user" },
    locked: false,
    shadowed: [],
    runtimeChange: "live",
    pendingUntil: null,
    deprecated: false,
  };
}

const ANTHROPIC: RateLimitEntry = { minIntervalMs: 500, onLimit: "wait", maxWaitMs: 30000 };
const WORK: AccountEntry = {
  provider: "anthropic",
  accountId: "work",
  credential: "secret://ant-work",
  priority: 20,
  reservePct: 0,
};
const PERSONAL: AccountEntry = {
  provider: "anthropic",
  accountId: "personal",
  credential: "secret://ant-me",
  priority: 10,
  reservePct: 30,
};

const ACCOUNTS_VALUE = [WORK, PERSONAL];
const RATE_VALUE = { anthropic: ANTHROPIC };

function extraOf(): EngineExtra {
  return {
    results: {
      "settings.list": {
        defs: [defOf(RATE_KEY, "budgets", "레이트 리밋"), defOf(ACCOUNTS_KEY, "providers", "계정")],
      },
      "settings.get": {
        settings: [setting(RATE_KEY, RATE_VALUE), setting(ACCOUNTS_KEY, ACCOUNTS_VALUE)],
      },
      "settings.set": { setting: setting(RATE_KEY, RATE_VALUE) },
    },
  };
}

async function openLoaded() {
  const engine = engineFake([summary(thr(1))], undefined, extraOf());
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().link.phase === "live", "live link");
  const controller = app.commands.settings.open();
  if (controller === null) throw new Error("a live connection must give a controller");
  await controller.load();
  return { app, controller, params: engine.params };
}

const setCalls = (params: { method: string; params: unknown }[]) =>
  params.filter((entry) => entry.method === "settings.set");

describe("providers page writes", () => {
  test("rate-limit.save-writes-the-whole-policy-map", async () => {
    const { app, controller, params } = await openLoaded();
    // 정책 없는 provider를 더하면 간격 0, 전환, 대기 0으로 들어간다
    controller.edit(RATE_KEY, {
      anthropic: ANTHROPIC,
      openai: { minIntervalMs: 0, onLimit: "switch", maxWaitMs: 0 },
    });
    await controller.commit(RATE_KEY);
    expect(setCalls(params)).toEqual([
      {
        method: "settings.set",
        params: {
          key: RATE_KEY,
          value: {
            anthropic: ANTHROPIC,
            openai: { minIntervalMs: 0, onLimit: "switch", maxWaitMs: 0 },
          },
          scope: "user",
        },
      },
    ]);
    expect(controller.getState().drafts.has(RATE_KEY)).toBe(false);
    await controller.dispose();
    await app.stop();
  });

  test("account-order.save-writes-the-new-priorities", async () => {
    const { app, controller, params } = await openLoaded();
    // ↑로 personal을 work 앞에 두면 같은 provider 안에서 우선순위가 10 간격으로 다시 매겨진다
    controller.edit(
      ACCOUNTS_KEY,
      reprioritizedOf(ACCOUNTS_VALUE, "anthropic", ["personal", "work"]),
    );
    await controller.commit(ACCOUNTS_KEY);
    expect(setCalls(params)).toEqual([
      {
        method: "settings.set",
        params: {
          key: ACCOUNTS_KEY,
          value: [
            { ...WORK, priority: 10 },
            { ...PERSONAL, priority: 0 },
          ],
          scope: "user",
        },
      },
    ]);
    await controller.dispose();
    await app.stop();
  });
});
