import { describe, expect, test } from "bun:test";
import { fakeAsker } from "../src/testing/fake-ports.ts";
import { PUBLIC_IP, makeWorld, reasonOfFailure } from "./support/world.ts";
import { threadIdOf } from "./support/ids.ts";

// [결정: 2026-11-13 사용자] 권한 모드가 "모두 허용"이면 실행 허가 성격의 웹 승인(도메인 확인, 처음 보는 URL)은 묻지 않는다.
// 비밀 패턴이 든 URL은 모드와 무관하게 묻는다. 도메인 deny 규칙과 unseenUrl "deny" 설정은 그대로 막는다.

const HOSTS = { "new.example": [PUBLIC_IP], "blocked.example": [PUBLIC_IP] };
const MODEL = { kind: "model", agent: "main" } as const;
const awsLikeKey = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
const covered = threadIdOf(1);
const other = threadIdOf(2);
const cover = (threadId: string): boolean => threadId === covered;

describe("web approvals under a mode that covers run approvals", () => {
  test("an unlisted domain and an unseen URL are allowed without asking", async () => {
    const asker = fakeAsker("deny");
    const world = makeWorld({
      hosts: HOSTS,
      asker,
      policy: { allow: [], unseenUrl: "ask" },
      approvalCover: cover,
    });
    const result = await world.access.authorize(
      "https://new.example/a",
      world.context({ threadId: covered, caller: MODEL }),
    );
    expect(result.ok).toBe(true);
    expect(asker.requests).toEqual([]);
  });

  test("a thread the mode does not cover still asks with both reasons", async () => {
    const asker = fakeAsker("allow");
    const world = makeWorld({
      hosts: HOSTS,
      asker,
      policy: { allow: [], unseenUrl: "ask" },
      approvalCover: cover,
    });
    const result = await world.access.authorize(
      "https://new.example/a",
      world.context({ threadId: other, caller: MODEL }),
    );
    expect(result.ok).toBe(true);
    expect(asker.requests.map((request) => request.reasons)).toEqual([
      ["policy_ask", "unseen_url"],
    ]);
  });

  test("a URL that carries a secret pattern keeps asking", async () => {
    const asker = fakeAsker("deny");
    const world = makeWorld({
      hosts: HOSTS,
      asker,
      policy: { allow: [], unseenUrl: "ask" },
      approvalCover: cover,
    });
    const result = await world.access.authorize(
      `https://new.example/a?k=${awsLikeKey}`,
      world.context({ threadId: covered, caller: MODEL }),
    );
    expect(result.ok).toBe(false);
    expect(asker.requests.map((request) => request.reasons)).toEqual([
      ["policy_ask", "unseen_url", "secret_pattern"],
    ]);
  });

  test("a domain deny rule and unseenUrl deny still refuse", async () => {
    const asker = fakeAsker("allow");
    const denied = makeWorld({
      hosts: HOSTS,
      asker,
      policy: { allow: ["*"], deny: ["blocked.example"] },
      approvalCover: cover,
    });
    const byRule = await denied.access.authorize(
      "https://blocked.example/a",
      denied.context({ threadId: covered, caller: MODEL }),
    );
    expect(byRule.ok).toBe(false);
    if (!byRule.ok) expect(reasonOfFailure(byRule.error)).toBe("domain_denied");

    const unseen = makeWorld({
      hosts: HOSTS,
      asker,
      policy: { unseenUrl: "deny" },
      approvalCover: cover,
    });
    const byUnseen = await unseen.access.authorize(
      "https://new.example/a",
      unseen.context({ threadId: covered, caller: MODEL }),
    );
    expect(byUnseen.ok).toBe(false);
    if (!byUnseen.ok) expect(reasonOfFailure(byUnseen.error)).toBe("unseen_url");
    expect(asker.requests).toEqual([]);
  });
});
