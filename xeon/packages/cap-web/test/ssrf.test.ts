import { describe, expect, test } from "bun:test";
import { threadIdOf } from "./support/ids.ts";
import { PUBLIC_IP, makeWorld, reasonOfFailure, type World } from "./support/world.ts";
import { addressVerdict, resolvedVerdict } from "../src/policy/ssrf.ts";

async function reasonOf(world: World, url: string): Promise<string | undefined> {
  const outcome = await world.access.authorize(url, world.context());
  if (outcome.ok) return undefined;
  expect(outcome.error.code).toBe("denied");
  return reasonOfFailure(outcome.error);
}

describe("ssrf", () => {
  test("blocks private and metadata literals", async () => {
    const world = makeWorld();
    const literals = [
      "http://127.0.0.1/",
      "http://2130706433/",
      "http://0x7f.1/",
      "http://0177.0.0.1/",
      "http://127.1/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[64:ff9b::7f00:1]/",
      "http://169.254.169.254/latest/meta-data",
      "http://[fd00:ec2::254]/",
      "http://0.0.0.0/",
      "http://[::]/",
    ];
    const reasons = await Promise.all(literals.map((url) => reasonOf(world, url)));
    for (const [index, url] of literals.entries()) {
      const reason = reasons[index];
      expect([url, reason === "address_blocked" || reason === "metadata_address"]).toEqual([
        url,
        true,
      ]);
    }
    // 연결 시도 0, 이름 해석 0
    expect(world.transport.requests.length).toBe(0);
    expect(world.resolver.lookups.length).toBe(0);
    expect(await reasonOf(world, "http://169.254.169.254/x")).toBe("metadata_address");
  });

  test("a private literal is denied by default and opens with the setting", async () => {
    const closed = makeWorld();
    expect(await reasonOf(closed, "http://10.0.0.5/")).toBe("private_network_disabled");
    const open = makeWorld({ policy: { allowPrivateNetwork: true } });
    const outcome = await open.access.authorize("http://10.0.0.5/", open.context());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value.mode).toBe("direct");
  });

  test("blocks names", async () => {
    const world = makeWorld();
    const names = [
      "http://localhost/",
      "http://a.localhost/",
      "http://intranet/",
      "http://printer.local/",
      "http://svc.internal/",
      "http://router.home.arpa/",
      "http://metadata.google.internal/",
      "http://metadata/",
      "http://instance-data/",
      "http://user:pw@example.com/",
      "ftp://example.com/",
      "file:///etc/passwd",
    ];
    const reasons = await Promise.all(names.map((url) => reasonOf(world, url)));
    for (const [index, url] of names.entries()) {
      expect([url, reasons[index]]).not.toEqual([url, undefined]);
    }
    expect(await reasonOf(world, "http://metadata.google.internal/")).toBe("metadata_name");
    expect(await reasonOf(world, "http://user:pw@example.com/")).toBe("credentials_in_url");
    expect(await reasonOf(world, "ftp://example.com/")).toBe("scheme_not_allowed");
    expect(world.transport.requests.length).toBe(0);
  });

  test("an unparsable URL is invalid input", async () => {
    const world = makeWorld();
    const outcome = await world.access.authorize("not a url", world.context());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("invalid_input");
  });

  test("a public name resolving to a private address is denied before connecting", async () => {
    const world = makeWorld({ hosts: { "evil.example": ["93.184.216.34", "10.0.0.7"] } });
    expect(await reasonOf(world, "https://evil.example/")).toBe("private_network_disabled");
    expect(world.transport.requests.length).toBe(0);
  });

  test("dns rebinding at connect time", async () => {
    const world = makeWorld({ hosts: { "rebind.example": [PUBLIC_IP] } });
    // 첫 조회(사전 검사)는 공개 IP, 연결 시점 조회는 사설 IP
    world.resolver.script("rebind.example", [[PUBLIC_IP], ["10.0.0.1"]]);
    world.transport.route("https://rebind.example/", { body: "secret" });
    const target = await world.access.authorize("https://rebind.example/", world.context());
    expect(target.ok).toBe(true);
    if (!target.ok) return;
    const outcome = await world.content.get(
      target.value,
      { headers: {}, timeoutMs: 1000, maxBytes: 1000 },
      world.context(),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("denied");
      expect(outcome.error.detail).toMatchObject({ reason: "address_blocked_at_connect" });
    }
    expect(world.transport.connections()).toBe(0);
  });

  test("redirect to private is denied at hop", async () => {
    const world = makeWorld({
      hosts: { "public.example": [PUBLIC_IP] },
      routes: {
        "https://public.example/a": { status: 302, headers: { Location: "http://10.0.0.5/" } },
      },
    });
    const target = await world.access.authorize("https://public.example/a", world.context());
    if (!target.ok) throw new Error("expected an approved target");
    const outcome = await world.content.get(
      target.value,
      { headers: {}, timeoutMs: 1000, maxBytes: 1000 },
      world.context(),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("denied");
      expect(outcome.error.detail).toMatchObject({ reason: "private_network_disabled" });
    }
    // 사설 주소로는 연결하지 않았다
    expect(world.transport.requests.map((request) => request.url)).toEqual([
      "https://public.example/a",
    ]);
  });

  test("redirect to metadata is denied at hop", async () => {
    const world = makeWorld({
      hosts: { "public.example": [PUBLIC_IP] },
      routes: {
        "https://public.example/a": {
          status: 301,
          headers: { Location: "http://169.254.169.254/latest/meta-data" },
        },
      },
    });
    const target = await world.access.authorize("https://public.example/a", world.context());
    if (!target.ok) throw new Error("expected an approved target");
    const outcome = await world.content.get(
      target.value,
      { headers: {}, timeoutMs: 1000, maxBytes: 1000 },
      world.context(),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.detail).toMatchObject({ reason: "metadata_address" });
  });

  test("cross host redirect not followed", async () => {
    const world = makeWorld({
      hosts: { "a.example": [PUBLIC_IP], "b.example": [PUBLIC_IP] },
      routes: {
        "https://a.example/": { status: 302, headers: { Location: "https://b.example/landing" } },
      },
    });
    const target = await world.access.authorize("https://a.example/", world.context());
    if (!target.ok) throw new Error("expected an approved target");
    const outcome = await world.content.get(
      target.value,
      { headers: {}, timeoutMs: 1000, maxBytes: 1000 },
      world.context(),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value).toEqual({
      kind: "redirect_not_followed",
      from: "https://a.example/",
      to: "https://b.example/landing",
      status: 302,
    });
    // 따라가지 않은 호스트의 이름은 풀지도 않았다
    expect(world.resolver.lookups).toEqual(["a.example", "a.example"]);
    expect(world.transport.requests.length).toBe(1);
  });

  test("same host redirects are followed up to five", async () => {
    const hops: Record<string, { status: number; headers: Record<string, string> }> = {};
    for (let index = 0; index < 5; index += 1) {
      hops[`https://a.example/${index}`] = { status: 302, headers: { Location: `/${index + 1}` } };
    }
    const world = makeWorld({
      hosts: { "a.example": [PUBLIC_IP] },
      routes: { ...hops, "https://a.example/5": { body: "done" } },
    });
    const target = await world.access.authorize("https://a.example/0", world.context());
    if (!target.ok) throw new Error("expected an approved target");
    const outcome = await world.content.get(
      target.value,
      { headers: {}, timeoutMs: 1000, maxBytes: 1000 },
      world.context(),
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok && outcome.value.kind === "response") {
      expect(outcome.value.finalUrl).toBe("https://a.example/5");
      expect(outcome.value.redirectsFollowed).toBe(5);
    }
  });

  test("same host redirect limit", async () => {
    const hops: Record<string, { status: number; headers: Record<string, string> }> = {};
    for (let index = 0; index < 7; index += 1) {
      hops[`https://a.example/${index}`] = { status: 301, headers: { Location: `/${index + 1}` } };
    }
    const world = makeWorld({ hosts: { "a.example": [PUBLIC_IP] }, routes: hops });
    const target = await world.access.authorize("https://a.example/0", world.context());
    if (!target.ok) throw new Error("expected an approved target");
    const outcome = await world.content.get(
      target.value,
      { headers: {}, timeoutMs: 1000, maxBytes: 1000 },
      world.context(),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("redirect_limit");
    // 처음 요청과 따라간 5번, 6번째 응답에서 멈춘다
    expect(world.transport.requests.length).toBe(6);
  });

  test("http to https upgrade on the same host counts as the same host", async () => {
    const world = makeWorld({
      hosts: { "a.example": [PUBLIC_IP] },
      routes: {
        "http://a.example/": { status: 301, headers: { Location: "https://a.example/" } },
        "https://a.example/": { body: "ok" },
      },
    });
    const target = await world.access.authorize("http://a.example/", world.context());
    if (!target.ok) throw new Error("expected an approved target");
    const outcome = await world.content.get(
      target.value,
      { headers: {}, timeoutMs: 1000, maxBytes: 1000 },
      world.context(),
    );
    expect(outcome.ok && outcome.value.kind === "response" ? outcome.value.finalUrl : "").toBe(
      "https://a.example/",
    );
  });

  test("private network opt-in keeps loopback and metadata blocked", () => {
    const open = { allowPrivateNetwork: true, localEndpoint: false };
    const closed = { allowPrivateNetwork: false, localEndpoint: false };
    expect(addressVerdict("10.0.0.1", open).ok).toBe(true);
    expect(addressVerdict("172.16.5.5", open).ok).toBe(true);
    expect(addressVerdict("192.168.0.9", open).ok).toBe(true);
    expect(addressVerdict("100.64.1.1", open).ok).toBe(true);
    expect(addressVerdict("fc00::5", open).ok).toBe(true);
    expect(addressVerdict("127.0.0.1", open)).toEqual({ ok: false, reason: "address_blocked" });
    expect(addressVerdict("::1", open)).toEqual({ ok: false, reason: "address_blocked" });
    expect(addressVerdict("169.254.169.254", open)).toEqual({
      ok: false,
      reason: "metadata_address",
    });
    expect(addressVerdict("fd00:ec2::254", open)).toEqual({
      ok: false,
      reason: "metadata_address",
    });
    expect(addressVerdict("169.254.1.1", open)).toEqual({ ok: false, reason: "address_blocked" });
    expect(addressVerdict("10.0.0.1", closed)).toEqual({
      ok: false,
      reason: "private_network_disabled",
    });
    expect(resolvedVerdict(["8.8.8.8", "10.0.0.1"], open)).toEqual({ ok: true, mode: "direct" });
    expect(resolvedVerdict(["8.8.8.8"], open)).toEqual({ ok: true, mode: "public" });
    expect(resolvedVerdict(["8.8.8.8", "127.0.0.1"], open).ok).toBe(false);
    expect(resolvedVerdict([], open).ok).toBe(false);
  });

  test("the endpoint exception opens loopback but never metadata", () => {
    const local = { allowPrivateNetwork: false, localEndpoint: true };
    expect(addressVerdict("127.0.0.1", local).ok).toBe(true);
    expect(addressVerdict("::1", local).ok).toBe(true);
    expect(addressVerdict("10.1.1.1", local).ok).toBe(true);
    expect(addressVerdict("169.254.169.254", local)).toEqual({
      ok: false,
      reason: "metadata_address",
    });
    expect(addressVerdict("224.0.0.1", local)).toEqual({ ok: false, reason: "address_blocked" });
  });

  test("thread id helper is stable", () => {
    expect(threadIdOf(2)).not.toBe(threadIdOf(3));
  });
});
