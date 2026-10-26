import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import {
  parseSecretRef,
  SecretNameSchema,
  type SecretHandle,
  type SecretMeta,
  type SecretName,
  type SecretUsePolicy,
} from "@xeon/contracts/capabilities";
import type { UseCtx } from "@xeon/contracts/services";
import type { EventWire, HostConnection } from "@xeon/contracts/wire";
import { memorySecrets, type MemorySecrets } from "@xeon/platform-secrets/testing";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost, type InProcessHost } from "../../src/main.ts";
import { startFakeAnthropic, type FakeAnthropic } from "../fixtures/fake-anthropic.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";
import type { EventCollector } from "../fixtures/wire-client.ts";

// M2 Mac 실기 1번: 새로 등록한 비밀은 사용 정책이 비어 모델 호출 lease가 denied였다. provider에 연결하면(사용자 범위 `l1.models.providers`의
// `settings.set`) 호스트가 그 호출 하나(runtime-http, model.provider:<id>, provider 호스트)만 허용하고, env 모드와 도구는 계속 막힌다.
// 모델 호출은 가짜 Anthropic 서버로 실제 HTTP를 나간다. 비밀 서비스만 메모리 대역이고 정책 판정은 운영 구현이다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const KEY_VALUE = "xeon-fake-anthropic-key-0123456789abcdef";
const REPLY = "pong from the fake provider";
const MODEL = "anthropic/claude-sonnet-5-5";

function nameOf(text: string): SecretName {
  const parsed = parse(SecretNameSchema, text);
  if (!parsed.ok) throw new Error(`not a secret name: ${text}`);
  return parsed.value;
}

const KEY_NAME = nameOf("anthropic-api-key");
const refParsed = parseSecretRef(`secret://${KEY_NAME}`);
if (!refParsed.ok) throw new Error("the fixture reference is invalid");
const KEY_HANDLE: SecretHandle = refParsed.value.handle;

/** 데스크톱 "모델 키"가 쓰는 길: 셸이 `xeon secret add`를 돌리고 값은 stdin으로. 호스트에서는 값 입력 수단을 맡기고 `secret.beginEntry`다 */
function sourceOf(text: string) {
  return {
    read() {
      return Promise.resolve({ ok: true as const, value: new TextEncoder().encode(text) });
    },
  };
}

interface Scenario {
  readonly home: EngineHome;
  readonly host: InProcessHost;
  readonly connection: HostConnection;
  readonly collector: EventCollector;
  readonly server: FakeAnthropic;
  readonly secrets: MemorySecrets;
  readonly workspace: string;
}

// 시험마다 시나리오 하나다
const slot: { current: Scenario | undefined } = { current: undefined };

afterEach(async () => {
  const scenario = slot.current;
  slot.current = undefined;
  if (scenario === undefined) return;
  await scenario.connection.close();
  await scenario.host.close();
  await scenario.server.stop();
  rmSync(scenario.workspace, { recursive: true, force: true });
  scenario.home.dispose();
});

interface StartOptions {
  /** 시작 때 이미 등록돼 있는(예전 버전이 빈 정책으로 만든) 비밀 */
  readonly existing?: SecretMeta;
  /** 시작 때 사용자 설정 파일에 이미 있는 provider 목록 */
  readonly linkedAtStart?: boolean;
}

async function start(options: StartOptions = {}): Promise<Scenario> {
  const home = useEngineHome();
  const server = startFakeAnthropic(REPLY);
  writeUserSettings(home, {
    "l1.models.default": MODEL,
    "l0.sandbox.enabled": false,
    ...(options.linkedAtStart === true ? { "l1.models.providers": providersOf(server) } : {}),
  });
  const holder: { secrets: MemorySecrets | undefined } = { secrets: undefined };
  const host = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    secretsRuntime: (deps) => {
      const secrets = memorySecrets({
        clock: deps.os.time.clock,
        scheduler: deps.os.time.scheduler,
        ids: deps.ids,
        secrets:
          options.existing === undefined ? [] : [{ meta: options.existing, value: KEY_VALUE }],
      });
      holder.secrets = secrets;
      return { service: secrets, admin: secrets.admin };
    },
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  const collector = collectEvents(connection);
  await connection.request("events.subscribe", { from: "head" });
  if (holder.secrets === undefined) throw new Error("the secrets runtime was not built");
  const scenario: Scenario = {
    home,
    host,
    connection,
    collector,
    server,
    secrets: holder.secrets,
    workspace: mkdtempSync(join(tmpdir(), "xh-key-link-")),
  };
  slot.current = scenario;
  return scenario;
}

