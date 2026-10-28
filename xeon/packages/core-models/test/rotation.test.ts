import { describe, expect, test } from "bun:test";
import type { AssistantMessageEvent } from "@xeon/contracts/conversation";
import { flushMicrotasks } from "@xeon/ext-host/testing";
import { createAccountPool, type AccountDef } from "../src/accounts.ts";
import { retryAfterMsOf } from "../src/rotation.ts";
import type { ModelsSettings } from "../src/index.ts";
import { t, tape, type ModelTape } from "../src/testing/index.ts";
import { createHarness, type Harness } from "./support/harness.ts";

// L1.models.spec §4.8 (M3-REQ-85). 429 테이프로 계정이 바뀌는지, 기본 꺼짐과 첫 사용 고지, 정책(wait, switch, fail)을 값으로 본다.

const KEY_A = "sk-fake-account-a-0123456789";
const KEY_B = "sk-fake-account-b-0123456789";
const SECRETS = { "acct-a": KEY_A, "acct-b": KEY_B, "tape-key": "sk-fake-default-0123456789" };

function account(accountId: string, priority: number, reservePct = 0): AccountDef {
  return {
    provider: "tape",
    accountId,
    credential: `secret://acct-${accountId}`,
    priority,
    reservePct,
  };
}

const TWO: Partial<ModelsSettings> = {
  accounts: [account("a", 1), account("b", 2)],
  rotationAcknowledged: true,
};

const LIMITED = {
  role: "main",
  response: { type: "error", reason: "error", errorMessage: "429 rate limit exceeded" },
} as const;
const OK = {
  role: "main",
  response: { type: "message", content: [t.text("hello")], stopReason: "stop" },
} as const;

function harness(
  turns: ModelTape,
  settings: Partial<ModelsSettings>,
  rotationEnabled = true,
): Harness {
  return createHarness({ tape: turns, settings, rotationEnabled, secretValues: SECRETS });
}

function keysOf(h: Harness): readonly (string | undefined)[] {
  return h.fake.calls().map((call) => call.apiKey);
}

async function collect(
  stream: AsyncIterable<AssistantMessageEvent>,
): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("account rotation on a 429", () => {
  test("a 429 on the first account sends the same request with the second account's key", async () => {
    const h = harness(tape("rot/429", [LIMITED, OK]), TWO);
    const events = await collect(h.service.stream(h.request("hi")));
    expect(keysOf(h)).toEqual([KEY_A, KEY_B]);
    // 실패한 시도의 사건은 소비자에게 가지 않는다
    expect(events.map((event) => event.type)).not.toContain("error");
    const done = events.at(-1);
    expect(done?.type).toBe("done");
    if (done?.type !== "done") return;
    expect(done.message.content).toEqual([{ type: "text", text: "hello" }]);
  });

  test("complete() rotates too and the rested account is used again after its cooldown", async () => {
    const h = harness(tape("rot/complete", [LIMITED, OK, OK]), TWO);
    const first = await h.service.complete(h.request("hi"));
    expect(first.stopReason).toBe("stop");
    // a는 기본 60초 쉰다: 바로 다음 호출은 b로 간다
    await h.service.complete(h.request("again"));
    expect(keysOf(h)).toEqual([KEY_A, KEY_B, KEY_B]);
  });

  test("onLimit fail returns the 429 without trying the second account", async () => {
    const h = harness(tape("rot/fail", [LIMITED, OK]), {
      ...TWO,
      rateLimit: { tape: { minIntervalMs: 0, onLimit: "fail", maxWaitMs: 0 } },
    });
    const message = await h.service.stream(h.request("hi")).result();
    expect(message.stopReason).toBe("error");
    expect(h.service.classify(message)).toBe("rate_limited");
    expect(keysOf(h)).toEqual([KEY_A]);
    expect(h.player.remaining()).toBe(1);
  });

  test("when every account is limited the last 429 is returned", async () => {
    const h = harness(tape("rot/all", [LIMITED, LIMITED]), TWO);
    const message = await h.service.stream(h.request("hi")).result();
    expect(h.service.classify(message)).toBe("rate_limited");
    expect(keysOf(h)).toEqual([KEY_A, KEY_B]);
  });

  test("onLimit wait sleeps for retry-after on the same account and then retries it", async () => {
    const limited = {
      role: "main",
      response: {
        type: "error",
        reason: "error",
        errorMessage: "429 rate limit exceeded, retry-after: 2",
      },
    } as const;
    const h = harness(tape("rot/wait", [limited, OK]), {
      accounts: [account("a", 1)],
      rotationAcknowledged: true,
      rateLimit: { tape: { minIntervalMs: 0, onLimit: "wait", maxWaitMs: 5000 } },
    });
    const pending = h.service.stream(h.request("hi")).result();
    await flushMicrotasks();
    expect(keysOf(h)).toEqual([KEY_A]);
    h.clock.advance(1999);
    await flushMicrotasks();
    expect(keysOf(h)).toEqual([KEY_A]);
    h.clock.advance(1);
    const message = await pending;
    expect(message.stopReason).toBe("stop");
    expect(keysOf(h)).toEqual([KEY_A, KEY_A]);
  });

  test("a wait longer than maxWaitMs is not taken", async () => {
    const h = harness(tape("rot/too-long", [LIMITED]), {
      accounts: [account("a", 1)],
      rotationAcknowledged: true,
      rateLimit: { tape: { minIntervalMs: 0, onLimit: "wait", maxWaitMs: 1000 } },
    });
    const message = await h.service.stream(h.request("hi")).result();
    expect(h.service.classify(message)).toBe("rate_limited");
    expect(keysOf(h)).toEqual([KEY_A]);
  });

  test("a quota error drops the account for good and the next account answers", async () => {
    const quota = {
      role: "main",
      response: {
        type: "error",
        reason: "error",
        errorMessage: "You exceeded your current quota, please check your plan and billing details",
      },
    } as const;
    const h = harness(tape("rot/quota", [quota, OK, OK]), TWO);
    const first = await h.service.stream(h.request("hi")).result();
    expect(first.stopReason).toBe("stop");
    h.clock.advance(600_000);
    await h.service.stream(h.request("again")).result();
    expect(keysOf(h)).toEqual([KEY_A, KEY_B, KEY_B]);
  });

  test("a failure after content was sent is not retried", async () => {
    const partial = {
      role: "main",
      response: {
        type: "error",
        reason: "error",
        errorMessage: "429 rate limit exceeded",
        afterContent: [t.text("part")],
      },
    } as const;
    const h = harness(tape("rot/partial", [partial]), TWO);
    const events = await collect(h.service.stream(h.request("hi")));
    expect(keysOf(h)).toEqual([KEY_A]);
    expect(events.at(-1)?.type).toBe("error");
  });

  test("minIntervalMs holds a second request on the same account and not on another", async () => {
    const policy = { tape: { minIntervalMs: 1000, onLimit: "switch", maxWaitMs: 5000 } } as const;
    const single = harness(tape("rot/interval-1", [OK, OK]), {
      accounts: [account("a", 1)],
      rotationAcknowledged: true,
      rateLimit: policy,
    });
    await single.service.stream(single.request("one")).result();
    const second = single.service.stream(single.request("two")).result();
    await flushMicrotasks();
    expect(keysOf(single)).toEqual([KEY_A]);
    single.clock.advance(1000);
    await second;
    expect(keysOf(single)).toEqual([KEY_A, KEY_A]);

    const pair = harness(tape("rot/interval-2", [OK, OK]), { ...TWO, rateLimit: policy });
    await pair.service.stream(pair.request("one")).result();
    await pair.service.stream(pair.request("two")).result();
    expect(keysOf(pair)).toEqual([KEY_A, KEY_B]);
  });

  test("an unresolvable account credential ends with secret_unresolved and sends nothing", async () => {
    const h = harness(tape("rot/unresolved", [OK]), {
      accounts: [{ ...account("a", 1), credential: "secret://missing-key" }],
      rotationAcknowledged: true,
    });
    const message = await h.service.stream(h.request("hi")).result();
    expect(message.errorMessage).toStartWith("secret_unresolved:");
    expect(h.fake.calls()).toHaveLength(0);
    expect(h.player.remaining()).toBe(1);
  });
});

