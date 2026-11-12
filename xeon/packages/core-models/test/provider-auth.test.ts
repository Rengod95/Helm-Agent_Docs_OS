import { describe, expect, test } from "bun:test";
import { tape } from "../src/testing/index.ts";
import { PROVIDER_AUTH_TIMEOUT_MS, maskKeyIn, probeProviderAuth } from "../src/provider-auth.ts";
import { createHarness, FAKE_KEY } from "./support/harness.ts";
import { memoryLogger, type LogLine } from "./support/logger.ts";

// provider.checkAuth(L1.models.spec §3.13). 가짜 로컬 HTTP 서버(Bun.serve, 포트 0)에만 보낸다. 실제 제공자 주소는 쓰지 않는다.
// 값은 `toEqual`로 견준다. 키 값이 결과·로그 어디에도 없어야 한다.

const OAT_KEY = "sk-ant-oat01-fake-0123456789abcdef";

interface Seen {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
}

interface Reply {
  readonly status: number;
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly delayMs?: number;
}

interface TestServer {
  readonly url: string;
  readonly seen: Seen[];
  stop(): Promise<void>;
}

function startServer(reply: (path: string) => Reply): TestServer {
  const seen: Seen[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const { pathname } = new URL(request.url);
      seen.push({
        method: request.method,
        path: pathname,
        headers: Object.fromEntries(request.headers.entries()),
      });
      const current = reply(pathname);
      if (current.delayMs !== undefined) await Bun.sleep(current.delayMs);
      return new Response(current.body ?? "", {
        status: current.status,
        ...(current.headers === undefined ? {} : { headers: current.headers }),
      });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, seen, stop: () => server.stop(true) };
}

async function withServer<T>(
  reply: (path: string) => Reply,
  run: (server: TestServer) => Promise<T>,
): Promise<T> {
  const server = startServer(reply);
  try {
    return await run(server);
  } finally {
    await server.stop();
  }
}

