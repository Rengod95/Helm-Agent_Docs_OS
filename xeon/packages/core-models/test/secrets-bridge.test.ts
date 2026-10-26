import { describe, expect, test } from "bun:test";
import type { AssistantMessageEvent } from "@xeon/contracts/conversation";
import type { UsageRecord } from "@xeon/contracts/services";
import { err } from "@xeon/contracts";
import { parseSecretRef } from "@xeon/contracts/capabilities";
import {
  createSecretResolver,
  secretBackedCredentialStore,
  type CredentialFailure,
} from "../src/secrets-bridge.ts";
import { memorySecrets, t, tape } from "../src/testing/index.ts";
import { createHarness, FAKE_KEY } from "./support/harness.ts";
import { memoryLogger, type LogLine } from "./support/logger.ts";
import { rejectionOf } from "./support/rejection.ts";

const ONE_TURN = tape("core-models/secret", [
  { role: "main", response: { type: "message", content: [t.text("ok")], stopReason: "stop" } },
]);

describe("secret_ref_resolved_at_request_time_only", () => {
  test("the secret service is not touched when the service is created or a role is resolved", () => {
    const h = createHarness({ tape: ONE_TURN });
    h.resolve();
    h.service.list();
    expect(h.secrets.leaseCalls()).toBe(0);
    expect(h.secrets.valueReads()).toBe(0);
  });

  test("the number of resolutions equals the number of requests, with no caching", async () => {
    const h = createHarness({
      tape: tape("core-models/secret-three", [
        { role: "main", response: { type: "message", content: [t.text("1")], stopReason: "stop" } },
        { role: "main", response: { type: "message", content: [t.text("2")], stopReason: "stop" } },
        { role: "main", response: { type: "message", content: [t.text("3")], stopReason: "stop" } },
      ]),
    });
    await h.service.stream(h.request("a")).result();
    expect(h.secrets.leaseCalls()).toBe(1);
    await h.service.stream(h.request("b")).result();
    await h.service.stream(h.request("c")).result();
    expect(h.secrets.leaseCalls()).toBe(3);
    expect(h.secrets.valueReads()).toBe(3);
  });

  test("the resolved key reaches the provider request and nothing else", async () => {
    const seen: unknown[] = [];
    const h = createHarness({
      tape: ONE_TURN,
      dispatcher: {
        beforeProviderRequest(input) {
          seen.push(input);
          return Promise.resolve(input.payload);
        },
      },
    });
    const records: UsageRecord[] = [];
    h.service.usage.subscribe((record) => {
      records.push(record);
    });
    const events: AssistantMessageEvent[] = [];
    for await (const event of h.service.stream(h.request("hi"))) events.push(event);

    // 해석한 값은 요청 옵션(헤더로 나가는 apiKey)으로 provider에 도착했다
    expect(h.fake.calls()[0]?.apiKey).toBe(FAKE_KEY);
    // 지점 페이로드, 이벤트, 사용량 기록, 요청 페이로드, 서비스 목록 어디에도 없다
    for (const output of [seen, events, records, h.fake.calls()[0]?.payload, h.service.list()]) {
      expect(JSON.stringify(output)).not.toContain(FAKE_KEY);
    }
  });

  test("the lease uses runtime-http mode with the provider purpose and the request host", async () => {
    const h = createHarness({ tape: ONE_TURN });
    await h.service.stream(h.request("hi")).result();
    expect(h.secrets.lastCtx()).toMatchObject({
      mode: "runtime-http",
      purpose: "model.provider:tape",
      target: { kind: "host", host: "127.0.0.1", port: 9 },
      actor: "runtime",
      approval: null,
    });
  });

  test("an unresolvable reference ends with secret_unresolved, sends no request and leaks no value", async () => {
    const h = createHarness({ tape: ONE_TURN, secretValues: {} });
    const message = await h.service.stream(h.request("hi")).result();
    expect(message.stopReason).toBe("error");
    expect(message.errorMessage).toStartWith("secret_unresolved:");
    expect(message.errorMessage).toContain("tape-key");
    expect(h.service.classify(message)).toBe("secret_unresolved");
    expect(h.fake.calls()).toHaveLength(0);
    expect(h.player.remaining()).toBe(1);
  });

  test("a lease denied by the policy names the deny reason, not the secret value", async () => {
    const h = createHarness({ tape: ONE_TURN });
    const parsed = parseSecretRef("secret://tape-key");
    if (!parsed.ok) throw new Error("the fixture reference is valid");
    const { handle } = parsed.value;
    const resolver = createSecretResolver(
      {
        ...h.secrets.service,
        lease: () => Promise.resolve(err({ kind: "denied", handle, reason: "mode_not_allowed" })),
      },
      {},
    );
    const resolved = await resolver.resolve("secret://tape-key", "tape", "model.provider:tape");
    expect(resolved).toEqual({
      ok: false,
      error: {
        kind: "secret_unresolved",
        providerId: "tape",
        secretName: "tape-key",
        reason: "secret tape-key could not be leased (denied: mode_not_allowed)",
      },
    });
  });

  test("the log names the secret reference and never the value", async () => {
    const lines: LogLine[] = [];
    const h = createHarness({ tape: ONE_TURN, logger: memoryLogger(lines) });
    h.secrets.setMissing("tape-key", true);
    await h.service.stream(h.request("hi")).result();
    expect(lines.map((line) => line.event)).toContain("model.secret_unresolved");
    const logged = lines.find((line) => line.event === "model.secret_unresolved");
    expect(logged?.fields).toEqual({ provider: "tape", secretName: "tape-key" });
    expect(JSON.stringify(lines)).not.toContain(FAKE_KEY);
  });

  test("a malformed reference is also secret_unresolved", async () => {
    const h = createHarness({
      tape: ONE_TURN,
      settings: {
        providers: [{ id: "tape", enabled: true, apiKeyRef: "$ANTHROPIC_API_KEY", baseUrl: null }],
      },
    });
    const message = await h.service.stream(h.request("hi")).result();
    expect(h.service.classify(message)).toBe("secret_unresolved");
    expect(h.fake.calls()).toHaveLength(0);
  });

  test("the failure of an earlier call does not turn a later provider error into secret_unresolved", async () => {
    const h = createHarness({
      tape: tape("core-models/secret-recovers", [
        {
          role: "main",
          response: { type: "error", reason: "error", errorMessage: "400 invalid_request_error" },
        },
      ]),
    });
    h.secrets.setMissing("tape-key", true);
    const first = await h.service.stream(h.request("one")).result();
    expect(h.service.classify(first)).toBe("secret_unresolved");
    h.secrets.setMissing("tape-key", false);
    const second = await h.service.stream(h.request("two")).result();
    expect(h.service.classify(second)).toBe("provider_error");
  });

  test("error text that contains the key is masked in the terminal message", async () => {
    const h = createHarness({
      tape: tape("core-models/secret-echo", [
        {
          role: "main",
          response: {
            type: "error",
            reason: "error",
            errorMessage: `401 invalid x-api-key ${FAKE_KEY}`,
          },
        },
      ]),
    });
    const message = await h.service.stream(h.request("hi")).result();
    expect(message.errorMessage).toContain("401 invalid x-api-key");
    expect(message.errorMessage).not.toContain(FAKE_KEY);
    expect(message.errorMessage).toContain("[secret:tape-key]");
    expect(h.service.classify(message)).toBe("auth");
  });

  test("a provider without a reference gets no stored credential (ambient resolution applies)", async () => {
    const secrets = memorySecrets({ "tape-key": FAKE_KEY });
    const store = secretBackedCredentialStore({ get: () => null, ids: () => [] }, secrets.service);
    expect(await store.read("anything")).toBeUndefined();
    expect(secrets.leaseCalls()).toBe(0);
  });
});

