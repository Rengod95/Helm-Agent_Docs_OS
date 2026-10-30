import { expect, test } from "bun:test";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import type { ResourceRecord, ResourceRegistry } from "@xeon/ext-host";
import { onWebSessionShutdown, webRegistrationSource } from "../../src/assembly/cap-web.ts";

// M3-REQ-37 (등록 목록 연결)과 세션 종료 때 브라우저 세션 닫기(L2.web.spec §4.10.1). 가짜 기록과 가짜 런타임으로 값을 본다.

const THREAD_A = fixedIdFactory(901).next("thr");
const THREAD_B = fixedIdFactory(902).next("thr");

function record(overrides: Partial<ResourceRecord>): ResourceRecord {
  return {
    kind: "web_provider",
    name: "web.search",
    exposed: "web.search",
    scopeId: "scope-web-bridge",
    extension: "exa",
    builtin: false,
    def: { capability: "web.search", create: () => undefined },
    ...overrides,
  };
}

/** 종류별 필터만 흉내 낸다. `list`는 `ResourceRegistry`의 나머지 면이 필요 없어서 이 부분만 둔다 */
function fakeResources(records: readonly ResourceRecord[]): Pick<ResourceRegistry, "list"> {
  return {
    list: (kind) => records.filter((entry) => kind === undefined || entry.kind === kind),
  };
}

test("the registration source lists exactly the valid web_provider records, under their extension names", () => {
  const valid = record({ extension: "exa" });
  const noCreate = record({ extension: "bad-no-create", def: { capability: "web.search" } });
  const unknownCapability = record({
    extension: "bad-capability",
    def: { capability: "web.nope", create: () => undefined },
  });
  const otherKind = record({ kind: "tool", extension: "tool-kind", def: valid.def });
  const source = webRegistrationSource(() =>
    fakeResources([noCreate, unknownCapability, otherKind, valid]),
  );

  const listed = source.list();
  expect(listed.map((entry) => entry.extension)).toEqual(["exa"]);
  // 등록 값은 기록의 `def` 그대로다(같은 객체)
  expect(listed[0]?.registration === valid.def).toBe(true);
});

test("with no resource registry the source lists nothing", () => {
  expect(webRegistrationSource(() => undefined).list()).toEqual([]);
});

test("a conversation that ends closes its browser sessions and purges the raw rows of the threads still held", async () => {
  const closed: string[] = [];
  const purged: string[][] = [];
  const runtime = {
    browse: {
      closeThread: (threadId: string | undefined) => {
        closed.push(String(threadId));
        return Promise.resolve();
      },
    },
    purgeSessionRaw: (live: ReadonlySet<string>) => {
      purged.push([...live].toSorted());
      return 0;
    },
  };
  await onWebSessionShutdown(runtime, [THREAD_A, THREAD_B], THREAD_B);
  expect(closed).toEqual([THREAD_B]);
  // 끝나는 대화(B)는 살아 있는 목록에서 뺀다. 아직 쥔 A만 원문을 남긴다
  expect(purged).toEqual([[THREAD_A]]);
});
