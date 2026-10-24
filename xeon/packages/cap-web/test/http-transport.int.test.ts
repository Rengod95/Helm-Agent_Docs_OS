import { afterAll, describe, expect, test } from "bun:test";
import type { TransportRequest } from "../src/ports/transport.ts";
import { fakeResolver } from "../src/testing/fake-resolver.ts";
import { createHttpTransport } from "../src/transport/http-transport.ts";

// 운영 전송의 읽기 상한, 내용 인코딩, 시간 초과, 취소와 direct 모드 주소 고정을 루프백 서버(127.0.0.1)로 확인한다.
// 네트워크 밖으로는 나가지 않는다. https(TLS 서버 이름 고정)와 guarded-fetch가 `localhost` 이름을 거부하는 경로의
// 실제 인터넷 쪽 동작은 사람 확인 항목이다(L2.web.plan §8.3).

const hits: { url: string; host: string | null }[] = [];

const routes: Readonly<Record<string, () => Response | Promise<Response>>> = {
  "/ok": () =>
    new Response("hello", { headers: { "X-Custom": "Value", "content-type": "text/plain" } }),
  "/redirect": () => new Response(null, { status: 302, headers: { location: "/ok" } }),
  "/big": () => new Response("x".repeat(2000)),
  "/chunked": () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (let index = 0; index < 5; index += 1) {
            controller.enqueue(new TextEncoder().encode("y".repeat(100)));
          }
          controller.close();
        },
      }),
    ),
  "/gzip-bomb": () =>
    new Response(Bun.gzipSync(new Uint8Array(100_000)), {
      headers: { "content-encoding": "gzip" },
    }),
  "/gzip-small": () =>
    new Response(Bun.gzipSync(new TextEncoder().encode("small body")), {
      headers: { "content-encoding": "gzip" },
    }),
  "/slow": () =>
    new Promise<Response>((resolve) => {
      setTimeout(() => {
        resolve(new Response("late"));
      }, 400);
    }),
};

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request) {
    const url = new URL(request.url);
    hits.push({ url: url.pathname, host: request.headers.get("host") });
    const route = routes[url.pathname];
    return route === undefined ? new Response("not found", { status: 404 }) : route();
  },
});

afterAll(async () => {
  await server.stop(true);
});

const BASE = `http://127.0.0.1:${String(server.port)}`;
const LOOPBACK_ALLOWED = { allowPrivateNetwork: false, localEndpoint: true } as const;

