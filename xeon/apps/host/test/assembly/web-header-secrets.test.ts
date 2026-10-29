import { expect, test } from "bun:test";
import { err, ok, parse, type Result } from "@xeon/contracts";
import { SecretHandleSchema } from "@xeon/contracts/capabilities";
import type {
  ConcreteHttpRequest,
  HttpResponseLike,
  HttpTemplate,
  SecretError,
  SecretService,
  UseCtx,
} from "@xeon/contracts/services";
import type { HeaderSecretSender, HeaderSendResponse, SecretHeader } from "@xeon/cap-web";
import {
  createWebHeaderSecrets,
  WEB_SECRET_PURPOSE,
} from "../../src/assembly/web-header-secrets.ts";

// L2.web.spec §3.6.1. 헤더 비밀은 전송 직전에만 값이 된다. 가짜 `withHttp`가 템플릿을 받고 `send`에 값을 준다.
// 값은 `send` 콜백 인자 말고는 템플릿, 호출 문맥, 오류 어디에도 나오면 안 된다.

const SECRET = "sk-live-VALUE-0123456789";
const SETTING = "ext.exa.apiKey";
const BEARER: SecretHeader = { header: "authorization", setting: SETTING, scheme: "Bearer" };
const TARGET = { method: "POST" as const, url: "https://api.exa.example/search", body: '{"q":1}' };

interface Fake {
  readonly service: Pick<SecretService, "withHttp">;
  readonly templates: HttpTemplate[];
  readonly contexts: Omit<UseCtx, "mode" | "target">[];
}

/**
 * `withHttp`의 대역. 성공이면 템플릿의 `secret://exa-key`를 값으로 바꿔 `send`를 부르고(실제 서비스와 같다), 실패면 `outcome`을 돌려준다.
 * 에코 검사는 응답 본문에 값이 있는지로 한다(실제 서비스가 하는 검사의 자리표시).
 */
function fakeSecrets(outcome: SecretError | "ok"): Fake {
  const templates: HttpTemplate[] = [];
  const contexts: Omit<UseCtx, "mode" | "target">[] = [];
  const service: Pick<SecretService, "withHttp"> = {
    async withHttp<T extends HttpResponseLike>(
      template: HttpTemplate,
      ctx: Omit<UseCtx, "mode" | "target">,
      send: (req: ConcreteHttpRequest) => Promise<T>,
    ): Promise<Result<{ readonly response: T; readonly echoed: boolean }, SecretError>> {
      templates.push(template);
      contexts.push(ctx);
      if (outcome !== "ok") return err(outcome);
      const headers = Object.fromEntries(
        Object.entries(template.headers).map(([name, value]) => [
          name,
          value.replace("secret://exa-key", SECRET),
        ]),
      );
      const response = await send({
        method: template.method,
        url: template.url,
        headers,
        body: template.body,
      });
      return ok({ response, echoed: response.bodyText?.includes(SECRET) === true });
    },
  };
  return { service, templates, contexts };
}

function transmitting(bodyText: string) {
  const seen: Record<string, string>[] = [];
  const transmit = (headers: Readonly<Record<string, string>>): Promise<HeaderSendResponse> => {
    seen.push({ ...headers });
    return Promise.resolve({ status: 200, headers: { "content-type": "text/plain" }, bodyText });
  };
  return { seen, transmit };
}

function senderOver(fake: Fake, values: Readonly<Record<string, unknown>>): HeaderSecretSender {
  return createWebHeaderSecrets({
    secrets: fake.service,
    settingValue: (key) => values[key],
  });
}

test("the secret value reaches only the send callback, and the template given to withHttp holds references only", async () => {
  const fake = fakeSecrets("ok");
  const { seen, transmit } = transmitting("result list");
  const sender = senderOver(fake, { [SETTING]: "secret://exa-key" });

  const outcome = await sender.send([BEARER], TARGET, new AbortController().signal, transmit);

  // 값은 전송 콜백의 헤더에만 있다
  expect(seen).toEqual([{ authorization: `Bearer ${SECRET}` }]);
  // 템플릿에는 참조만 있다. 직렬화해도 값이 없다
  expect(fake.templates).toEqual([
    {
      method: "POST",
      url: TARGET.url,
      headers: { authorization: "Bearer secret://exa-key" },
      body: TARGET.body,
    },
  ]);
  expect(JSON.stringify(fake.templates)).not.toContain(SECRET);
  // 호출 문맥은 웹 검색 목적과 runtime 행위자다. 스레드는 없다
  expect(fake.contexts).toEqual([
    {
      threadId: null,
      toolCallId: null,
      projectId: null,
      approval: null,
      purpose: WEB_SECRET_PURPOSE,
      actor: "runtime",
    },
  ]);
  expect(outcome.ok).toBe(true);
  expect(outcome.ok && outcome.value.echoed).toBe(false);
});

