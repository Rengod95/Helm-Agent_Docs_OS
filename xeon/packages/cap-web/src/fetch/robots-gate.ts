import type { Clock } from "@xeon/contracts";
import type { Access, AccessContext } from "../policy/access.ts";
import type { ContentHttp } from "../policy/content-http.ts";
import { createRobotsChecker, type RobotsChecker } from "../policy/robots.ts";

// L2.web.spec §4.7. robots.txt를 같은 호스트에서 가져와 검사기에 넘긴다. 호스트 이름은 이미 승인된 호스트라
// 도메인 deny와 주소 판정만 다시 한다(`authorizeHop`).

const ROBOTS_TIMEOUT_MS = 10_000;
const ROBOTS_MAX_BYTES = 512 * 1024;

export function createRobotsGate(deps: {
  readonly access: Access;
  readonly content: ContentHttp;
  readonly clock: Clock;
  readonly userAgent: string;
}): RobotsChecker {
  return createRobotsChecker(async (origin, signal) => {
    const ctx: AccessContext = {
      threadId: undefined,
      caller: { kind: "host" },
      capability: "web.fetch",
      askKey: "robots",
      signal,
    };
    const target = await deps.access.authorizeHop(`${origin}/robots.txt`, ctx, {
      resolveDns: true,
    });
    if (!target.ok) return { kind: "failed" };
    const got = await deps.content.get(
      target.value,
      {
        headers: { accept: "text/plain, */*;q=0.1", "user-agent": deps.userAgent },
        timeoutMs: ROBOTS_TIMEOUT_MS,
        maxBytes: ROBOTS_MAX_BYTES,
      },
      ctx,
    );
    if (!got.ok || got.value.kind !== "response") return { kind: "failed" };
    return {
      kind: "response",
      status: got.value.response.status,
      body: new TextDecoder().decode(got.value.response.body),
    };
  }, deps.clock);
}
