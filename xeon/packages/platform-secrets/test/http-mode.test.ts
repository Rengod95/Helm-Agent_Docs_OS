import { describe, expect, test } from "bun:test";
import type { SecretAuditRecord } from "@xeon/contracts/capabilities";
import type { ConcreteHttpRequest, HttpResponseLike, UseCtx } from "@xeon/contracts/services";
import { memorySecrets } from "../src/testing/index.ts";
import { manualClock } from "./support/clock.ts";
import { forms } from "./support/encode.ts";
import { fixedLocalIds } from "./support/ids.ts";
import { metaOf, type MetaInput } from "./support/meta.ts";
import { handleOf } from "./support/names.ts";
import { fakeValue, seededRandom } from "./support/random.ts";

const CTX: Omit<UseCtx, "mode" | "target"> = {
  purpose: "http.request",
  actor: "runtime",
  threadId: "thr_test",
  toolCallId: "call_1",
  projectId: null,
  approval: null,
};

interface SentRequest {
  readonly request: ConcreteHttpRequest;
}

function setup(metaInput: MetaInput = {}, secrets: readonly string[] = ["github-token"]) {
  const clock = manualClock();
  const random = seededRandom(91);
  const values = new Map(secrets.map((name) => [name, fakeValue(random, 24, true)]));
  const service = memorySecrets({
    clock,
    scheduler: clock,
    ids: fixedLocalIds(),
    secrets: secrets.map((name) => ({
      meta: metaOf({ ...metaInput, name, ref: `dev/${name.toUpperCase()}` }),
      value: values.get(name) ?? "",
    })),
  });
  const records: SecretAuditRecord[] = [];
  service.onAudit((record) => records.push(record));
  const sent: SentRequest[] = [];
  const respond =
    (response: HttpResponseLike) =>
    (request: ConcreteHttpRequest): Promise<HttpResponseLike> => {
      sent.push({ request });
      return Promise.resolve(response);
    };
  return { service, records, sent, values, respond };
}

const OK: HttpResponseLike = { status: 200, headers: {}, bodyText: "fine" };

const failing = (): Promise<HttpResponseLike> => Promise.reject(new Error("network down"));

