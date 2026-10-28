import { describe, expect, test } from "bun:test";
import type { ScopeLayer, ScopeStack } from "@xeon/contracts/settings";
import {
  decideDomain,
  isDomainPattern,
  matchDomain,
  mergeDomainRules,
  normalizeHost,
  resolveDomainPolicy,
} from "../src/policy/domain.ts";
import { fakeAsker } from "../src/testing/fake-ports.ts";
import { PUBLIC_IP, makeWorld, reasonOfFailure } from "./support/world.ts";
import { threadIdOf } from "./support/ids.ts";

function layer(scope: ScopeLayer["scope"], values: Record<string, unknown>): ScopeLayer {
  return { scope, values: new Map(Object.entries(values)) };
}

describe("domain policy", () => {
  test("wildcard dot boundary", () => {
    expect(matchDomain("*.example.com", "a.example.com")).toBe(true);
    expect(matchDomain("*.example.com", "a.b.example.com")).toBe(true);
    expect(matchDomain("*.example.com", "example.com")).toBe(false);
    expect(matchDomain("*.example.com", "badexample.com")).toBe(false);
    expect(matchDomain("*.example.com", "example.com.evil.net")).toBe(false);
    expect(matchDomain("example.com", "example.com")).toBe(true);
    expect(matchDomain("example.com", "www.example.com")).toBe(false);
    expect(matchDomain("example.com", "example.com.evil.net")).toBe(false);
    expect(matchDomain("*", "anything.test")).toBe(true);
    // 끝이 *인 패턴은 문법 밖이라 맞지 않는다
    expect(isDomainPattern("example.*")).toBe(false);
    expect(matchDomain("example.*", "example.com")).toBe(false);
    for (const bad of [
      "",
      "*.",
      "exa mple.com",
      "example.com:443",
      "example.com/path",
      "*example.com",
      "a.*.com",
    ]) {
      expect([bad, isDomainPattern(bad)]).toEqual([bad, false]);
    }
    for (const good of [
      "example.com",
      "*.example.com",
      "*",
      "xn--bcher-kva.example",
      "A.Example.COM",
    ]) {
      expect([good, isDomainPattern(good)]).toEqual([good, true]);
    }
  });

  test("hosts compare after normalisation", () => {
    expect(normalizeHost("Example.COM.")).toBe("example.com");
    expect(normalizeHost("bücher.example")).toBe("xn--bcher-kva.example");
    expect(normalizeHost("[::1]")).toBe("::1");
    expect(matchDomain("*.EXAMPLE.com", "Sub.Example.Com.")).toBe(true);
  });

  test("deny ask allow precedence", () => {
    const rules = { allow: ["a.example.com"], ask: ["a.example.com"], deny: ["a.example.com"] };
    expect(decideDomain(rules, "a.example.com")).toBe("deny");
    expect(decideDomain({ ...rules, deny: [] }, "a.example.com")).toBe("ask");
    expect(decideDomain({ ...rules, deny: [], ask: [] }, "a.example.com")).toBe("allow");
    // 어느 규칙에도 맞지 않으면 ask
    expect(decideDomain({ allow: [], ask: [], deny: [] }, "other.test")).toBe("ask");
  });

  test("lower scope cannot lift deny", () => {
    const stack: ScopeStack = [
      layer("user", { "l2.web.policy.deny": ["*.example.com"] }),
      layer("project", { "l2.web.policy.allow": ["a.example.com"] }),
    ];
    const rules = resolveDomainPolicy(stack);
    expect(decideDomain(rules, "a.example.com")).toBe("deny");
    expect(decideDomain(rules, "example.com")).toBe("ask");
  });

  test("agent rules can only narrow", () => {
    const stack: ScopeStack = [layer("user", { "l2.web.policy.allow": ["docs.example.com"] })];
    const parent = resolveDomainPolicy(stack);
    const child = resolveDomainPolicy(stack, {
      allow: ["x.test"],
      ask: [],
      deny: ["docs.example.com"],
    });
    expect(decideDomain(parent, "docs.example.com")).toBe("allow");
    expect(decideDomain(child, "docs.example.com")).toBe("deny");
    expect(mergeDomainRules(parent, undefined)).toBe(parent);
  });

  test("a denied domain is refused before any lookup", async () => {
    const world = makeWorld({ policy: { allow: ["*"], deny: ["*.example.com"] } });
    const outcome = await world.access.authorize("https://a.example.com/", world.context());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(reasonOfFailure(outcome.error)).toBe("domain_denied");
    }
    expect(world.resolver.lookups.length).toBe(0);
  });

  test("ask without session denies", async () => {
    const asker = fakeAsker("allow");
    const world = makeWorld({ policy: { allow: [], ask: ["*.example.com"] }, asker });
    const extension = await world.access.authorize(
      "https://a.example.com/",
      world.context({ caller: { kind: "extension", extension: "helm" } }),
    );
    expect(extension.ok).toBe(false);
    if (!extension.ok) {
      expect(extension.error.code).toBe("denied");
      expect(reasonOfFailure(extension.error)).toBe("ask_without_session");
    }
    // 세션 없는 호스트 호출도 같다. 기본 판정(규칙 없음)이 ask이기 때문이다
    const host = await world.access.authorize("https://b.example.org/", world.context());
    expect(host.ok).toBe(false);
    expect(asker.requests.length).toBe(0);
  });

  test("a background fork cannot ask", async () => {
    const asker = fakeAsker("allow");
    const world = makeWorld({ policy: { allow: [] }, asker });
    const outcome = await world.access.authorize(
      "https://b.example.org/",
      world.context({ threadId: threadIdOf(1), caller: { kind: "model", agent: "background" } }),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(reasonOfFailure(outcome.error)).toBe("background_ask");
    expect(asker.requests.length).toBe(0);
  });

  test("ask with a session goes to the user and honours the answer", async () => {
    const hosts = { "b.example.org": [PUBLIC_IP] };
    const allowed = fakeAsker("allow");
    const worldAllow = makeWorld({ policy: { allow: [] }, asker: allowed, hosts });
    const context = worldAllow.context({
      threadId: threadIdOf(1),
      caller: { kind: "extension", extension: "helm" },
    });
    const yes = await worldAllow.access.authorize("https://b.example.org/", context);
    expect(yes.ok).toBe(true);
    expect(allowed.requests.length).toBe(1);
    expect(allowed.requests[0]).toMatchObject({
      host: "b.example.org",
      capability: "web.fetch",
      reasons: ["policy_ask"],
    });
    expect(allowed.requests[0]?.requestKey.length).toBeLessThanOrEqual(48);

    const denied = fakeAsker("deny");
    const worldDeny = makeWorld({ policy: { allow: [] }, asker: denied, hosts });
    const no = await worldDeny.access.authorize(
      "https://b.example.org/",
      worldDeny.context({
        threadId: threadIdOf(1),
        caller: { kind: "extension", extension: "helm" },
      }),
    );
    expect(no.ok).toBe(false);
    if (!no.ok) expect(reasonOfFailure(no.error)).toBe("ask_denied");
    // 거부하면 이름을 풀지도 않는다
    expect(worldDeny.resolver.lookups.length).toBe(0);

    const missing = makeWorld({ policy: { allow: [] }, asker: fakeAsker("unavailable"), hosts });
    const none = await missing.access.authorize(
      "https://b.example.org/",
      missing.context({
        threadId: threadIdOf(1),
        caller: { kind: "extension", extension: "helm" },
      }),
    );
    expect(none.ok).toBe(false);
    if (!none.ok) expect(reasonOfFailure(none.error)).toBe("ask_unavailable");
  });
});