test("a header without a scheme carries the value as-is, under a lowercase name", async () => {
  const fake = fakeSecrets("ok");
  const { seen, transmit } = transmitting("");
  const sender = senderOver(fake, { "ext.exa.key": "secret://exa-key" });

  await sender.send(
    [{ header: "X-Api-Key", setting: "ext.exa.key" }],
    TARGET,
    new AbortController().signal,
    transmit,
  );

  expect(fake.templates[0]?.headers).toEqual({ "x-api-key": "secret://exa-key" });
  expect(seen).toEqual([{ "x-api-key": SECRET }]);
});

test("a response that echoes the secret is reported as echoed, and the response still comes back", async () => {
  const echoing = `you sent ${SECRET}`;
  const fake = fakeSecrets("ok");
  const { transmit } = transmitting(echoing);
  const sender = senderOver(fake, { [SETTING]: "secret://exa-key" });

  const outcome = await sender.send([BEARER], TARGET, new AbortController().signal, transmit);

  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error("expected the send to succeed");
  expect(outcome.value.echoed).toBe(true);
  expect(outcome.value.response.status).toBe(200);
});

test("an unset setting is unset, and neither the secret service nor the transport is touched", async () => {
  const fake = fakeSecrets("ok");
  const { seen, transmit } = transmitting("");
  const sender = senderOver(fake, {});

  const outcome = await sender.send([BEARER], TARGET, new AbortController().signal, transmit);

  expect(outcome).toEqual({ ok: false, error: { kind: "unset", setting: SETTING } });
  expect(fake.templates).toEqual([]);
  expect(seen).toEqual([]);
});

test("a setting that is not a secret reference is unset before anything is looked up", async () => {
  const fake = fakeSecrets("ok");
  const { transmit } = transmitting("");
  const sender = senderOver(fake, { [SETTING]: "${EXA_KEY}" });

  const outcome = await sender.send([BEARER], TARGET, new AbortController().signal, transmit);

  expect(outcome).toEqual({ ok: false, error: { kind: "unset", setting: SETTING } });
  expect(fake.templates).toEqual([]);
});

test("a reference the service cannot resolve or has no entry for is unset", async () => {
  const handle = parse(SecretHandleSchema, "secret://exa-key");
  if (!handle.ok) throw new Error("the handle should parse");
  const cases: SecretError[] = [
    { kind: "invalid_ref", reason: "name_pattern" },
    { kind: "secret_missing", handle: handle.value, where: "provider" },
  ];
  const outcomes = await Promise.all(
    cases.map((failure) => {
      const fake = fakeSecrets(failure);
      const { transmit } = transmitting("");
      const sender = senderOver(fake, { [SETTING]: "secret://exa-key" });
      return sender.send([BEARER], TARGET, new AbortController().signal, transmit);
    }),
  );
  for (const outcome of outcomes) {
    expect(outcome).toEqual({ ok: false, error: { kind: "unset", setting: SETTING } });
  }
});

test("other failures are unavailable, name the setting, and never carry the value", async () => {
  const fake = fakeSecrets({
    kind: "provider_unavailable",
    provider: "sops",
    reason: "binary_missing",
  });
  const { seen, transmit } = transmitting("");
  const sender = senderOver(fake, { [SETTING]: "secret://exa-key" });

  const outcome = await sender.send([BEARER], TARGET, new AbortController().signal, transmit);

  expect(outcome).toEqual({ ok: false, error: { kind: "unavailable", setting: SETTING } });
  expect(seen).toEqual([]);
  expect(JSON.stringify(outcome)).not.toContain(SECRET);
});