function direct(path: string, overrides: Partial<TransportRequest> = {}): TransportRequest {
  return {
    method: "GET",
    url: `${BASE}${path}`,
    headers: {},
    mode: "direct",
    addressPolicy: LOOPBACK_ALLOWED,
    timeoutMs: 5000,
    maxBytes: 1000,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe("direct mode against a loopback server", () => {
  const transport = createHttpTransport({ resolver: fakeResolver() });

  test("returns status, lower-cased headers and the body, and does not follow redirects", async () => {
    const ok = await transport.send(direct("/ok"));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.status).toBe(200);
      expect(new TextDecoder().decode(ok.value.body)).toBe("hello");
      expect(ok.value.headers["x-custom"]).toBe("Value");
      expect(ok.value.url).toBe(`${BASE}/ok`);
    }
    const redirect = await transport.send(direct("/redirect"));
    expect(redirect.ok).toBe(true);
    if (redirect.ok) {
      expect(redirect.value.status).toBe(302);
      expect(redirect.value.headers["location"]).toBe("/ok");
    }
  });

  test("a declared length over the cap is too_large before the body is read", async () => {
    const result = await transport.send(direct("/big", { maxBytes: 100 }));
    expect(result).toEqual({ ok: false, error: { kind: "too_large", maxBytes: 100 } });
  });

  test("a streamed body without a length is cut at the cap", async () => {
    const result = await transport.send(direct("/chunked", { maxBytes: 250 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("too_large");
    const fits = await transport.send(direct("/chunked", { maxBytes: 500 }));
    expect(fits.ok).toBe(true);
    if (fits.ok) expect(fits.value.body.byteLength).toBe(500);
  });

  test("the cap counts decoded bytes: a small gzip body that inflates past the cap is too_large", async () => {
    const bomb = await transport.send(direct("/gzip-bomb", { maxBytes: 1000 }));
    expect(bomb.ok).toBe(false);
    if (!bomb.ok) expect(bomb.error.kind).toBe("too_large");
    const small = await transport.send(direct("/gzip-small"));
    expect(small.ok).toBe(true);
    if (small.ok) expect(new TextDecoder().decode(small.value.body)).toBe("small body");
  });

  test("a slow server hits the timeout", async () => {
    const result = await transport.send(direct("/slow", { timeoutMs: 60 }));
    expect(result).toEqual({ ok: false, error: { kind: "timeout" } });
  });

  test("an aborted signal ends the request as aborted", async () => {
    const controller = new AbortController();
    const pending = transport.send(direct("/slow", { signal: controller.signal }));
    setTimeout(() => {
      controller.abort();
    }, 30);
    expect(await pending).toEqual({ ok: false, error: { kind: "aborted" } });
  });

  test("a closed port is a network failure", async () => {
    const closed = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
    const port = closed.port;
    await closed.stop(true);
    const result = await transport.send(
      direct("/ok", { url: `http://127.0.0.1:${String(port)}/ok` }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("network");
  });
});

describe("direct mode connects to the address it verified", () => {
  test("a host name is resolved again, verified, and reached by its address with the original Host header", async () => {
    const resolver = fakeResolver({ "pinned.test": ["127.0.0.1"] });
    const transport = createHttpTransport({ resolver });
    hits.length = 0;
    const url = `http://pinned.test:${String(server.port)}/ok`;
    const result = await transport.send(direct("/ok", { url }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.url).toBe(url);
    expect(resolver.lookups).toEqual(["pinned.test"]);
    expect(hits).toEqual([{ url: "/ok", host: `pinned.test:${String(server.port)}` }]);
  });

  test("a name that now resolves to the metadata address is refused and nothing is sent", async () => {
    // 앞단 검사 때는 안전한 주소였다가 연결 시점에 [공개/루프백, 메타데이터]로 바뀐 이름
    const resolver = fakeResolver({ "rebind.test": ["127.0.0.1", "169.254.169.254"] });
    const transport = createHttpTransport({ resolver });
    hits.length = 0;
    const result = await transport.send(
      direct("/ok", { url: `http://rebind.test:${String(server.port)}/ok` }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("blocked");
    expect(hits).toEqual([]);
  });

  test("loopback is not opened by the private-network setting, and a missing policy allows public addresses only", async () => {
    const resolver = fakeResolver({ "lo.test": ["127.0.0.1"] });
    const transport = createHttpTransport({ resolver });
    hits.length = 0;
    const url = `http://lo.test:${String(server.port)}/ok`;
    const privateOnly = await transport.send(
      direct("/ok", { url, addressPolicy: { allowPrivateNetwork: true, localEndpoint: false } }),
    );
    expect(privateOnly.ok).toBe(false);
    const { addressPolicy: _omitted, ...withoutPolicy } = direct("/ok", { url });
    const none = await transport.send(withoutPolicy);
    expect(none.ok).toBe(false);
    expect(hits).toEqual([]);
  });

  test("an unresolvable name is a network failure and an aborted lookup is aborted", async () => {
    const transport = createHttpTransport({ resolver: fakeResolver() });
    const missing = await transport.send(direct("/ok", { url: "http://nowhere.test/ok" }));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.kind).toBe("network");
    const controller = new AbortController();
    controller.abort();
    const aborted = await transport.send(
      direct("/ok", { url: "http://nowhere.test/ok", signal: controller.signal }),
    );
    expect(aborted).toEqual({ ok: false, error: { kind: "aborted" } });
  });
});

describe("public mode keeps the guarded-fetch checks", () => {
  const transport = createHttpTransport({ resolver: fakeResolver() });

  test("loopback addresses and the localhost name are refused before any connection", async () => {
    hits.length = 0;
    const literal = await transport.send(direct("/ok", { mode: "public" }));
    expect(literal.ok).toBe(false);
    if (!literal.ok) expect(literal.error.kind).toBe("blocked");
    const named = await transport.send(
      direct("/ok", { mode: "public", url: `http://localhost:${String(server.port)}/ok` }),
    );
    expect(named.ok).toBe(false);
    if (!named.ok) expect(named.error.kind).toBe("blocked");
    expect(hits).toEqual([]);
  });
});