function probeOf(
  providerId: string,
  baseUrl: string | null,
  options: { readonly key?: string; readonly timeoutMs?: number } = {},
) {
  return probeProviderAuth({
    providerId,
    key: options.key ?? FAKE_KEY,
    baseUrl,
    fetch: globalThis.fetch,
    signal: new AbortController().signal,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
}

const OK = { status: 200, body: '{"data":[]}' };

const signal = (): AbortSignal => new AbortController().signal;

describe("request shape per provider", () => {
  test("anthropic: GET /v1/models with x-api-key and anthropic-version, no bearer", async () => {
    await withServer(
      () => OK,
      async (server) => {
        expect(await probeOf("anthropic", server.url)).toEqual({ kind: "ok", status: 200 });
        expect(server.seen).toHaveLength(1);
        const [first] = server.seen;
        expect(first?.method).toBe("GET");
        expect(first?.path).toBe("/v1/models");
        expect(first?.headers["x-api-key"]).toBe(FAKE_KEY);
        expect(first?.headers["anthropic-version"]).toBe("2023-06-01");
        expect(first?.headers.authorization).toBeUndefined();
      },
    );
  });

  test("openai: GET /v1/models with Bearer (the default base already ends in /v1)", async () => {
    await withServer(
      () => OK,
      async (server) => {
        expect(await probeOf("openai", `${server.url}/v1`)).toEqual({ kind: "ok", status: 200 });
        const [first] = server.seen;
        expect(first?.path).toBe("/v1/models");
        expect(first?.headers.authorization).toBe(`Bearer ${FAKE_KEY}`);
        expect(first?.headers["x-api-key"]).toBeUndefined();
      },
    );
  });

  test("google: GET /v1beta/models with x-goog-api-key", async () => {
    await withServer(
      () => OK,
      async (server) => {
        expect(await probeOf("google", `${server.url}/v1beta`)).toEqual({
          kind: "ok",
          status: 200,
        });
        const [first] = server.seen;
        expect(first?.path).toBe("/v1beta/models");
        expect(first?.headers["x-goog-api-key"]).toBe(FAKE_KEY);
        expect(first?.headers.authorization).toBeUndefined();
      },
    );
  });

  test("openrouter: GET /key under the /api/v1 base with Bearer", async () => {
    await withServer(
      () => OK,
      async (server) => {
        expect(await probeOf("openrouter", `${server.url}/api/v1`)).toEqual({
          kind: "ok",
          status: 200,
        });
        const [first] = server.seen;
        expect(first?.path).toBe("/api/v1/key");
        expect(first?.headers.authorization).toBe(`Bearer ${FAKE_KEY}`);
      },
    );
  });

  test("a trailing slash on the configured base does not double the path", async () => {
    await withServer(
      () => OK,
      async (server) => {
        await probeOf("anthropic", `${server.url}/`);
        expect(server.seen[0]?.path).toBe("/v1/models");
      },
    );
  });
});

describe("status mapping", () => {
  test("401 with an Anthropic-style error that echoes the key: rejected, and the key is masked", async () => {
    const body = JSON.stringify({
      type: "error",
      error: { type: "authentication_error", message: `invalid x-api-key: ${FAKE_KEY}` },
    });
    await withServer(
      () => ({ status: 401, body }),
      async (server) => {
        const result = await probeOf("anthropic", server.url);
        expect(result).toEqual({
          kind: "rejected",
          status: 401,
          reason: "invalid x-api-key: ••••",
        });
        expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
      },
    );
  });

  test("403 is rejected with the server's reason sentence", async () => {
    await withServer(
      () => ({ status: 403, body: '{"error":{"message":"forbidden for this key"}}' }),
      async (server) => {
        expect(await probeOf("openai", `${server.url}/v1`)).toEqual({
          kind: "rejected",
          status: 403,
          reason: "forbidden for this key",
        });
      },
    );
  });

  test("429 and 402 are quotaOrBilling", async () => {
    await withServer(
      () => ({ status: 429, body: '{"error":{"message":"rate limited"}}' }),
      async (server) => {
        expect(await probeOf("openrouter", `${server.url}/api/v1`)).toEqual({
          kind: "quotaOrBilling",
          status: 429,
          reason: "rate limited",
        });
      },
    );
    await withServer(
      () => ({ status: 402 }),
      async (server) => {
        expect(await probeOf("openrouter", `${server.url}/api/v1`)).toEqual({
          kind: "quotaOrBilling",
          status: 402,
        });
      },
    );
  });

  test("a 400 whose body says billing or quota is quotaOrBilling", async () => {
    await withServer(
      () => ({ status: 400, body: '{"error":{"message":"Your credit balance is too low"}}' }),
      async (server) => {
        expect(await probeOf("anthropic", server.url)).toEqual({
          kind: "quotaOrBilling",
          status: 400,
          reason: "Your credit balance is too low",
        });
      },
    );
  });

  test("Google's 400 for a bad key is rejected, not upstream", async () => {
    const body = JSON.stringify({
      error: {
        code: 400,
        message: "API key not valid. Please pass a valid API key.",
        status: "INVALID_ARGUMENT",
      },
    });
    await withServer(
      () => ({ status: 400, body }),
      async (server) => {
        expect(await probeOf("google", `${server.url}/v1beta`)).toEqual({
          kind: "rejected",
          status: 400,
          reason: "API key not valid. Please pass a valid API key.",
        });
      },
    );
  });

  test("404 on the base URL is badAddress, with a plain-text reason", async () => {
    await withServer(
      () => ({ status: 404, body: "Not Found" }),
      async (server) => {
        expect(await probeOf("openai", `${server.url}/wrong`)).toEqual({
          kind: "badAddress",
          status: 404,
          reason: "Not Found",
        });
      },
    );
  });

  test("a redirect is not followed: badAddress, and the target is never requested", async () => {
    await withServer(
      (path) =>
        path === "/v1/models"
          ? { status: 302, headers: { location: "/elsewhere" } }
          : { status: 200, body: "{}" },
      async (server) => {
        expect(await probeOf("anthropic", server.url)).toEqual({
          kind: "badAddress",
          status: 302,
          reason: "redirect not followed",
        });
        expect(server.seen.map((seen) => seen.path)).toEqual(["/v1/models"]);
      },
    );
  });

  test("5xx is upstream, and an HTML body gives no reason", async () => {
    await withServer(
      () => ({ status: 503, body: "<html><body>Service Unavailable</body></html>" }),
      async (server) => {
        expect(await probeOf("anthropic", server.url)).toEqual({ kind: "upstream", status: 503 });
      },
    );
  });
});

describe("masking the reason", () => {
  test("a prefix fragment and a suffix fragment of the key are masked too", async () => {
    const message = `prefix ${FAKE_KEY.slice(0, 10)} tail ${FAKE_KEY.slice(-9)}`;
    await withServer(
      () => ({ status: 401, body: JSON.stringify({ error: { message } }) }),
      async (server) => {
        expect(await probeOf("anthropic", server.url)).toEqual({
          kind: "rejected",
          status: 401,
          reason: "prefix •••• tail ••••",
        });
      },
    );
  });

  test("a plain-text body echoing the full key is masked", async () => {
    await withServer(
      () => ({ status: 401, body: `bad key ${FAKE_KEY}` }),
      async (server) => {
        expect(await probeOf("openai", `${server.url}/v1`)).toEqual({
          kind: "rejected",
          status: 401,
          reason: "bad key ••••",
        });
      },
    );
  });

  test("the reason is cut to 200 characters after masking, and a key past the cut leaks nothing", async () => {
    const message = `${"x".repeat(250)} ${FAKE_KEY}`;
    await withServer(
      () => ({ status: 401, body: JSON.stringify({ error: { message } }) }),
      async (server) => {
        const result = await probeOf("anthropic", server.url);
        expect(result.kind).toBe("rejected");
        expect(result.reason?.length).toBe(200);
        expect(result.reason?.endsWith("…")).toBe(true);
        expect(JSON.stringify(result)).not.toContain(FAKE_KEY.slice(0, 8));
      },
    );
  });

  test("maskKeyIn masks the whole key and each 8+ character prefix or suffix, but not shorter pieces", () => {
    const key = "sk-fake-not-a-real-key-0123456789abcdef";
    expect(
      maskKeyIn(`a ${key} b ${key.slice(0, 8)} c ${key.slice(-8)} d ${key.slice(0, 7)}`, key),
    ).toBe("a •••• b •••• c •••• d sk-fake");
    expect(maskKeyIn("nothing here", key)).toBe("nothing here");
  });
});

describe("no network call", () => {
  test("a subscription OAuth token (sk-ant-oat prefix) is oauthTokenNotApiKey, with no request", async () => {
    await withServer(
      () => OK,
      async (server) => {
        expect(await probeOf("anthropic", server.url, { key: OAT_KEY })).toEqual({
          kind: "oauthTokenNotApiKey",
        });
        expect(server.seen).toHaveLength(0);
      },
    );
  });

  test("a provider with no known check is unsupported, with no request", async () => {
    await withServer(
      () => OK,
      async (server) => {
        expect(await probeOf("local-llm", server.url)).toEqual({ kind: "unsupported" });
        expect(server.seen).toHaveLength(0);
      },
    );
  });

  test("no base URL is badAddress, and a malformed or non-http base URL is too", async () => {
    expect(await probeOf("anthropic", null)).toEqual({ kind: "badAddress", reason: "no base URL" });
    expect(await probeOf("anthropic", "not a url")).toEqual({
      kind: "badAddress",
      reason: "invalid base URL",
    });
    expect(await probeOf("anthropic", "ftp://127.0.0.1:9")).toEqual({
      kind: "badAddress",
      reason: "invalid base URL",
    });
  });
});

describe("reaching the provider", () => {
  test("a connection refused is badAddress with the error code", async () => {
    const server = startServer(() => OK);
    const url = server.url;
    await server.stop();
    expect(await probeOf("anthropic", url)).toEqual({
      kind: "badAddress",
      reason: expect.stringMatching(/^connection failed/),
    });
  });

  test("a slow response past the timeout is timeout", async () => {
    await withServer(
      () => ({ ...OK, delayMs: 500 }),
      async (server) => {
        expect(await probeOf("anthropic", server.url, { timeoutMs: 50 })).toEqual({
          kind: "timeout",
        });
      },
    );
  });

  test("the default timeout is 8 seconds", () => {
    expect(PROVIDER_AUTH_TIMEOUT_MS).toBe(8000);
  });

  test("the caller's cancel is thrown, not turned into a result", async () => {
    await withServer(
      () => OK,
      async (server) => {
        const controller = new AbortController();
        controller.abort();
        const thrown = await probeProviderAuth({
          providerId: "anthropic",
          key: FAKE_KEY,
          baseUrl: server.url,
          fetch: globalThis.fetch,
          signal: controller.signal,
        }).then(
          () => "resolved",
          (caught: unknown) => caught,
        );
        expect(thrown).toMatchObject({ name: "AbortError" });
      },
    );
  });
});

describe("ModelService.checkProviderAuth", () => {
  const EMPTY = tape("core-models/provider-auth", []);

  test("checks with the stored key through the lease and the configured base URL, and logs without the value", async () => {
    await withServer(
      () => OK,
      async (server) => {
        const lines: LogLine[] = [];
        const h = createHarness({
          tape: EMPTY,
          logger: memoryLogger(lines),
          settings: {
            providers: [
              {
                id: "anthropic",
                enabled: true,
                apiKeyRef: "secret://tape-key",
                baseUrl: server.url,
              },
            ],
          },
        });
        expect(await h.service.checkProviderAuth("anthropic", signal())).toEqual({
          kind: "ok",
          status: 200,
        });
        expect(h.secrets.lastCtx()).toMatchObject({
          mode: "runtime-http",
          purpose: "model.provider:anthropic",
        });
        expect(server.seen[0]?.headers["x-api-key"]).toBe(FAKE_KEY);
        expect(lines).toEqual([
          {
            level: "info",
            event: "provider.auth_checked",
            fields: { provider: "anthropic", kind: "ok", status: 200 },
          },
        ]);
        expect(JSON.stringify(lines)).not.toContain(FAKE_KEY);
      },
    );
  });

  test("a provider with no key reference is noKey, with no request", async () => {
    await withServer(
      () => OK,
      async (server) => {
        const h = createHarness({
          tape: EMPTY,
          settings: {
            providers: [{ id: "anthropic", enabled: true, apiKeyRef: null, baseUrl: server.url }],
          },
        });
        expect(await h.service.checkProviderAuth("anthropic", signal())).toEqual({
          kind: "noKey",
          reason: "provider has no enabled key reference",
        });
        expect(server.seen).toHaveLength(0);
      },
    );
  });

  test("a disabled provider is noKey, even with a key reference", async () => {
    await withServer(
      () => OK,
      async (server) => {
        const h = createHarness({
          tape: EMPTY,
          settings: {
            providers: [
              {
                id: "anthropic",
                enabled: false,
                apiKeyRef: "secret://tape-key",
                baseUrl: server.url,
              },
            ],
          },
        });
        expect(await h.service.checkProviderAuth("anthropic", signal())).toEqual({
          kind: "noKey",
          reason: "provider has no enabled key reference",
        });
        expect(server.seen).toHaveLength(0);
      },
    );
  });

  test("a key the secret store cannot give is noKey with the secret name and error kind only", async () => {
    await withServer(
      () => OK,
      async (server) => {
        const h = createHarness({
          tape: EMPTY,
          settings: {
            providers: [
              {
                id: "anthropic",
                enabled: true,
                apiKeyRef: "secret://tape-key",
                baseUrl: server.url,
              },
            ],
          },
        });
        h.secrets.setMissing("tape-key", true);
        const result = await h.service.checkProviderAuth("anthropic", signal());
        expect(result).toEqual({
          kind: "noKey",
          reason: "secret tape-key could not be leased (secret_missing)",
        });
        expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
        expect(server.seen).toHaveLength(0);
      },
    );
  });
});