describe("secretBackedCredentialStore", () => {
  const refs = {
    get: (id: string) => (id === "tape" ? "secret://tape-key" : null),
    ids: () => ["tape"],
  };

  test("read returns an api key credential and closes the lease", async () => {
    const secrets = memorySecrets({ "tape-key": FAKE_KEY });
    const store = secretBackedCredentialStore(refs, secrets.service);
    expect(await store.read("tape")).toEqual({ type: "api_key", key: FAKE_KEY });
  });

  test("list returns provider ids and types only", async () => {
    const secrets = memorySecrets({ "tape-key": FAKE_KEY });
    const store = secretBackedCredentialStore(refs, secrets.service);
    const listed = await store.list();
    expect(listed).toEqual([{ providerId: "tape", type: "api_key" }]);
    expect(JSON.stringify(listed)).not.toContain(FAKE_KEY);
    expect(secrets.leaseCalls()).toBe(0);
  });

  test("modify and delete are rejected", async () => {
    const store = secretBackedCredentialStore(refs, memorySecrets({}).service);
    expect(
      String(await rejectionOf(store.modify("tape", () => Promise.resolve(undefined)))),
    ).toContain("secret references");
    expect(String(await rejectionOf(store.delete("tape")))).toContain("secret references");
  });

  test("read reports the failure to the listener without the value, then rejects", async () => {
    const failures: CredentialFailure[] = [];
    const secrets = memorySecrets({ "tape-key": FAKE_KEY });
    secrets.setMissing("tape-key", true);
    const store = secretBackedCredentialStore(refs, secrets.service, {
      onFailure: (failure) => {
        failures.push(failure);
      },
    });
    expect(String(await rejectionOf(store.read("tape")))).toContain("secret_unresolved");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ providerId: "tape", secretName: "tape-key" });
    expect(JSON.stringify(failures)).not.toContain(FAKE_KEY);
  });
});

