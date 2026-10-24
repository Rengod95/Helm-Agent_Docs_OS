import { describe, expect, test } from "bun:test";
import { createAccess, hasSecretPattern } from "../src/policy/access.ts";
import { createSeenUrls, extractUrls } from "../src/policy/seen-urls.ts";
import { fakeAsker } from "../src/testing/fake-ports.ts";
import { PUBLIC_IP, makeWorld, reasonOfFailure } from "./support/world.ts";
import { threadIdOf } from "./support/ids.ts";

const HOSTS = { "known.example": [PUBLIC_IP], "new.example": [PUBLIC_IP] };
// 키 모양 문자열은 소스에 한 덩어리로 적지 않는다(비밀 스캐너가 시험 값을 유출로 읽는다)
const awsLikeKey = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
const MODEL = { kind: "model", agent: "main" } as const;

describe("unseen urls and secret patterns", () => {
  test("a URL that never appeared asks once and merges reasons", async () => {
    const asker = fakeAsker("allow");
    const world = makeWorld({ hosts: HOSTS, asker, policy: { allow: [], unseenUrl: "ask" } });
    const thread = threadIdOf(1);
    world.seen.note(thread, ["https://known.example/a"]);
    const known = await world.access.authorize(
      "https://known.example/a",
      world.context({ threadId: thread, caller: MODEL }),
    );
    expect(known.ok).toBe(true);
    // 도메인 규칙이 없어 policy_ask는 나지만, 나온 URL이라 unseen_url은 아니다
    expect(asker.requests[0]?.reasons).toEqual(["policy_ask"]);

    const fresh = await world.access.authorize(
      "https://new.example/b",
      world.context({ threadId: thread, caller: MODEL, askKey: "call-2" }),
    );
    expect(fresh.ok).toBe(true);
    expect(asker.requests.length).toBe(2);
    expect(asker.requests[1]?.reasons).toEqual(["policy_ask", "unseen_url"]);
  });

  test("unseenUrl deny and allow", async () => {
    const thread = threadIdOf(1);
    const deny = makeWorld({ hosts: HOSTS, policy: { unseenUrl: "deny" } });
    const refused = await deny.access.authorize(
      "https://new.example/b",
      deny.context({ threadId: thread, caller: MODEL }),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(reasonOfFailure(refused.error)).toBe("unseen_url");

    const allow = makeWorld({ hosts: HOSTS, policy: { unseenUrl: "allow" } });
    const accepted = await allow.access.authorize(
      "https://new.example/b",
      allow.context({ threadId: thread, caller: MODEL }),
    );
    expect(accepted.ok).toBe(true);
    expect(allow.asker.requests.length).toBe(0);
  });

  test("the unseen check applies to the model path only", async () => {
    const world = makeWorld({ hosts: HOSTS, policy: { unseenUrl: "deny" } });
    const thread = threadIdOf(1);
    const extension = await world.access.authorize(
      "https://new.example/b",
      world.context({ threadId: thread, caller: { kind: "extension", extension: "helm" } }),
    );
    expect(extension.ok).toBe(true);
  });

  test("urls from user text count as seen", async () => {
    const world = makeWorld({ hosts: HOSTS, policy: { unseenUrl: "deny" } });
    const thread = threadIdOf(1);
    world.seen.noteText(thread, "please read https://new.example/b, then summarise.");
    const outcome = await world.access.authorize(
      "https://new.example/b",
      world.context({ threadId: thread, caller: MODEL }),
    );
    expect(outcome.ok).toBe(true);
  });

  test("urls are extracted without trailing punctuation", () => {
    expect(extractUrls("see (https://a.example/x). And https://b.example/y?q=1!")).toEqual([
      "https://a.example/x",
      "https://b.example/y?q=1",
    ]);
    expect(extractUrls("no links here")).toEqual([]);
  });

  test("secret-looking strings in the path or query ask", async () => {
    expect(hasSecretPattern(new URL("https://a.example/p?key=sk-abcdefghijklmnopqrstuv"))).toBe(
      true,
    );
    expect(hasSecretPattern(new URL("https://a.example/ghp_abcdefghijklmnopqrstuvwxyz0123"))).toBe(
      true,
    );
    expect(hasSecretPattern(new URL(`https://a.example/?k=${awsLikeKey}`))).toBe(true);
    expect(
      hasSecretPattern(
        new URL("https://a.example/?t=eyJhbGciOiJI.eyJzdWIiOiIx.SflKxwRJSMeKKF2QT4"),
      ),
    ).toBe(true);
    expect(hasSecretPattern(new URL("https://a.example/docs/skills-overview"))).toBe(false);

    const asker = fakeAsker("deny");
    const world = makeWorld({ hosts: HOSTS, asker });
    const outcome = await world.access.authorize(
      "https://known.example/?key=sk-abcdefghijklmnopqrstuv",
      world.context({ threadId: threadIdOf(1), caller: { kind: "extension", extension: "x" } }),
    );
    expect(outcome.ok).toBe(false);
    expect(asker.requests[0]?.reasons).toEqual(["secret_pattern"]);
  });

  test("a registered secret value is refused before anything else", async () => {
    const world = makeWorld({ hosts: HOSTS, secretValues: ["hunter2-top-secret"] });
    const outcome = await world.access.authorize(
      "https://known.example/?q=hunter2-top-secret",
      world.context(),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("denied");
      expect(reasonOfFailure(outcome.error)).toBe("secret_in_query");
      expect(outcome.error.message).not.toContain("hunter2");
    }
    expect(world.access.checkOutboundText("harmless")).toBeUndefined();
    expect(world.access.checkOutboundText("a hunter2-top-secret b")?.code).toBe("denied");
    expect(world.resolver.lookups.length).toBe(0);
  });

  test("session history that cannot be read stops the call", async () => {
    const world = makeWorld({ hosts: HOSTS });
    const failing = createAccess({
      resolver: world.resolver,
      settings: () => world.settings,
      seen: createSeenUrls({
        recordedSources: () =>
          Promise.resolve({ ok: false, error: { kind: "read_failed", cause: "io" } }),
      }),
      guard: undefined,
      asker: undefined,
    });
    const outcome = await failing.authorize(
      "https://new.example/b",
      world.context({ threadId: threadIdOf(1), caller: MODEL }),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("unavailable");
      expect(outcome.error.retryable).toBe(true);
    }
  });
});
