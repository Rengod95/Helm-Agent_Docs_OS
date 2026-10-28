import { describe, expect, test } from "bun:test";
import type { ConcreteHttpRequest, HttpResponseLike } from "@xeon/contracts/services";
import { createPluginHttp, type PluginHttpCall } from "../src/plugin-http.ts";
import { memorySecrets } from "../src/testing/index.ts";
import { manualClock } from "./support/clock.ts";
import { fixedLocalIds } from "./support/ids.ts";
import { metaOf } from "./support/meta.ts";
import { handleOf } from "./support/names.ts";
import { fakeValue, seededRandom } from "./support/random.ts";

// M3-REQ-60. 웹 검색 플러그인 provider 경로의 헤더 비밀 치환. 값은 전송 직전에만 읽는다.

const HANDLE = handleOf("exa-api-key");
const CALL: PluginHttpCall = {
  threadId: "thr_1",
  toolCallId: "call_1",
  projectId: null,
  approval: null,
};
const OK: HttpResponseLike = { status: 200, headers: {}, bodyText: "{}" };

function setup() {
  const clock = manualClock();
  const secret = fakeValue(seededRandom(31), 24, true);
  const service = memorySecrets({
    clock,
    scheduler: clock,
    ids: fixedLocalIds(),
    secrets: [
      {
        meta: metaOf({
          name: "exa-api-key",
          ref: "dev/EXA_API_KEY",
          modes: ["runtime-http"],
          tools: ["web.search"],
          hosts: ["api.exa.test"],
        }),
        value: secret,
      },
    ],
  });
  const sent: ConcreteHttpRequest[] = [];
  const respond = (request: ConcreteHttpRequest): Promise<HttpResponseLike> => {
    sent.push(request);
    return Promise.resolve(OK);
  };
  return {
    service,
    secret,
    sent,
    respond,
    http: createPluginHttp(service, { purpose: "web.search" }),
  };
}

const TEMPLATE = {
  method: "POST",
  url: "https://api.exa.test/search",
  headers: { "x-api-key": "secret://exa-api-key", accept: "application/json" },
  body: '{"query":"xeon"}',
} as const;

describe("plugin provider header secrets", () => {
  test("headerHandles reads no value, send reads it right before sending", async () => {
    const { service, secret, sent, respond, http } = setup();
    const handles = http.headerHandles(TEMPLATE.headers);
    expect(handles).toEqual({ ok: true, value: [HANDLE] });
    // 설정 시점에는 제공자를 부르지 않는다
    expect(service.providerLeaseCalls()).toBe(0);

    const result = await http.send(TEMPLATE, CALL, respond);
    expect(result).toEqual({ ok: true, value: { response: OK, echoed: false } });
    expect(service.providerLeaseCalls()).toBe(1);
    expect(sent.map((request) => request.headers["x-api-key"] === secret)).toEqual([true]);
    expect(sent[0]?.headers["accept"]).toBe("application/json");
    expect(sent[0]?.body).toBe('{"query":"xeon"}');
    // 쓴 뒤 lease는 남지 않는다
    expect(service.activeLeaseCount(HANDLE)).toBe(0);
  });

  test("the purpose is fixed by the port, so a meta that allows only web.search accepts it and nothing else does", async () => {
    const { service, respond } = setup();
    const other = createPluginHttp(service, { purpose: "http.request" });
    const denied = await other.send(TEMPLATE, CALL, respond);
    expect(denied.ok).toBe(false);
    if (!denied.ok)
      expect(denied.error).toMatchObject({ kind: "denied", reason: "tool_not_allowed" });
  });

  test("a host outside the meta allow list never gets the value", async () => {
    const { service, sent, respond, http } = setup();
    const result = await http.send(
      { ...TEMPLATE, url: "https://evil.example.test/search" },
      CALL,
      respond,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ kind: "denied", reason: "host_mismatch" });
    expect(sent).toHaveLength(0);
    expect(service.providerLeaseCalls()).toBe(0);
  });

  test("handles in the body or the url are refused before any value is read", async () => {
    const { service, sent, respond, http } = setup();
    const inBody = await http.send(
      { ...TEMPLATE, body: '{"k":"secret://exa-api-key"}' },
      CALL,
      respond,
    );
    const inUrl = await http.send(
      { ...TEMPLATE, url: "https://api.exa.test/s?k=secret://exa-api-key" },
      CALL,
      respond,
    );
    for (const result of [inBody, inUrl]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("invalid_ref");
    }
    expect(sent).toHaveLength(0);
    expect(service.providerLeaseCalls()).toBe(0);
  });

  test("headerHandles rejects a header that mixes text with a handle", () => {
    const { http } = setup();
    const bad = http.headerHandles({ authorization: "Bearer secret://exa-api-key extra" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.kind).toBe("invalid_ref");
    expect(http.headerHandles({ accept: "application/json" })).toEqual({ ok: true, value: [] });
  });
});
