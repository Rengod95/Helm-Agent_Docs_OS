import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { SecretNameSchema, type SecretName } from "@fresnel/contracts/capabilities";
import type {
  EventWire,
  HostConnection,
  SecretListEntry,
  WireParams,
} from "@fresnel/contracts/wire";
import { memorySecrets, type MemorySecrets } from "@fresnel/platform-secrets/testing";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost, type InProcessHost } from "../../src/command-run.ts";
import { startFakeAnthropic, type FakeAnthropic } from "../fixtures/fake-anthropic.ts";
import { SECRET_VALUE, startSecretEnvScenario } from "../fixtures/secret-env.ts";
import { createFakeKeys } from "../fixtures/fake-keys.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { wireErrorOf } from "../fixtures/service-harness.ts";
import { writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";
import type { EventCollector } from "../fixtures/wire-client.ts";

// 시크릿 조회 메서드 세 개(F.wire-settings §3.3.1, L0.secrets `usage`·`references`): `secret.meta`, `secret.references`, `secret.audit`.
// 실제 엔진 위에서 등록(앱 안의 값 입력 수단), 모델 호출(가짜 Anthropic 서버)을 거쳐 감사 기록과 참조를 만든다.
// 시크릿 서비스만 메모리 대역이다(값 저장소와 메타 저장소와 감사 파일). 정책 판정, lease, 감사 기록은 운영 구현이다.
// 값(KEY_VALUE)은 어떤 결과에도 나오면 안 된다. 시험은 값을 출력하지 않고 JSON에 들었는지만 본다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const KEY_VALUE = "fresnel-fake-anthropic-key-0123456789abcdef";
const REPLY = "pong from the fake provider";
const MODEL = "anthropic/claude-sonnet-5-5";

function nameOf(text: string): SecretName {
  const parsed = parse(SecretNameSchema, text);
  if (!parsed.ok) throw new Error(`not a secret name: ${text}`);
  return parsed.value;
}

const KEY_NAME = nameOf("anthropic-api-key");
const UNKNOWN_NAME = nameOf("nope-key");

/** 데스크톱 "키 등록"과 같은 길의 값 입력 수단: 메모리 값 하나를 준다 */
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
  /** 시작할 때 이미 provider가 연결되어 있다. 그 뒤에 등록한 키는 빈 정책이라 호출이 정책으로 거절된다 */
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
        secrets: [],
      });
      holder.secrets = secrets;
      return { service: secrets, admin: secrets.admin, keys: createFakeKeys() };
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
    workspace: mkdtempSync(join(tmpdir(), "xh-secret-wire-")),
  };
  slot.current = scenario;
  return scenario;
}

/** 데스크톱 "키 등록"과 같은 길로 시크릿을 만든다(값은 메모리 입력으로 들어간다) */
async function register(s: Scenario): Promise<void> {
  s.host.secretOutOfBand.offerEntry({
    name: KEY_NAME,
    action: "add",
    source: sourceOf(KEY_VALUE),
  });
  expect(
    await s.connection.request("secret.beginEntry", { name: KEY_NAME, action: "add" }),
  ).toEqual({ started: true });
}

