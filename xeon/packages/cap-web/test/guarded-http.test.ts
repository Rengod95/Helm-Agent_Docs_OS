import { describe, expect, test } from "bun:test";
import { err } from "@xeon/contracts";
import type { WebProviderManifest } from "@xeon/contracts/capabilities";
import { WebHttpError, createBoundProviderHttp } from "../src/policy/guarded-http.ts";
import type { HeaderSecretSender } from "../src/ports/secrets.ts";
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
  options: {
    manifest?: WebProviderManifest;
    local?: readonly string[];
    key?: string;
    secrets?: HeaderSecretSender;
  } = {},
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
        options.secrets ??
        (options.key === undefined
          ? undefined
          : fakeHeaderSecrets({ "ext.fake-search.apiKey": options.key })),
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

  test("the header key reaches the transport only in x-api-key and never in the response or an error", async () => {
    const { bound, transport } = setup({ key: "key-value-123" });
    const outcome = await bound.request(
      { method: "GET", url: "https://api.vendor.example/v1/search" },
      SIGNAL,
    );
    const sent = transport.requests.at(-1);
    expect(sent?.headers["x-api-key"]).toBe("key-value-123");
    expect(sent?.url).toBe("https://api.vendor.example/v1/search");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(JSON.stringify(outcome.value)).not.toContain("key-value-123");
    const missing = await bound.request(
      { method: "GET", url: "https://api.vendor.example/missing" },
      SIGNAL,
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(JSON.stringify(missing.error)).not.toContain("key-value-123");
  });

  test("a bearer key is sent as the authorization header with the Bearer scheme", async () => {
    const { bound, transport } = setup({
      key: "tok",
      manifest: manifestOf({
        auth: { kind: "bearer", secrets: [{ setting: "ext.fake-search.apiKey" }] },
      }),
    });
    const outcome = await bound.request(
      { method: "GET", url: "https://api.vendor.example/v1/search" },
      SIGNAL,
    );
    expect(outcome.ok).toBe(true);
    expect(transport.requests.at(-1)?.headers["authorization"]).toBe("Bearer tok");
    expect(transport.requests.at(-1)?.headers["x-api-key"]).toBeUndefined();
  });

  test("an unset key setting is unavailable with no-key and sends nothing", async () => {
    const { bound, transport } = setup({ secrets: fakeHeaderSecrets({}) });
    const outcome = await bound.request(
      { method: "GET", url: "https://api.vendor.example/v1/search" },
      SIGNAL,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("unavailable");
      expect(outcome.error.detail).toEqual({ reason: "no-key", setting: "ext.fake-search.apiKey" });
    }
    expect(transport.requests.length).toBe(0);
  });

  test("an unavailable key setting is also no-key and sends nothing", async () => {
    const unavailable: HeaderSecretSender = {
      send: () => Promise.resolve(err({ kind: "unavailable", setting: "ext.fake-search.apiKey" })),
    };
    const { bound, transport } = setup({ secrets: unavailable });
    const outcome = await bound.request(
      { method: "GET", url: "https://api.vendor.example/v1/search" },
      SIGNAL,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(reasonOfFailure(outcome.error)).toBe("no-key");
    expect(transport.requests.length).toBe(0);
  });

  test("a response that echoes the key is dropped with secret_echoed and its body is not returned", async () => {
    const { bound, transport } = setup({ key: "key-value-123" });
    transport.route("https://api.vendor.example/v1/echo", {
      body: '{"you_sent":"key-value-123"}',
      headers: { "Content-Type": "application/json" },
    });
    transport.route("https://api.vendor.example/v1/echo-header", {
      body: "{}",
      headers: { "Content-Type": "application/json", "X-Echo": "key-value-123" },
    });
    const body = await bound.request(
      { method: "GET", url: "https://api.vendor.example/v1/echo" },
      SIGNAL,
    );
    expect(body.ok).toBe(false);
    if (!body.ok) {
      expect(body.error.code).toBe("upstream_error");
      expect(reasonOfFailure(body.error)).toBe("secret_echoed");
    }
    expect(JSON.stringify(body)).not.toContain("you_sent");
    expect(JSON.stringify(body)).not.toContain("key-value-123");
    // 헤더로 되돌아온 에코도 같은 오류가 된다
    const header = await bound.request(
      { method: "GET", url: "https://api.vendor.example/v1/echo-header" },
      SIGNAL,
    );
    expect(header.ok).toBe(false);
    if (!header.ok) expect(reasonOfFailure(header.error)).toBe("secret_echoed");
    expect(transport.requests.length).toBe(2);
  });

  test("a provider header with the secret's name cannot replace the key", async () => {
    const header = setup({ key: "key-value-123" });
    await header.bound.request(
      {
        method: "GET",
        url: "https://api.vendor.example/v1/search",
        headers: { "X-Api-Key": "provider-supplied", Authorization: "Bearer provider" },
      },
      SIGNAL,
    );
    expect(header.transport.requests.at(-1)?.headers["x-api-key"]).toBe("key-value-123");
    // 비밀 이름이 아닌 provider 헤더는 그대로 간다
    expect(header.transport.requests.at(-1)?.headers["authorization"]).toBe("Bearer provider");

    const bearer = setup({
      key: "tok",
      manifest: manifestOf({
        auth: { kind: "bearer", secrets: [{ setting: "ext.fake-search.apiKey" }] },
      }),
    });
    await bearer.bound.request(
      {
        method: "GET",
        url: "https://api.vendor.example/v1/search",
        headers: { Authorization: "Bearer provider" },
      },
      SIGNAL,
    );
    expect(bearer.transport.requests.at(-1)?.headers["authorization"]).toBe("Bearer tok");
  });

  test("a query-kind auth that reaches guarded http is no-key and sends nothing", async () => {
    const { bound, transport } = setup({
      key: "tok",
      manifest: manifestOf({
        auth: { kind: "query", secrets: [{ setting: "ext.fake-search.apiKey", query: "key" }] },
      }),
    });
    const outcome = await bound.request(
      { method: "GET", url: "https://api.vendor.example/v1/search" },
      SIGNAL,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(reasonOfFailure(outcome.error)).toBe("no-key");
    expect(transport.requests.length).toBe(0);
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

  test("a bracketed IPv6 local endpoint matches its host and port", async () => {
    const resolver = fakeResolver();
    const transport = fixtureTransport({ "http://[::1]:8888/ping": { body: "pong" } }, resolver);
    const bound = createBoundProviderHttp(
      { resolver, transport, secrets: undefined, guard: undefined },
      { localEndpoints: ["[::1]:8888"] },
    );
    bound.bind(manifestOf({ endpoints: [], auth: { kind: "none", secrets: [] } }));
    const ok = await bound.request({ method: "GET", url: "http://[::1]:8888/ping" }, SIGNAL);
    expect(ok.ok).toBe(true);
    const otherPort = await bound.request({ method: "GET", url: "http://[::1]:9999/ping" }, SIGNAL);
    expect(otherPort.ok).toBe(false);
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
    // 비밀 값은 8바이트 이상이다(L0 register 규칙). 짧은 값은 본문 글자와 겹쳐 에코로 잘못 잡힌다
    const { bound } = setup({ key: "key-value-123" });
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