describe("withHttp (spec §4.3 M3 rules)", () => {
  test("substitutes handle in header only for allowed host", async () => {
    const { service, sent, values, respond, records } = setup();
    const secret = values.get("github-token") ?? "";
    const result = await service.withHttp(
      {
        method: "GET",
        url: "https://api.example.test/user",
        headers: { Authorization: "Bearer secret://github-token", Accept: "application/json" },
        body: null,
      },
      CTX,
      respond(OK),
    );
    expect(result).toEqual({ ok: true, value: { response: OK, echoed: false } });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.request.headers["Authorization"]).toBe(`Bearer ${secret}`);
    expect(sent[0]?.request.headers["Accept"]).toBe("application/json");
    expect(sent[0]?.request.url).toBe("https://api.example.test/user");
    expect(records.map((r) => r.type)).toEqual(["secret.used"]);
    expect(JSON.stringify(records)).not.toContain(secret);
    expect(service.activeLeaseCount(handleOf("github-token"))).toBe(0);
  });

  test("denies a host outside the allowlist: send and provider are never called", async () => {
    const { service, sent, respond, records } = setup();
    const result = await service.withHttp(
      {
        method: "GET",
        url: "https://other.example.test/user",
        headers: { Authorization: "secret://github-token" },
        body: null,
      },
      CTX,
      respond(OK),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ kind: "denied", reason: "host_mismatch" });
    expect(sent).toHaveLength(0);
    expect(service.providerLeaseCalls()).toBe(0);
    expect(records.filter((r) => r.type === "secret.denied")).toHaveLength(1);
  });

  test("rejects handle in url", async () => {
    const { service, sent, respond } = setup();
    const urls = [
      "https://api.example.test/user?token=secret://github-token",
      "secret://github-token",
      "not a url",
      "ftp://api.example.test/x",
    ];
    const results = await Promise.all(
      urls.map((url) =>
        service.withHttp({ method: "GET", url, headers: {}, body: null }, CTX, respond(OK)),
      ),
    );
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("invalid_ref");
    }
    expect(sent).toHaveLength(0);
    expect(service.providerLeaseCalls()).toBe(0);
  });

  test("rejects malformed header and body tokens", async () => {
    const { service, sent, respond } = setup();
    const bad: Record<string, string>[] = [
      { Authorization: "Bearer secret://github-token extra" },
      { Authorization: "a secret://github-token b secret://github-token" },
      { Authorization: "secret://github-token/path" },
      { Authorization: "secret://Github-Token" },
    ];
    const results = await Promise.all(
      bad.map((headers) =>
        service.withHttp(
          { method: "GET", url: "https://api.example.test/", headers, body: null },
          CTX,
          respond(OK),
        ),
      ),
    );
    for (const result of results) expect(result.ok).toBe(false);
    const body = await service.withHttp(
      {
        method: "POST",
        url: "https://api.example.test/",
        headers: {},
        body: "x secret://github-token/y",
      },
      CTX,
      respond(OK),
    );
    expect(body.ok).toBe(false);
    expect(sent).toHaveLength(0);
  });

  test("substitutes handles in string bodies and leaves binary bodies alone", async () => {
    const { service, sent, values, respond } = setup();
    const secret = values.get("github-token") ?? "";
    await service.withHttp(
      {
        method: "POST",
        url: "https://api.example.test/login",
        headers: {},
        body: '{"key":"secret://github-token","again":"secret://github-token"}',
      },
      CTX,
      respond(OK),
    );
    expect(sent[0]?.request.body).toBe(`{"key":"${secret}","again":"${secret}"}`);
    const bytes = new Uint8Array([1, 2, 3]);
    await service.withHttp(
      { method: "POST", url: "https://api.example.test/", headers: {}, body: bytes },
      CTX,
      respond(OK),
    );
    expect(sent[1]?.request.body).toBe(bytes);
  });

  test("a request without handles is sent unchanged and opens no lease", async () => {
    const { service, sent, respond } = setup();
    const result = await service.withHttp(
      { method: "GET", url: "https://anywhere.example.test/", headers: { A: "b" }, body: null },
      CTX,
      respond(OK),
    );
    expect(result.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(service.providerLeaseCalls()).toBe(0);
  });

  test("flags echoed response and reports masking without value", async () => {
    const { service, values, respond, records } = setup();
    const secret = values.get("github-token") ?? "";
    const result = await service.withHttp(
      {
        method: "GET",
        url: "https://api.example.test/echo",
        headers: { Authorization: "secret://github-token" },
        body: null,
      },
      CTX,
      respond({ status: 200, headers: { "x-echo": "n/a" }, bodyText: `you sent ${secret}` }),
    );
    expect(result.ok && result.value.echoed).toBe(true);
    const masked = records.find((r) => r.type === "secret.masked");
    expect(masked).toMatchObject({
      type: "secret.masked",
      layer: "tool-result",
      threadId: "thr_test",
    });
    for (const form of forms(secret)) {
      expect(JSON.stringify(records)).not.toContain(form.text);
    }
    expect(service.redactor.mask(`you sent ${secret}`).text).not.toContain(secret);
  });

  test("two handles: one denial means no value is substituted", async () => {
    const { service, sent, respond } = setup({}, ["github-token", "other-token"]);
    const result = await service.withHttp(
      {
        method: "GET",
        url: "https://api.example.test/",
        headers: { A: "secret://github-token", B: "secret://other-token" },
        body: null,
      },
      { ...CTX, purpose: "http.request" },
      respond(OK),
    );
    expect(result.ok).toBe(true);
    expect(sent).toHaveLength(1);

    const second = setup({}, ["github-token"]);
    const blocked = await second.service.withHttp(
      {
        method: "GET",
        url: "https://api.example.test/",
        headers: { A: "secret://github-token", B: "secret://missing-one" },
        body: null,
      },
      CTX,
      second.respond(OK),
    );
    expect(blocked.ok).toBe(false);
    expect(second.sent).toHaveLength(0);
    expect(second.service.providerLeaseCalls()).toBe(0);
  });

  test("leases are closed even when send throws", async () => {
    const { service } = setup();
    const caught = await service
      .withHttp(
        {
          method: "GET",
          url: "https://api.example.test/",
          headers: { A: "secret://github-token" },
          body: null,
        },
        CTX,
        failing,
      )
      .catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(Error);
    expect(service.activeLeaseCount(handleOf("github-token"))).toBe(0);
  });

  test("approval and policy apply to http as for any lease", async () => {
    const { service, sent, respond } = setup({ approval: "per-use" });
    const result = await service.withHttp(
      {
        method: "GET",
        url: "https://api.example.test/",
        headers: { A: "secret://github-token" },
        body: null,
      },
      CTX,
      respond(OK),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ reason: "approval_missing" });
    expect(sent).toHaveLength(0);
  });
});