describe("oauth_token_rejected_on_default_provider", () => {
  const OAUTH_KEY = "sk-ant-oat01-fake-subscription-token";

  test("a subscription token on the default anthropic provider sends no request", async () => {
    const h = createHarness({
      tape: ONE_TURN,
      provider: { id: "anthropic", api: "anthropic-messages" },
      secretValues: { "tape-key": OAUTH_KEY },
    });
    const message = await h.service.stream(h.request("hi")).result();
    expect(message.stopReason).toBe("error");
    expect(message.errorMessage).toStartWith("oauth_token_on_default_provider:");
    expect(h.service.classify(message)).toBe("oauth_token_on_default_provider");
    expect(h.fake.calls()).toHaveLength(0);
    expect(JSON.stringify(message)).not.toContain(OAUTH_KEY);
  });

  test("the same token under another provider id is not blocked here", async () => {
    const h = createHarness({
      tape: ONE_TURN,
      provider: { id: "anthropic-oauth", api: "anthropic-messages" },
      secretValues: { "tape-key": OAUTH_KEY },
    });
    const message = await h.service.stream(h.request("hi")).result();
    expect(message.stopReason).toBe("stop");
    expect(h.fake.calls()).toHaveLength(1);
  });

  test("an ordinary api key on the default provider passes", async () => {
    const h = createHarness({
      tape: ONE_TURN,
      provider: { id: "anthropic", api: "anthropic-messages" },
    });
    const message = await h.service.stream(h.request("hi")).result();
    expect(message.stopReason).toBe("stop");
  });

  test("a key passed by the caller (agent-core apiKey) is guarded too", async () => {
    const h = createHarness({
      tape: ONE_TURN,
      provider: { id: "anthropic", api: "anthropic-messages" },
    });
    const resolved = h.resolve();
    const stream = await h.service.streamFn(h.ctx())(resolved.model, h.context("hi"), {
      apiKey: OAUTH_KEY,
    });
    const message = await stream.result();
    expect(message.errorMessage).toStartWith("oauth_token_on_default_provider:");
    expect(h.fake.calls()).toHaveLength(0);
  });
});