describe("default off and first-use notice", () => {
  test("without the plugin enabled accounts are ignored and the provider key is used", async () => {
    const h = harness(tape("rot/off", [OK]), TWO, false);
    await h.service.stream(h.request("hi")).result();
    expect(keysOf(h)).toEqual([SECRETS["tape-key"]]);
  });

  test("with the plugin on but the notice not acknowledged accounts are ignored", async () => {
    const h = harness(tape("rot/unacked", [OK]), { ...TWO, rotationAcknowledged: false });
    await h.service.stream(h.request("hi")).result();
    expect(keysOf(h)).toEqual([SECRETS["tape-key"]]);
  });
});

describe("account pool", () => {
  const late = account("late", 5);
  const first = account("first", 1);
  const reserved = account("reserved", 0, 20);
  const accounts = [late, first, reserved];

  test("picks by ascending priority and skips an account at its reserve", () => {
    const pool = createAccountPool();
    expect(pool.pick(accounts, "tape", 0)).toEqual({ kind: "account", account: reserved });
    pool.reportUtilization(reserved, 80);
    expect(pool.pick(accounts, "tape", 0)).toEqual({ kind: "account", account: first });
  });

  test("reports the wait until the soonest account is free and its cause", () => {
    const pool = createAccountPool(() => ({
      minIntervalMs: 500,
      onLimit: "wait",
      maxWaitMs: 9000,
    }));
    const only = account("a", 1);
    pool.markRequest(only, 1000);
    expect(pool.pick([only], "tape", 1200)).toEqual({
      kind: "wait",
      waitMs: 300,
      cause: "interval",
    });
    pool.markRateLimited(only, 1200, 4000);
    expect(pool.pick([only], "tape", 1300)).toEqual({
      kind: "wait",
      waitMs: 3900,
      cause: "cooldown",
    });
    expect(pool.pick([only], "tape", 5200)).toEqual({ kind: "account", account: only });
    expect(pool.pick([only], "other", 5200)).toEqual({ kind: "none" });
  });
});

describe("retry-after", () => {
  test("reads seconds and milliseconds from an error message", () => {
    expect(retryAfterMsOf("429 too many requests, retry-after: 2")).toBe(2000);
    expect(retryAfterMsOf("rate limited. Retry-After 1500ms")).toBe(1500);
    expect(retryAfterMsOf("429 rate limit exceeded")).toBeNull();
  });
});