function providersOf(server: FakeAnthropic) {
  return [
    {
      id: "anthropic",
      enabled: true,
      apiKeyRef: `secret://${KEY_NAME}`,
      // 가짜 서버로 보낸다. 이 호스트:포트가 비밀 사용 정책의 호스트 항목이 된다
      baseUrl: server.url,
    },
  ];
}

/** 한 turn을 보내고 끝난 `turn.completed` 이벤트를 돌려준다 */
async function chat(scenario: Scenario): Promise<EventWire> {
  const created = await scenario.connection.request("thread.create", {
    workspace: scenario.workspace,
  });
  const started = await startTurnWhenIdle(scenario.connection, {
    threadId: created.threadId,
    input: "hi",
  });
  return scenario.collector.waitFor(
    (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
    30_000,
  );
}

/** 데스크톱 "키 등록"과 같은 길로 비밀을 만든다 */
async function register(scenario: Scenario): Promise<void> {
  scenario.host.secretOutOfBand.offerEntry({
    name: KEY_NAME,
    action: "add",
    source: sourceOf(KEY_VALUE),
  });
  expect(
    await scenario.connection.request("secret.beginEntry", { name: KEY_NAME, action: "add" }),
  ).toEqual({ started: true });
}

async function useOf(scenario: Scenario): Promise<{ use: unknown; approval: unknown }> {
  const listed = await scenario.connection.request("secret.list", { meta: true });
  const entry = listed.secrets.find((secret) => secret.name === KEY_NAME);
  return { use: entry?.meta?.use, approval: entry?.meta?.approval };
}

async function link(scenario: Scenario): Promise<void> {
  await scenario.connection.request("settings.set", {
    key: "l1.models.providers",
    value: providersOf(scenario.server),
    scope: "user",
  });
}

function useCtx(overrides: Partial<UseCtx>): UseCtx {
  return {
    mode: "runtime-http",
    purpose: "model.provider:anthropic",
    target: { kind: "host", host: "127.0.0.1", port: null },
    actor: "runtime",
    threadId: null,
    toolCallId: null,
    projectId: null,
    approval: null,
    ...overrides,
  };
}

function portOf(server: FakeAnthropic): number {
  return Number(server.hostPort.split(":")[1]);
}

const GRANT = (server: FakeAnthropic): SecretUsePolicy => ({
  modes: ["runtime-http"],
  tools: ["model.provider:anthropic"],
  hosts: [server.hostPort],
});

realTest(
  "desktop order: register the key, link the provider, and the model call leases the key with no manual secret meta",
  async () => {
    const s = await start();
    await register(s);
    // 등록만으로는 아무것도 허용되지 않는다(HS-45): 사용 정책이 비어 있다
    expect(await useOf(s)).toEqual({
      use: { modes: [], tools: [], hosts: [] },
      approval: "per-session",
    });

    await link(s);
    // 연결이 더한 허용은 그 호출 하나뿐이다: env 모드도 도구도 없고 호스트는 provider 주소 하나다
    expect(await useOf(s)).toEqual({ use: GRANT(s.server), approval: "none" });

    const done = await chat(s);
    expect(done.payload).toMatchObject({ status: "completed", error: null });
    // 키는 가짜 서버에 실제로 도착했다(헤더 값 비교). 이벤트 어디에도 값은 없다
    expect(s.server.keys().map((header) => header.replace(/^Bearer /, ""))).toEqual([KEY_VALUE]);
    expect(JSON.stringify(s.collector.events)).not.toContain(KEY_VALUE);
  },
  60_000,
);

realTest(
  "a key registered by an older build with an empty policy is denied with the reason, and linking again repairs it",
  async () => {
    const empty: SecretMeta = {
      name: KEY_NAME,
      desc: KEY_NAME,
      provider: "sops",
      ref: "user/ANTHROPIC_API_KEY",
      scope: "user",
      expiresAt: null,
      use: { modes: [], tools: [], hosts: [] },
      approval: "per-session",
      ttlSeconds: 900,
      maxUses: 200,
    };
    const s = await start({ existing: empty, linkedAtStart: true });
    const failed = await chat(s);
    expect(failed.payload).toMatchObject({ status: "failed" });
    const reason = JSON.stringify(failed.payload);
    expect(reason).toContain(
      "secret anthropic-api-key could not be leased (denied: mode_not_allowed)",
    );
    expect(s.server.keys()).toEqual([]);

    await link(s);
    expect(await useOf(s)).toEqual({ use: GRANT(s.server), approval: "none" });
    const done = await chat(s);
    expect(done.payload).toMatchObject({ status: "completed", error: null });
    expect(s.server.keys()).toHaveLength(1);
  },
  60_000,
);

realTest(
  "CLI order: link first, then register: the new secret starts with the same one-use policy",
  async () => {
    const s = await start({ linkedAtStart: true });
    await register(s);
    expect(await useOf(s)).toEqual({ use: GRANT(s.server), approval: "none" });
    const done = await chat(s);
    expect(done.payload).toMatchObject({ status: "completed", error: null });
    expect(s.server.keys().map((header) => header.replace(/^Bearer /, ""))).toEqual([KEY_VALUE]);
  },
  60_000,
);

realTest(
  "the link opens nothing else: env mode, tool purposes, other hosts and other ports are still denied",
  async () => {
    const s = await start();
    await register(s);
    await link(s);
    const service = s.secrets;
    const port = portOf(s.server);
    const providerCtx = useCtx({ target: { kind: "host", host: "127.0.0.1", port } });

    // 허용된 호출 하나는 열린다
    const opened = await service.lease(KEY_HANDLE, providerCtx);
    expect(opened.ok).toBe(true);
    if (opened.ok) opened.value.dispose();

    const denied = async (ctx: UseCtx) => {
      const result = await service.lease(KEY_HANDLE, ctx);
      return result.ok ? "allowed" : result.error.kind === "denied" ? result.error.reason : "other";
    };
    // env 모드: 모드가 허용에 없다(승인 증거가 있어도)
    expect(
      await denied(
        useCtx({
          mode: "env",
          purpose: "bash:printenv",
          target: { kind: "command", argv0: "printenv", commandLine: "printenv KEY" },
          actor: "agent",
          approval: { approvalId: "apr_1", scope: "per-use", grantedAt: 0, expiresAt: null },
        }),
      ),
    ).toBe("mode_not_allowed");
    // 같은 runtime-http라도 도구 목적이 다르면 막힌다
    expect(await denied({ ...providerCtx, purpose: "http.request", actor: "agent" })).toBe(
      "tool_not_allowed",
    );
    expect(await denied({ ...providerCtx, purpose: "model.provider:other" })).toBe(
      "tool_not_allowed",
    );
    // 같은 목적이라도 다른 호스트, 다른 포트는 막힌다
    expect(
      await denied(useCtx({ target: { kind: "host", host: "evil.example.test", port } })),
    ).toBe("host_mismatch");
    expect(
      await denied(useCtx({ target: { kind: "host", host: "127.0.0.1", port: port + 1 } })),
    ).toBe("host_mismatch");
    // 브라우저 입력과 sentinel 모드도 열리지 않는다
    expect(await denied({ ...providerCtx, mode: "browser-input" })).toBe("mode_not_allowed");
  },
  60_000,
);

realTest(
  "a link before the secret exists is skipped without error, and a secret with another name gets nothing",
  async () => {
    const s = await start();
    // 비밀이 아직 없다: 연결은 건너뛰고(오류 없이) 설정만 저장된다
    await link(s);
    const listed = await s.connection.request("secret.list", { meta: true });
    expect(listed.secrets).toEqual([]);
    // 다른 이름의 비밀에는 허용이 붙지 않는다
    s.host.secretOutOfBand.offerEntry({
      name: nameOf("exa-key"),
      action: "add",
      source: sourceOf("xeon-fake-exa-key-0123456789"),
    });
    await s.connection.request("secret.beginEntry", { name: nameOf("exa-key"), action: "add" });
    const after = await s.connection.request("secret.list", { meta: true });
    expect(after.secrets.map((entry) => [entry.name, entry.meta?.use])).toEqual([
      [nameOf("exa-key"), { modes: [], tools: [], hosts: [] }],
    ]);
  },
  60_000,
);
