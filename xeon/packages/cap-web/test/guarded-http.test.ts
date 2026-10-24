import { describe, expect, test } from "bun:test";
import type { WebProviderManifest } from "@xeon/contracts/capabilities";
import { WebHttpError, createBoundProviderHttp } from "../src/policy/guarded-http.ts";
import { fakeHeaderSecrets, fakeSecretGuard } from "../src/testing/fake-ports.ts";
import { fakeResolver } from "../src/testing/fake-resolver.ts";
import { fixtureTransport } from "../src/testing/http-fixtures.ts";
import { PUBLIC_IP, reasonOfFailure } from "./support/world.ts";

function manifestOf(overrides: Partial<WebProviderManifest> = {}): WebProviderManifest {
  return {
    name: "fake-search",
    displayName: "Fake search",
    services: ["search"],
    endpoints: ["api.vendor.example"],
    auth: { kind: "header", secrets: [{ setting: "ext.fake-search.apiKey", header: "X-Api-Key" }] },
    pricing: {
      asOf: "2026-10-01",
      sourceUrl: "https://vendor.example/pricing",
      currency: "USD",
      units: {},
    },
    termsFlags: { cachePolicy: "session", mayTrainOn: "unknown", redistribution: "unknown" },
    privacy: { zdr: "unknown", sendsTelemetry: false },
    limits: {},
    ...overrides,
  };
}

const SIGNAL = new AbortController().signal;

function setup(
  options: { manifest?: WebProviderManifest; local?: readonly string[]; key?: string } = {},
) {
  const resolver = fakeResolver({
    "api.vendor.example": [PUBLIC_IP],
    "other.example": [PUBLIC_IP],
    "searx.lan": ["10.1.2.3"],
  });
  const transport = fixtureTransport(
    {
      "https://api.vendor.example/v1/search": {
        body: '{"ok":true}',
        headers: { "Content-Type": "application/json" },
      },
    },
    resolver,
  );
  const bound = createBoundProviderHttp(
    {
      resolver,
      transport,
      secrets:
        options.key === undefined
          ? undefined
          : fakeHeaderSecrets({ "ext.fake-search.apiKey": options.key }),
      guard: fakeSecretGuard(["registered-secret-value"]),
    },
    options.local === undefined ? {} : { localEndpoints: options.local },
  );
  bound.bind(options.manifest ?? manifestOf());
  return { bound, transport, resolver };
}

