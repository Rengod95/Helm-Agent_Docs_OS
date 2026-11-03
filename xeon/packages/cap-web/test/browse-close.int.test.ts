import { afterEach, describe, expect, test } from "bun:test";
import type { Logger } from "@fresnel/contracts";
import { CapabilityError, type CallOptions } from "@fresnel/contracts/capabilities";
import { directConvertRunner } from "../src/fetch/convert-runner.ts";
import { createWebRuntime, type WebRuntime } from "../src/runtime.ts";
import { DEFAULT_WEB_SETTINGS } from "../src/settings.ts";
import {
  browseCandidate,
  fakeBrowseProvider,
  type FakeBrowseProvider,
} from "../src/testing/fake-browser.ts";
import { fakeSessionSources } from "../src/testing/fake-ports.ts";
import { fakeResolver } from "../src/testing/fake-resolver.ts";
import { fixtureTransport } from "../src/testing/http-fixtures.ts";
import { manualClock, type ManualClock } from "./support/clock.ts";
import { fixedLocalIds, threadIdOf } from "./support/ids.ts";

// 브라우저 세션 닫기를 조립(`createWebRuntime`) 그대로 시험한다(L2.web.spec §3.4 close, §4.10.1, §5 browse.close 멱등).
// provider는 가짜 브라우저(`testing/fake-browser.ts`)다. 시험은 공개 메서드(`service.browse`)의 반환값과 provider 기록으로 판정한다.

const SILENT: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => SILENT,
};

const CALL: CallOptions = {
  requestId: "req-browse-close",
  context: { threadId: threadIdOf(1), caller: { kind: "host" } },
};

const runtimes: WebRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
});

function runtimeWith(local: FakeBrowseProvider): { runtime: WebRuntime; clock: ManualClock } {
  const clock = manualClock();
  const runtime = createWebRuntime({
    clock,
    ids: fixedLocalIds(),
    logger: SILENT,
    settings: () => DEFAULT_WEB_SETTINGS,
    sessionSources: fakeSessionSources(),
    resolver: fakeResolver({}),
    transport: fixtureTransport(),
    convert: directConvertRunner(),
    builtinSearch: false,
    builtin: { search: [], fetch: [], browse: [browseCandidate(local, "builtin")] },
  });
  runtimes.push(runtime);
  return { runtime, clock };
}

async function rejectionOf(promise: Promise<unknown>): Promise<CapabilityError> {
  const caught = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(caught instanceof CapabilityError)) throw new Error("expected a CapabilityError");
  return caught;
}

describe("web.browse close through the assembled runtime", () => {
  test("close ends the session: the provider closes once, and a later act or read is not_found", async () => {
    const local = fakeBrowseProvider("local-browser");
    const { runtime, clock } = runtimeWith(local);
    const browse = runtime.service.browse;
    const { sessionId } = await browse.open({}, CALL);
    await browse.act({ sessionId, action: "wait" }, CALL);
    clock.advance(90_000);

    const closed = await browse.close({ sessionId }, CALL);
    expect(closed).toEqual({ closed: true, stats: { actions: 1, seconds: 90, usd: 0 } });
    expect(local.closed()).toBe(1);
    expect(runtime.browse.openCount()).toBe(0);

    // 닫힌 세션의 동작과 읽기는 not_found다. 재시도할 수 없고(retryable 거짓), provider에 가지 않는다
    const acted = await rejectionOf(browse.act({ sessionId, action: "wait" }, CALL));
    expect(acted.data).toMatchObject({
      capability: "web.browse",
      method: "act",
      code: "not_found",
      retryable: false,
    });
    const read = await rejectionOf(browse.read({ sessionId, mode: "text" }, CALL));
    expect(read.data).toMatchObject({
      capability: "web.browse",
      method: "read",
      code: "not_found",
      retryable: false,
    });
    expect(local.log).toEqual(["wait"]);
    expect(local.closed()).toBe(1);
  });

  test("closing again is idempotent: closed is false and the provider is not closed a second time", async () => {
    const local = fakeBrowseProvider("local-browser");
    const { runtime } = runtimeWith(local);
    const browse = runtime.service.browse;
    const { sessionId } = await browse.open({}, CALL);

    const first = await browse.close({ sessionId }, CALL);
    expect(first.closed).toBe(true);
    const second = await browse.close({ sessionId }, CALL);
    expect(second.closed).toBe(false);
    expect(local.closed()).toBe(1);
    expect(runtime.browse.openCount()).toBe(0);
  });
});