/** 한 turn을 보내고 끝난 `turn.completed`를 돌려준다. 쓰인 thread id도 함께 돌려준다 */
async function chat(s: Scenario): Promise<{ threadId: string; done: EventWire }> {
  const created = await s.connection.request("thread.create", { workspace: s.workspace });
  const started = await startTurnWhenIdle(s.connection, {
    threadId: created.threadId,
    input: "hi",
  });
  const done = await s.collector.waitFor(
    (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
    30_000,
  );
  return { threadId: created.threadId, done };
}

function providersOf(server: FakeAnthropic) {
  return [
    {
      id: "anthropic",
      enabled: true,
      apiKeyRef: `secret://${KEY_NAME}`,
      baseUrl: server.url,
    },
  ];
}

/** 모델 provider에 연결한다. 연결이 더하는 허용은 그 호출 하나(runtime-http, 가짜 서버 주소)뿐이다 */
async function link(s: Scenario): Promise<void> {
  await s.connection.request("settings.set", {
    key: "l1.models.providers",
    value: providersOf(s.server),
    scope: "user",
  });
}

/** `secret.meta`가 받는 사용 정책(와이어 모양, 가변 배열) */
type WireUse = NonNullable<WireParams<"secret.meta">["use"]>;
/** `secret.list`·`secret.meta`가 돌려주는 메타(와이어 모양) */
type WireMeta = NonNullable<SecretListEntry["meta"]>;

function grantOf(server: FakeAnthropic): WireUse {
  return {
    modes: ["runtime-http"],
    tools: ["model.provider:anthropic"],
    hosts: [server.hostPort],
  };
}

/** 감사 기록 원본을 와이어 `at`(ISO 문자열) 모양으로 옮긴다. 기대값을 원본에서 세운다 */
function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

/** 결과 어디에도 값이 없다. 값은 출력하지 않고 포함 여부만 본다 */
function holdsValue(value: unknown): boolean {
  return JSON.stringify(value).includes(KEY_VALUE);
}

// ── secret.meta ──────────────────────────────────────────────────────────────────────────

realTest(
  "secret.meta applies only the given fields, the next read shows the same entry, and an out-of-range patch changes nothing",
  async () => {
    const s = await start();
    await register(s);
    const before = await s.connection.request("secret.list", { meta: true });
    const listed = before.secrets.find((secret) => secret.name === KEY_NAME);
    if (listed?.meta === undefined) throw new Error("the registered secret has no metadata");
    // 등록 직후 정책은 빈 값이다(사용 불가). 메타 쓰기는 이 값을 사람이 정하게 한다
    expect(listed.meta.use).toEqual({ modes: [], tools: [], hosts: [] });

    const patched = await s.connection.request("secret.meta", {
      name: KEY_NAME,
      desc: "Anthropic key for the int test",
      use: grantOf(s.server),
      approval: "none",
    });
    const expected: WireMeta = {
      ...listed.meta,
      desc: "Anthropic key for the int test",
      use: grantOf(s.server),
      approval: "none",
    };
    // 결과는 목록 항목과 같은 모양이다: 바뀐 메타와 제공자 쪽 상태
    expect(patched).toEqual({
      secret: { name: KEY_NAME, status: "valid", meta: expected },
    });

    // 다시 읽어도 같다(목록에서 확인한 값이 저장되어 있다)
    const reread = await s.connection.request("secret.list", { meta: true });
    expect(reread.secrets.find((secret) => secret.name === KEY_NAME)?.meta).toEqual(expected);

    // 범위를 벗어난 값(ttl 상한 86400초 초과)은 거절되고 아무것도 바꾸지 않는다
    const refused = await wireErrorOf(
      s.connection.request("secret.meta", { name: KEY_NAME, ttlSeconds: 100_000 }),
    );
    expect(refused.data.kind).toBe("jsonrpc.invalidParams");
    const afterRefusal = await s.connection.request("secret.list", { meta: true });
    expect(afterRefusal.secrets.find((secret) => secret.name === KEY_NAME)?.meta).toEqual(expected);

    // 없는 이름은 secret.notFound다
    const unknown = await wireErrorOf(
      s.connection.request("secret.meta", { name: UNKNOWN_NAME, desc: "nothing" }),
    );
    expect(unknown.data.kind).toBe("secret.notFound");

    expect(holdsValue(patched)).toBe(false);
    expect(holdsValue(reread)).toBe(false);
    expect(holdsValue(afterRefusal)).toBe(false);
  },
  60_000,
);

// ── secret.audit와 secret.references ──────────────────────────────────────────────────────
// 모델 호출의 감사 기록은 호출한 대화의 id를 싣는다(`core-models`의 `withCallThread`). 참조의 sessions도 그 대화들이다.

realTest(
  "secret.audit lists the denied model call and then the allowed one, newest first, with the mode, reason, decision and host",
  async () => {
    const s = await start();
    await register(s);
    await link(s);
    // 연결이 더한 허용을 사람이 지운다(secret.meta): 정책이 비면 같은 호출이 거절된다
    await s.connection.request("secret.meta", {
      name: KEY_NAME,
      use: { modes: [], tools: [], hosts: [] },
    });

    // 1) 정책이 비었다: 모델 호출은 거절된다(mode_not_allowed)
    const denied = await chat(s);
    expect(denied.done.payload).toMatchObject({ status: "failed" });
    expect(s.server.keys()).toEqual([]);
    const rawDenied = s.secrets.auditRecords().filter((record) => record.type === "secret.denied");
    expect(rawDenied).toHaveLength(1);
    const deniedAt = rawDenied[0]?.at;
    if (deniedAt === undefined) throw new Error("the denial was not audited");
    const afterDenial = await s.connection.request("secret.audit", { name: KEY_NAME });
    expect(afterDenial.entries).toHaveLength(1);
    expect(afterDenial.entries[0]).toMatchObject({
      at: isoOf(deniedAt),
      decision: "deny",
      mode: "runtime-http",
      threadId: denied.threadId,
      toolCallId: null,
      host: null,
      reason: "mode_not_allowed",
    });

    // 2) 허용을 다시 준다(secret.meta): 같은 키로 호출이 성공하고 감사 기록이 사용으로 올라온다
    await s.connection.request("secret.meta", {
      name: KEY_NAME,
      use: grantOf(s.server),
      approval: "none",
    });
    const allowed = await chat(s);
    expect(allowed.done.payload).toMatchObject({ status: "completed", error: null });
    expect(s.server.keys().map((header) => header.replace(/^Bearer /, ""))).toEqual([KEY_VALUE]);
    const rawUsed = s.secrets.auditRecords().filter((record) => record.type === "secret.used");
    expect(rawUsed).toHaveLength(1);
    const usedAt = rawUsed[0]?.at;
    if (usedAt === undefined) throw new Error("the use was not audited");

    // 최근 것이 앞이다: 사용, 그 다음 거절. 감사의 host는 목적지 호스트 이름이다(포트는 싣지 않는다)
    const audit = await s.connection.request("secret.audit", { name: KEY_NAME });
    expect(audit.entries).toHaveLength(2);
    expect(audit.entries[0]).toMatchObject({
      at: isoOf(usedAt),
      decision: "allow",
      mode: "runtime-http",
      threadId: allowed.threadId,
      toolCallId: null,
      host: new URL(s.server.url).hostname,
      reason: null,
    });
    expect(audit.entries[1]).toMatchObject({
      at: isoOf(deniedAt),
      decision: "deny",
      mode: "runtime-http",
      threadId: denied.threadId,
      toolCallId: null,
      host: null,
      reason: "mode_not_allowed",
    });
    // 참조의 sessions는 시크릿을 쓴 대화다(거절된 호출의 대화는 쓰지 않았으므로 없다)
    const references = await s.connection.request("secret.references", { name: KEY_NAME });
    expect(references.sessions.map(String)).toEqual([allowed.threadId]);
    // limit은 앞에서부터 자른다
    expect(await s.connection.request("secret.audit", { name: KEY_NAME, limit: 1 })).toEqual({
      entries: audit.entries.slice(0, 1),
    });

    // 없는 이름은 secret.notFound다
    const unknownAudit = await wireErrorOf(
      s.connection.request("secret.audit", { name: UNKNOWN_NAME }),
    );
    expect(unknownAudit.data.kind).toBe("secret.notFound");

    // 값은 어떤 결과에도 없다(감사, 메타 목록, 와이어 이벤트 모두)
    expect(holdsValue(audit)).toBe(false);
    expect(holdsValue(await s.connection.request("secret.list", { meta: true }))).toBe(false);
    expect(JSON.stringify(s.collector.events).includes(KEY_VALUE)).toBe(false);
  },
  90_000,
);

realTest(
  "secret.references of a key nothing points at yet is empty, and an unknown name is secret.notFound",
  async () => {
    const s = await start();
    await register(s);
    expect(await s.connection.request("secret.references", { name: KEY_NAME })).toEqual({
      settingKeys: [],
      activeLeases: 0,
      sessions: [],
    });
    expect(holdsValue(await s.connection.request("secret.references", { name: KEY_NAME }))).toBe(
      false,
    );
    const unknownRefs = await wireErrorOf(
      s.connection.request("secret.references", { name: UNKNOWN_NAME }),
    );
    expect(unknownRefs.data.kind).toBe("secret.notFound");
  },
  60_000,
);

// bash 명령이 `secretEnv`로 시크릿을 환경 변수에 받는 길(U-19 종단 시험의 조립)은 thread를 싣는다. 그래서 사용 기록과 참조의 sessions가 채워진다.
realTest(
  "secret.audit and secret.references record the thread of the command that used the secret in its environment",
  async () => {
    const scenario = await startSecretEnvScenario();
    try {
      expect(await scenario.allow()).toEqual({ applied: true });
      const name = nameOf("github-token");
      const audit = await scenario.connection.request("secret.audit", { name });
      expect(audit).toEqual({
        entries: [
          {
            at: expect.any(String),
            decision: "allow",
            mode: "env",
            threadId: scenario.threadId,
            toolCallId: expect.any(String),
            host: null,
            reason: null,
          },
        ],
      });
      expect(await scenario.connection.request("secret.references", { name })).toEqual({
        settingKeys: [],
        activeLeases: 0,
        sessions: [scenario.threadId],
      });
      // 값은 감사와 참조 어디에도 없다
      expect(JSON.stringify(audit).includes(SECRET_VALUE)).toBe(false);
    } finally {
      await scenario.close();
    }
  },
  90_000,
);