describe("provider http", () => {
  test("a request to a manifest endpoint carries the substituted key", async () => {
    const { bound, transport } = setup({ key: "key-value-123" });
    transport.route("https://api.vendor.example/v1/search?q=xeon", { body: "{}" });
    const outcome = await bound.request(
      {
        method: "GET",
        url: "https://api.vendor.example/v1/search?q=xeon",
        headers: { Cookie: "a=b", Host: "evil", Accept: "application/json" },
      },
      SIGNAL,
    );
    expect(outcome.ok).toBe(true);
    const sent = transport.requests.at(-1);
    expect(sent?.headers["x-api-key"]).toBe("key-value-123");
    expect(sent?.mode).toBe("public");
    // 제공자가 정할 수 없는 헤더는 버리고 나머지는 소문자 이름으로 보낸다
    expect(sent?.headers["cookie"]).toBeUndefined();
    expect(sent?.headers["host"]).toBeUndefined();
    expect(sent?.headers["accept"]).toBe("application/json");
  });

  test("provider code never sees the key and errors never print it", async () => {
    const { bound } = setup({ key: "key-value-123" });
    const response = await bound.request(
      { method: "GET", url: "https://api.vendor.example/v1/search" },
      SIGNAL,
    );
    expect(response.ok).toBe(true);
    if (response.ok) expect(JSON.stringify(response.value.headers)).not.toContain("key-value-123");
    const bad = await bound.request(
      { method: "GET", url: "https://api.vendor.example/missing" },
      SIGNAL,
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(JSON.stringify(bad.error)).not.toContain("key-value-123");
  });

  test("bearer and query auth", async () => {
    const bearer = setup({
      key: "tok",
      manifest: manifestOf({
        auth: { kind: "bearer", secrets: [{ setting: "ext.fake-search.apiKey" }] },
      }),
    });
    await bearer.bound.request(
      { method: "GET", url: "https://api.vendor.example/v1/search" },
      SIGNAL,
    );
    expect(bearer.transport.requests.at(-1)?.headers["authorization"]).toBe("Bearer tok");

    const query = setup({
      key: "tok",
      manifest: manifestOf({
        auth: { kind: "query", secrets: [{ setting: "ext.fake-search.apiKey", query: "key" }] },
      }),
    });
    const out = await query.bound.request(
      { method: "GET", url: "https://api.vendor.example/v1/search" },
      SIGNAL,
    );
    expect(query.transport.requests.at(-1)?.url).toBe(
      "https://api.vendor.example/v1/search?key=tok",
    );
    // 응답 URL에는 질의 비밀을 싣지 않는다
    if (out.ok) expect(out.value.url).toBe("https://api.vendor.example/v1/search");
  });

  test("a missing key is unavailable with no-key and sends nothing", async () => {
    const { bound, transport } = setup();
    const outcome = await bound.request(
      { method: "GET", url: "https://api.vendor.example/v1/search" },
      SIGNAL,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("unavailable");
      expect(reasonOfFailure(outcome.error)).toBe("no-key");
    }
    expect(transport.requests.length).toBe(0);
  });

  test("hosts outside the manifest endpoints are refused", async () => {
    const { bound, transport } = setup({ key: "k" });
    const other = await bound.request({ method: "GET", url: "https://other.example/x" }, SIGNAL);
    expect(other.ok).toBe(false);
    if (!other.ok) expect(reasonOfFailure(other.error)).toBe("endpoint_not_allowed");
    const http = await bound.request(
      { method: "GET", url: "http://api.vendor.example/v1/search" },
      SIGNAL,
    );
    expect(http.ok).toBe(false);
    if (!http.ok) expect(reasonOfFailure(http.error)).toBe("endpoint_not_https");
    const port = await bound.request(
      { method: "GET", url: "https://api.vendor.example:8443/v1/search" },
      SIGNAL,
    );
    expect(port.ok).toBe(false);
    expect(transport.requests.length).toBe(0);
  });

  test("searxng loopback endpoint exception is provider-only", async () => {
    const resolver = fakeResolver({ "public.example": [PUBLIC_IP] });
    const transport = fixtureTransport(
      { "http://127.0.0.1:8888/search?q=xeon&format=json": { body: "{}" } },
      resolver,
    );
    const bound = createBoundProviderHttp(
      { resolver, transport, secrets: undefined, guard: undefined },
      { localEndpoints: ["127.0.0.1:8888"] },
    );
    bound.bind(manifestOf({ name: "searxng", endpoints: [], auth: { kind: "none", secrets: [] } }));
    const allowed = await bound.request(
      { method: "GET", url: "http://127.0.0.1:8888/search?q=xeon&format=json" },
      SIGNAL,
    );
    expect(allowed.ok).toBe(true);
    expect(transport.requests.at(-1)?.mode).toBe("direct");
    // 같은 루프백 주소라도 다른 포트나 다른 주소는 endpoint가 아니다
    const otherPort = await bound.request({ method: "GET", url: "http://127.0.0.1:9999/" }, SIGNAL);
    expect(otherPort.ok).toBe(false);
    const metadata = await bound.request({ method: "GET", url: "http://169.254.169.254/" }, SIGNAL);
    expect(metadata.ok).toBe(false);
    expect(transport.requests.length).toBe(1);
  });

  test("a local endpoint on a private lan address uses the direct mode", async () => {
    const { bound, transport } = setup({ local: ["searx.lan:8080"] });
    const resolver = fakeResolver({ "searx.lan": ["10.1.2.3"] });
    const lan = createBoundProviderHttp(
      { resolver, transport, secrets: undefined, guard: undefined },
      { localEndpoints: ["searx.lan:8080"] },
    );
    lan.bind(manifestOf({ endpoints: [], auth: { kind: "none", secrets: [] } }));
    transport.route("http://searx.lan:8080/ping", { body: "pong" });
    const out = await lan.request({ method: "GET", url: "http://searx.lan:8080/ping" }, SIGNAL);
    expect(out.ok).toBe(true);
    expect(transport.requests.at(-1)?.mode).toBe("direct");
    expect(bound).toBeDefined();
  });

  test("a registered secret in the url or body is refused", async () => {
    const { bound, transport } = setup({ key: "k" });
    const inUrl = await bound.request(
      { method: "GET", url: "https://api.vendor.example/v1/search?q=registered-secret-value" },
      SIGNAL,
    );
    expect(inUrl.ok).toBe(false);
    const inBody = await bound.request(
      {
        method: "POST",
        url: "https://api.vendor.example/v1/search",
        body: '{"q":"registered-secret-value"}',
      },
      SIGNAL,
    );
    expect(inBody.ok).toBe(false);
    if (!inBody.ok) expect(reasonOfFailure(inBody.error)).toBe("secret_in_query");
    expect(transport.requests.length).toBe(0);
  });

  test("the GuardedHttp face rejects with a WebHttpError", async () => {
    const { bound } = setup({ key: "k" });
    const rejected = await bound.http
      .request({ method: "GET", url: "https://other.example/x" }, SIGNAL)
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );
    expect(rejected).toBeInstanceOf(WebHttpError);
    if (rejected instanceof WebHttpError) expect(rejected.failure.code).toBe("denied");
    const response = await bound.http.request(
      { method: "GET", url: "https://api.vendor.example/v1/search" },
      SIGNAL,
    );
    expect(response.status).toBe(200);
    expect(new TextDecoder().decode(response.body)).toBe('{"ok":true}');
  });

  test("an unbound http is a provider defect", async () => {
    const resolver = fakeResolver();
    const bound = createBoundProviderHttp({
      resolver,
      transport: fixtureTransport(),
      secrets: undefined,
      guard: undefined,
    });
    const rejected = await bound.http
      .request({ method: "GET", url: "https://api.vendor.example/" }, SIGNAL)
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );
    expect(rejected).toBeInstanceOf(Error);
    expect(rejected instanceof WebHttpError).toBe(false);
  });
});
