import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { memorySecrets } from "@fresnel/platform-secrets/testing";
import { isId, type ThreadId } from "@fresnel/contracts/conversation";
import { SecretNameSchema, type SecretName } from "@fresnel/contracts/capabilities";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@fresnel/core-models/testing";
import { WireError, type HostConnection } from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost, type InProcessHost } from "../../src/command-run.ts";
import { startFakeAnthropic, type FakeAnthropic } from "../fixtures/fake-anthropic.ts";
import { createFakeKeys } from "../fixtures/fake-keys.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// 사용량 게이지와 문맥 사용량(usage.get), 제공자 인증 확인(provider.checkAuth). 실제 엔진이고 임시 홈에서 돈다.
// 사용량은 테이프가 준 입력 토큰 수로 쌓이고, 인증 확인의 `ok` 경로만 기존 가짜 Anthropic 서버로 나간다(루프백, 바깥으로 나가지 않는다).
// 가짜 Anthropic은 어떤 요청에도 200을 주므로 거절·한도 같은 응답 종류는 이 시험이 만들 수 없다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const KEY_VALUE = "fresnel-fake-anthropic-key-0123456789abcdef";
/** 구독 토큰 모양의 값. 네트워크 없이 `oauthTokenNotApiKey`로 거절된다 */
const OAUTH_VALUE = "sk-ant-oat01-fresnel-fake-oauth-0123456789";
const TAPE_PRICE = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 } as const;
/** 글을 대화 id로 좁힌다. 모양이 맞지 않으면 시험 설정 오류다 */
function threadIdOf(text: string): ThreadId {
  if (!isId("thr", text)) throw new Error(`not a thread id: ${text}`);
  return text;
}

const NO_SUCH_THREAD = threadIdOf("thr_01ARZ3NDEKTSV4RRFFQ69G5FAX");

function nameOf(text: string): SecretName {
  const parsed = parse(SecretNameSchema, text);
  if (!parsed.ok) throw new Error(`not a secret name: ${text}`);
  return parsed.value;
}

