import { describe, expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { err, ok } from "@fresnel/contracts";
import { createAccess, type Access } from "../src/policy/access.ts";
import { createSeenUrls } from "../src/policy/seen-urls.ts";
import type { WebAskAnswer } from "../src/ports/ask.ts";
import { DEFAULT_WEB_SETTINGS, type WebSettings } from "../src/settings.ts";
import {
  fakeAsker,
  fakePolicyWriter,
  fakeSessionSources,
  type FakeAsker,
} from "../src/testing/fake-ports.ts";
import { fakeResolver } from "../src/testing/fake-resolver.ts";
import { PUBLIC_IP } from "./support/world.ts";
import { threadIdOf } from "./support/ids.ts";

// L2.web.spec §4.5.5: 웹 접근 승인의 선택지(이번만, 이 사이트 계속, 모든 사이트, 거부)와 그 뒤의 판정 [결정: 2026-11-15 사용자]

const HOSTS = {
  "a.example": [PUBLIC_IP],
  "b.example": [PUBLIC_IP],
  "blocked.example": [PUBLIC_IP],
};
const MODEL = { kind: "model", agent: "main" } as const;
const awsLikeKey = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");

interface Harness {
  readonly access: Access;
  readonly asker: FakeAsker;
  readonly settings: { current: WebSettings };
  readonly writer: ReturnType<typeof fakePolicyWriter>;
  ask(url: string, threadId?: ThreadId): ReturnType<Access["authorize"]>;
}

/** 쓰기 대역이 설정 객체를 바꾸므로 선택의 효과를 다음 호출에서 볼 수 있다. `answers`는 질문마다 차례로 쓴다 */
function harness(
  answers: readonly WebAskAnswer[],
  options: { policy?: Partial<WebSettings["policy"]>; writerFails?: boolean } = {},
): Harness {
  const settings = {
    current: {
      ...DEFAULT_WEB_SETTINGS,
      policy: { ...DEFAULT_WEB_SETTINGS.policy, ...options.policy },
    },
  };
  const requests: FakeAsker["requests"] = [];
  let index = 0;
  const asker: FakeAsker = {
    requests,
    ask(request) {
      requests.push(request);
      const answer = answers[index];
      index += 1;
      return Promise.resolve(
        answer === undefined ? err({ kind: "unavailable" as const, message: "none" }) : ok(answer),
      );
    },
  };
  const base = fakePolicyWriter(options.writerFails === true);
  const writer = {
    ...base,
    async allowHost(host: string) {
      const written = await base.allowHost(host);
      if (written.ok) {
        settings.current = {
          ...settings.current,
          policy: { ...settings.current.policy, allow: [...settings.current.policy.allow, host] },
        };
      }
      return written;
    },
    async allowAllSites() {
      const written = await base.allowAllSites();
      if (written.ok) {
        settings.current = {
          ...settings.current,
          policy: { ...settings.current.policy, default: "allow" as const },
        };
      }
      return written;
    },
  };
  const access = createAccess({
    resolver: fakeResolver(HOSTS),
    settings: () => settings.current,
    seen: createSeenUrls(fakeSessionSources()),
    guard: undefined,
    asker,
    policyWriter: writer,
  });
  const controller = new AbortController();
  return {
    access,
    asker,
    settings,
    writer,
    ask: (url, threadId = threadIdOf(1)) =>
      access.authorize(url, {
        threadId,
        caller: MODEL,
        capability: "web.fetch",
        askKey: `call-${url}-${threadId}`,
        signal: controller.signal,
      }),
  };
}

describe("web access choices", () => {
  test("allow once passes this call and writes nothing; the next call asks again", async () => {
    const h = harness(["allow", "allow"]);
    expect((await h.ask("https://a.example/x")).ok).toBe(true);
    expect((await h.ask("https://a.example/y")).ok).toBe(true);
    expect(h.asker.requests.length).toBe(2);
    expect(h.writer.hosts).toEqual([]);
    expect(h.writer.allSites.count).toBe(0);
  });

  test("the request carries the full URL, host, reasons and the offered scopes", async () => {
    const h = harness(["deny"]);
    await h.ask("https://a.example/x?q=1");
    expect(h.asker.requests[0]).toMatchObject({
      host: "a.example",
      url: "https://a.example/x?q=1",
      capability: "web.fetch",
      reasons: ["policy_ask", "unseen_url"],
      scopes: ["once", "site", "all"],
    });
  });

  test("deny refuses and writes nothing", async () => {
    const h = harness(["deny"]);
    const result = await h.ask("https://a.example/x");
    expect(result.ok).toBe(false);
    expect(h.writer.hosts).toEqual([]);
  });

  test("this site always: the host is written, other conversations skip the domain question, other hosts still ask", async () => {
    const h = harness(["allow_site", "allow", "allow"]);
    expect((await h.ask("https://a.example/x")).ok).toBe(true);
    expect(h.writer.hosts).toEqual(["a.example"]);
    // 다른 대화. 도메인 질문은 없고 처음 보는 URL 질문만 남는다(§4.5.5)
    expect((await h.ask("https://a.example/y", threadIdOf(2))).ok).toBe(true);
    expect(h.asker.requests[1]?.reasons).toEqual(["unseen_url"]);
    // 다른 호스트는 도메인 질문이 그대로다
    expect((await h.ask("https://b.example/x", threadIdOf(2))).ok).toBe(true);
    expect(h.asker.requests[2]?.reasons).toEqual(["policy_ask", "unseen_url"]);
  });

  test("all sites: the default turns to allow, no more questions, and the deny list still wins", async () => {
    const h = harness(["allow_all"], { policy: { deny: ["blocked.example"] } });
    expect((await h.ask("https://a.example/x")).ok).toBe(true);
    expect(h.writer.allSites.count).toBe(1);
    expect(h.settings.current.policy.default).toBe("allow");
    expect((await h.ask("https://b.example/x", threadIdOf(2))).ok).toBe(true);
    expect(h.asker.requests.length).toBe(1);
    const blocked = await h.ask("https://blocked.example/x", threadIdOf(2));
    expect(blocked.ok).toBe(false);
    expect(h.asker.requests.length).toBe(1);
  });

  test("with the default allow, an ask-list host still asks and unseenUrl deny still blocks", async () => {
    const asking = harness(["deny"], { policy: { default: "allow", ask: ["a.example"] } });
    expect((await asking.ask("https://a.example/x")).ok).toBe(false);
    expect(asking.asker.requests[0]?.reasons).toEqual(["policy_ask"]);
    const strict = harness([], { policy: { default: "allow", unseenUrl: "deny" } });
    expect((await strict.ask("https://b.example/x")).ok).toBe(false);
    expect(strict.asker.requests.length).toBe(0);
  });

  test("resetting the default (back to ask) makes the question come back", async () => {
    const h = harness(["allow_all", "deny"]);
    await h.ask("https://a.example/x");
    expect((await h.ask("https://b.example/x")).ok).toBe(true);
    h.settings.current = {
      ...h.settings.current,
      policy: { ...h.settings.current.policy, default: "ask" },
    };
    expect((await h.ask("https://b.example/y")).ok).toBe(false);
    expect(h.asker.requests.length).toBe(2);
  });

  test("a secret-looking URL offers once only, redacts the URL, and an always answer cannot write or skip", async () => {
    const h = harness(["allow_all"]);
    const url = `https://a.example/p?key=${awsLikeKey}`;
    expect((await h.ask(url)).ok).toBe(true);
    expect(h.asker.requests[0]).toMatchObject({
      url: "https://a.example/",
      scopes: ["once"],
    });
    expect(h.asker.requests[0]?.reasons).toContain("secret_pattern");
    expect(h.writer.allSites.count).toBe(0);
    expect(h.settings.current.policy.default).toBe("ask");
  });

  test("with the default allow a secret-looking URL still asks", async () => {
    const h = harness(["deny"], { policy: { default: "allow" } });
    const result = await h.ask(`https://a.example/p?key=${awsLikeKey}`);
    expect(result.ok).toBe(false);
    expect(h.asker.requests[0]?.reasons).toEqual(["secret_pattern"]);
  });

  test("a failed settings write still lets this call through", async () => {
    const h = harness(["allow_site"], { writerFails: true });
    expect((await h.ask("https://a.example/x")).ok).toBe(true);
    expect(h.settings.current.policy.allow).toEqual([]);
  });

  test("an IPv6 literal host is not a domain pattern: only once and all are offered", async () => {
    const h = harness(["allow"]);
    await h.ask("https://[2606:4700:4700::1111]/x");
    expect(h.asker.requests[0]?.scopes).toEqual(["once", "all"]);
  });

  test("without a human (no thread) the policy still applies: ask becomes a refusal", async () => {
    const h = harness(["allow_all"]);
    const result = await h.access.authorize("https://a.example/x", {
      threadId: undefined,
      caller: { kind: "host" },
      capability: "web.fetch",
      askKey: "k",
      signal: new AbortController().signal,
    });
    expect(result.ok).toBe(false);
    expect(h.asker.requests.length).toBe(0);
  });

  test("fakeAsker accepts the new answers", async () => {
    const asker = fakeAsker("allow_site");
    const answer = await asker.ask(
      {
        threadId: threadIdOf(1),
        capability: "web.fetch",
        host: "a.example",
        url: "https://a.example/",
        reasons: ["policy_ask"],
        scopes: ["once"],
        requestKey: "k",
      },
      new AbortController().signal,
    );
    expect(answer).toEqual({ ok: true, value: "allow_site" });
  });
});