function sourceOf(text: string) {
  return {
    read() {
      return Promise.resolve({ ok: true as const, value: new TextEncoder().encode(text) });
    },
  };
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

function isoOf(text: string): boolean {
  return new Date(text).toISOString() === text;
}

// ── usage.get ───────────────────────────────────────────────────────────────

/** 테이프가 입력 토큰 수를 알려 주는 답 */
function answerWithInput(text: string, inputTokens: number) {
  return {
    role: "main" as const,
    label: `answer ${text}`,
    response: {
      type: "message" as const,
      content: [t.text(text)],
      stopReason: "stop" as const,
      usage: { input: inputTokens },
    },
  };
}

async function openUsageHost(
  home: EngineHome,
  turns: readonly ReturnType<typeof answerWithInput>[],
) {
  writeUserSettings(home, TAPE_SETTINGS);
  const handle = tapeProvider(tapePlayer(tape("usage", [...turns]), { clock: realTapeClock() }), {
    models: [{ id: "tape-1", contextWindow: 200_000, cost: TAPE_PRICE }],
  });
  const host = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    buildModels: tapeBuildModels(handle),
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  return { home, host, connection };
}

realTest(
  "usage.get: the session gauges of a thread's turns sum the model usage, the context is the last call, and a restart keeps the same numbers",
  async () => {
    const home = useEngineHome();
    const first = await openUsageHost(home, [
      answerWithInput("답 하나", 1200),
      answerWithInput("답 둘", 3400),
    ]);
    const collector = collectEvents(first.connection);
    await first.connection.request("events.subscribe", { from: "head" });
    try {
      const created = await first.connection.request("thread.create", { title: "사용량" });
      const empty = await first.connection.request("thread.create", { title: "빈 대화" });
      for (const input of ["질문 하나", "질문 둘"]) {
        // 턴은 차례로 돈다(두 번째 턴은 첫 턴의 기록을 본다)
        // eslint-disable-next-line no-await-in-loop -- 턴은 차례로 돈다
        const started = await startTurnWhenIdle(first.connection, {
          threadId: created.threadId,
          input,
        });
        // eslint-disable-next-line no-await-in-loop -- 위 턴이 끝난 뒤에 다음 턴을 보낸다
        await collector.waitFor(
          (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
          20_000,
        );
      }

      // 게이지는 제공자별로 다섯 줄이다: 토큰, 비용(USD), 요청 수, 캐시 읽기, 캐시 쓰기
      const all = await first.connection.request("usage.get", {});
      expect(isoOf(all.asOf)).toBe(true);
      expect(all.context).toBeUndefined();
      expect(all.gauges.map((gauge) => [gauge.id, gauge.unit])).toEqual([
        ["tape::session:tokens", "tokens"],
        ["tape::session:usd", "usd"],
        ["tape::session:requests", "requests"],
        ["tape::session:cacheRead", "cacheRead"],
        ["tape::session:cacheWrite", "cacheWrite"],
      ]);
      expect(
        all.gauges.filter((gauge) => gauge.unit !== "usd").map((gauge) => [gauge.unit, gauge.used]),
      ).toEqual([
        ["tokens", 4600],
        ["requests", 2],
        ["cacheRead", 0],
        ["cacheWrite", 0],
      ]);
      const usd = all.gauges.find((gauge) => gauge.unit === "usd");
      // 입력 1 USD / 100만 토큰: (1200 + 3400) 토큰의 비용
      expect(usd?.used).toBeCloseTo((1200 + 3400) / 1_000_000, 12);
      expect(all.gauges[0]).toEqual({
        id: "tape::session:tokens",
        providerId: "tape",
        account: null,
        window: "session",
        unit: "tokens",
        used: 4600,
        limit: null,
        resetsAt: null,
      });

      // 대화별로 보면 같은 값이고, 문맥은 가장 나중 호출의 크기다(입력 3400, 창 200,000)
      const byThread = await first.connection.request("usage.get", { threadId: created.threadId });
      expect(byThread.gauges).toEqual(all.gauges);
      expect(byThread.context).toEqual({ model: "tape/tape-1", used: 3400, limit: 200_000 });

      // 제공자로 거르면 그 제공자 줄만 남고, 없는 제공자는 빈 목록이다
      expect((await first.connection.request("usage.get", { providerId: "tape" })).gauges).toEqual(
        all.gauges,
      );
      expect(await first.connection.request("usage.get", { providerId: "nope" })).toEqual({
        gauges: [],
        asOf: expect.any(String),
      });

      // 턴이 없는 대화는 게이지가 없고 문맥도 없다
      const quiet = await first.connection.request("usage.get", { threadId: empty.threadId });
      expect(quiet.gauges).toEqual([]);
      expect(quiet.context).toBeUndefined();

      // 없는 대화는 3001이다
      const missing = await wireErrorOf(
        first.connection.request("usage.get", { threadId: NO_SUCH_THREAD }),
      );
      expect(missing.code).toBe(3001);
    } finally {
      await first.connection.close();
      await first.host.close();
    }

    // 재시작 뒤에도 기록에서 같은 값이 나온다
    const second = await openUsageHost(home, []);
    try {
      const reopened = await second.connection.request("usage.get", {});
      expect(reopened.gauges.map((gauge) => gauge.unit)).toEqual([
        "tokens",
        "usd",
        "requests",
        "cacheRead",
        "cacheWrite",
      ]);
      expect(
        reopened.gauges
          .filter((gauge) => gauge.unit !== "usd")
          .map((gauge) => [gauge.unit, gauge.used]),
      ).toEqual([
        ["tokens", 4600],
        ["requests", 2],
        ["cacheRead", 0],
        ["cacheWrite", 0],
      ]);
      expect(reopened.gauges.find((gauge) => gauge.unit === "usd")?.used).toBeCloseTo(
        (1200 + 3400) / 1_000_000,
        12,
      );
      const listed = await second.connection.request("thread.list", {});
      const thread = listed.threads.find((row) => row.title === "사용량");
      if (thread === undefined) throw new Error("the thread is gone after the restart");
      expect(
        (await second.connection.request("usage.get", { threadId: thread.threadId })).context,
      ).toEqual({ model: "tape/tape-1", used: 3400, limit: 200_000 });
    } finally {
      await second.connection.close();
      await second.host.close();
      home.dispose();
    }
  },
  60_000,
);

// ── provider.checkAuth ──────────────────────────────────────────────────────

interface AuthHost {
  readonly home: EngineHome;
  readonly host: InProcessHost;
  readonly connection: HostConnection;
}

async function openAuthHost(home: EngineHome): Promise<AuthHost> {
  writeUserSettings(home, { "l0.sandbox.enabled": false });
  const holder: { secrets: ReturnType<typeof memorySecrets> | undefined } = { secrets: undefined };
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
  return { home, host, connection };
}

/** 데스크톱 "키 등록"과 같은 길로 시크릿을 만든다. 값은 이 시험 밖으로 나가지 않는다 */
async function registerKey(auth: AuthHost, name: string, value: string): Promise<void> {
  const secretName = nameOf(name);
  auth.host.secretOutOfBand.offerEntry({
    name: secretName,
    action: "add",
    source: sourceOf(value),
  });
  expect(
    await auth.connection.request("secret.beginEntry", { name: secretName, action: "add" }),
  ).toEqual({ started: true });
}

/** provider 목록을 사용자 범위에 쓴다. 키 참조와 주소가 여기서 정해진다 */
async function linkProvider(
  auth: AuthHost,
  providers: readonly { readonly id: string; readonly keyName: string; readonly baseUrl: string }[],
): Promise<void> {
  await auth.connection.request("settings.set", {
    key: "l1.models.providers",
    value: providers.map((provider) => ({
      id: provider.id,
      enabled: true,
      apiKeyRef: `secret://${provider.keyName}`,
      baseUrl: provider.baseUrl,
    })),
    scope: "user",
  });
}

realTest(
  "provider.checkAuth without a key reference answers noKey",
  async () => {
    const home = useEngineHome();
    const auth = await openAuthHost(home);
    try {
      expect(
        await auth.connection.request("provider.checkAuth", { provider: "anthropic" }),
      ).toEqual({ kind: "noKey", reason: "provider has no enabled key reference" });
    } finally {
      await auth.connection.close();
      await auth.host.close();
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "provider.checkAuth with a registered key: the provider answers ok, the key reaches the provider as its header, and the result holds no key",
  async () => {
    const home = useEngineHome();
    const server: FakeAnthropic = startFakeAnthropic("확인");
    const auth = await openAuthHost(home);
    try {
      await registerKey(auth, "anthropic-api-key", KEY_VALUE);
      await linkProvider(auth, [
        { id: "anthropic", keyName: "anthropic-api-key", baseUrl: server.url },
      ]);
      const checked = await auth.connection.request("provider.checkAuth", {
        provider: "anthropic",
      });
      expect(checked).toEqual({ kind: "ok", status: 200 });
      // 키는 가짜 서버에 x-api-key 헤더로 도착했고, 결과에는 없다
      expect(server.keys()).toEqual([KEY_VALUE]);
      expect(JSON.stringify(checked)).not.toContain(KEY_VALUE);
    } finally {
      await auth.connection.close();
      await auth.host.close();
      await server.stop();
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "provider.checkAuth refuses an OAuth token, a non-web address and an unlisted provider without sending a request",
  async () => {
    const home = useEngineHome();
    const server: FakeAnthropic = startFakeAnthropic("확인");
    const auth = await openAuthHost(home);
    try {
      await registerKey(auth, "anthropic-oauth-key", OAUTH_VALUE);
      await linkProvider(auth, [
        { id: "anthropic", keyName: "anthropic-oauth-key", baseUrl: server.url },
      ]);
      expect(
        await auth.connection.request("provider.checkAuth", { provider: "anthropic" }),
      ).toEqual({ kind: "oauthTokenNotApiKey" });

      // 웹 주소가 아니면(ftp) 요청을 보내지 않고 badAddress다
      await registerKey(auth, "anthropic-api-key", KEY_VALUE);
      await linkProvider(auth, [
        { id: "anthropic", keyName: "anthropic-api-key", baseUrl: "ftp://127.0.0.1:9/v1" },
      ]);
      expect(
        await auth.connection.request("provider.checkAuth", { provider: "anthropic" }),
      ).toEqual({ kind: "badAddress", reason: "invalid base URL" });

      // 확인 경로를 모르는 provider(사용자 정의 호환 주소)는 unsupported다
      await linkProvider(auth, [
        { id: "custom-compat", keyName: "anthropic-api-key", baseUrl: server.url },
      ]);
      expect(
        await auth.connection.request("provider.checkAuth", { provider: "custom-compat" }),
      ).toEqual({ kind: "unsupported" });

      // 세 경우 모두 요청이 가짜 서버에 닿지 않았다
      expect(server.keys()).toEqual([]);
      // 형식에 맞지 않는 provider id는 거절된다(확인 요청이 나가기 전)
      const missing = await wireErrorOf(
        auth.connection.request("provider.checkAuth", { provider: "BAD ID" }),
      );
      expect(missing.data.kind).toBe("jsonrpc.invalidParams");
    } finally {
      await auth.connection.close();
      await auth.host.close();
      await server.stop();
      home.dispose();
    }
  },
  60_000,
);
