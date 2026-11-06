import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { validateManifest } from "@fresnel/contracts/extensions";
import { helmManifest } from "../../src/index.ts";
import { helmMethodDecls } from "../../src/methods.ts";
import { InquiryFinishedPayloadSchema, type InquiryFinishedPayload } from "../../src/records.ts";
import { HelmStateSchema, type HelmState } from "../../src/state.ts";
import { createRig, type Rig } from "../support/rig.ts";

// 확장 메서드 status, inquiries, findings를 실제 호스트의 wire 경로(methods.call)로 부른다.
// 결과 검사(result_invalid)를 같이 거치므로 "ok"가 나오면 결과 스키마와 맞는 것이다.

const SIGNAL = new AbortController().signal;

function call(rig: Rig, verb: string, params: unknown, threadId: ThreadId | null = rig.thread) {
  return rig.t.host.methods.call({
    extension: "helm",
    verb,
    params,
    threadId,
    signal: SIGNAL,
    caller: "wire",
  });
}

/** 마지막으로 커밋된 Helm 상태. 기록의 doc을 스키마로 다시 검사한다 */
function committedOf(rig: Rig): HelmState {
  const states = rig.t.records
    .events(rig.thread)
    .filter((event) => event.kind === "grp.helm.state.committed")
    .flatMap((event) => {
      const payload: unknown = event.payload;
      if (typeof payload !== "object" || payload === null || !("doc" in payload)) return [];
      const checked = parse(HelmStateSchema, payload.doc);
      return checked.ok ? [checked.value] : [];
    });
  const last = states.at(-1);
  if (last === undefined) throw new Error("no committed helm state");
  return last;
}

/** 시험 웹 출처 하나. 발견 문장마다 URL이 문장으로 정해진다(rig.ts report()와 같은 규칙) */
function sourceOf(claim: string): { readonly origin: string; readonly ref: string } {
  return { origin: "web", ref: `https://example.test/${encodeURIComponent(claim)}` };
}

/** 끝난 탐구 기록 하나(시험은 탐구를 하나만 끝낸다) */
function finishedOf(rig: Rig): InquiryFinishedPayload {
  const checked = parse(InquiryFinishedPayloadSchema, rig.records("grp.helm.inquiry.finished")[0]);
  if (!checked.ok) throw new Error("the inquiry.finished record does not match its schema");
  return checked.value;
}

test("methods.decl: three read-only methods, declared in the manifest", () => {
  expect(helmManifest.methods).toEqual(helmMethodDecls);
  expect(helmMethodDecls.map((decl) => [decl.verb, decl.readOnly])).toEqual([
    ["status", true],
    ["inquiries", true],
    ["findings", true],
  ]);
  expect(
    validateManifest(helmManifest).issues.filter((issue) => issue.severity === "error"),
  ).toEqual([]);
});

test("status: a requested inquiry that is not leased yet shows its pending id, topic and a waiting lease", async () => {
  const rig = await createRig();
  await rig.command("start 캐시 무효화");
  const pending = committedOf(rig).pending;
  if (pending === null) throw new Error("the start command did not leave a pending request");
  expect(await call(rig, "status", {})).toEqual({
    kind: "ok",
    value: {
      enabled: true,
      phase: "idle",
      inquiryId: pending.inquiryId,
      topic: "캐시 무효화",
      lenses: [],
      findings: 0,
      lease: "waiting",
    },
  });
});

test("status: during the lens run every lens is running and the lease is held", async () => {
  const seen: unknown[] = [];
  const holder: { rig?: Rig; armed: boolean } = { armed: true };
  const rig = await createRig({
    onSpawn: async () => {
      // 렌즈 세 개가 동시에 떠서 hook이 세 번 불린다. 첫 호출만 잡도록 표지를 동기로 내린다
      const target = holder.rig;
      if (target === undefined || !holder.armed) return;
      holder.armed = false;
      seen.push(await call(target, "status", {}));
    },
  });
  holder.rig = rig;
  await rig.runInquiry("캐시 무효화");
  const finished = finishedOf(rig);
  expect(seen).toEqual([
    {
      kind: "ok",
      value: {
        enabled: true,
        phase: "explore",
        inquiryId: finished.inquiryId,
        topic: "캐시 무효화",
        lenses: [
          { id: "analogy", title: "다른 분야의 유사 문제", status: "running" },
          { id: "prior-art", title: "선행 사례와 문헌", status: "running" },
          { id: "first-principles", title: "기본 원리로 다시 보기", status: "running" },
        ],
        findings: 0,
        lease: "held",
      },
    },
  ]);
});

test("status: after the inquiry ends the view is the idle default again", async () => {
  const rig = await createRig();
  await rig.runInquiry("캐시 무효화");
  expect(await call(rig, "status", {})).toEqual({
    kind: "ok",
    value: {
      enabled: true,
      phase: "idle",
      inquiryId: null,
      topic: null,
      lenses: [],
      findings: 0,
      lease: "none",
    },
  });
});

test("inquiries: a finished inquiry lists its id, topic, outcome and finding count from the finished record", async () => {
  const rig = await createRig();
  await rig.runInquiry("캐시 무효화");
  const finished = finishedOf(rig);
  expect(await call(rig, "inquiries", {})).toEqual({
    kind: "ok",
    value: {
      inquiries: [
        {
          inquiryId: finished.inquiryId,
          topic: "캐시 무효화",
          status: "finished",
          outcome: "applied",
          findingCount: 3,
        },
      ],
    },
  });
});

test("inquiries: the pending request leads, then the finished inquiries newest first", async () => {
  const rig = await createRig();
  await rig.runInquiry("첫 주제");
  await rig.runInquiry("둘째 주제");
  await rig.command("start 셋째 주제");
  const pending = committedOf(rig).pending;
  if (pending === null) throw new Error("the start command did not leave a pending request");
  const listed = await call(rig, "inquiries", {});
  const finished = rig
    .records("grp.helm.inquiry.finished")
    .map((record) => parse(InquiryFinishedPayloadSchema, record))
    .flatMap((checked) => (checked.ok ? [checked.value] : []));
  expect(finished.map((record) => record.topic)).toEqual(["첫 주제", "둘째 주제"]);
  expect(listed).toEqual({
    kind: "ok",
    value: {
      inquiries: [
        {
          inquiryId: pending.inquiryId,
          topic: "셋째 주제",
          status: "pending",
          outcome: null,
          findingCount: 0,
        },
        {
          inquiryId: finished[1]?.inquiryId,
          topic: "둘째 주제",
          status: "finished",
          outcome: "applied",
          findingCount: 3,
        },
        {
          inquiryId: finished[0]?.inquiryId,
          topic: "첫 주제",
          status: "finished",
          outcome: "applied",
          findingCount: 3,
        },
      ],
    },
  });
});

test("findings: a finished inquiry lists its discovery records in recorded order, without followUp", async () => {
  const rig = await createRig();
  await rig.runInquiry("캐시 무효화");
  const inquiryId = finishedOf(rig).inquiryId;
  expect(await call(rig, "findings", { inquiryId })).toEqual({
    kind: "ok",
    value: {
      inquiryId,
      findings: [
        {
          id: "analogy-1",
          lensId: "analogy",
          claim: "면역 기억을 닮은 재검증",
          sources: [sourceOf("면역 기억을 닮은 재검증")],
          confidence: "medium",
        },
        {
          id: "prior-art-1",
          lensId: "prior-art",
          claim: "선행 사례: 버전 태그 캐시",
          sources: [sourceOf("선행 사례: 버전 태그 캐시")],
          confidence: "medium",
        },
        {
          id: "first-principles-1",
          lensId: "first-principles",
          claim: "전제: 무효화는 일관성 비용이다",
          sources: [sourceOf("전제: 무효화는 일관성 비용이다")],
          confidence: "medium",
        },
      ],
    },
  });
});

test("findings: the current inquiry at the apply turn comes from the committed state, with followUp", async () => {
  const seen: unknown[] = [];
  const holder: { rig?: Rig } = {};
  const rig = await createRig({
    onTurn: async (request) => {
      const target = holder.rig;
      if (target === undefined || !request.requestId.includes(":turn:apply:")) return;
      const inquiryId = committedOf(target).inquiryId;
      if (inquiryId === null) throw new Error("the apply turn runs without an inquiry id");
      seen.push(await call(target, "findings", { inquiryId }));
    },
  });
  holder.rig = rig;
  await rig.runInquiry("캐시 무효화");
  const inquiryId = finishedOf(rig).inquiryId;
  expect(seen).toEqual([
    {
      kind: "ok",
      value: {
        inquiryId,
        findings: [
          {
            id: "analogy-1",
            lensId: "analogy",
            claim: "면역 기억을 닮은 재검증",
            sources: [
              {
                origin: "web",
                ref: `https://example.test/${encodeURIComponent("면역 기억을 닮은 재검증")}`,
              },
            ],
            confidence: "medium",
            followUp: "재검증 정책 초안 쓰기",
          },
          {
            id: "prior-art-1",
            lensId: "prior-art",
            claim: "선행 사례: 버전 태그 캐시",
            sources: [
              {
                origin: "web",
                ref: `https://example.test/${encodeURIComponent("선행 사례: 버전 태그 캐시")}`,
              },
            ],
            confidence: "medium",
            followUp: "버전 태그 사례 정리",
          },
          {
            id: "first-principles-1",
            lensId: "first-principles",
            claim: "전제: 무효화는 일관성 비용이다",
            sources: [
              {
                origin: "web",
                ref: `https://example.test/${encodeURIComponent("전제: 무효화는 일관성 비용이다")}`,
              },
            ],
            confidence: "medium",
          },
        ],
      },
    },
  ]);
});

test("findings: an unknown inquiry id gives an empty list, not an error", async () => {
  const rig = await createRig();
  await rig.runInquiry("캐시 무효화");
  expect(await call(rig, "findings", { inquiryId: "haaaaaaaaaaaaa" })).toEqual({
    kind: "ok",
    value: { inquiryId: "haaaaaaaaaaaaa", findings: [] },
  });
});

test("params: a shape the schema refuses is params_invalid and the handler does not run", async () => {
  const rig = await createRig();
  await rig.runInquiry("캐시 무효화");
  const before = rig.t.loop.turns.length + rig.t.loop.spawns.length;
  const outcomes = [
    await call(rig, "status", { extra: 1 }),
    await call(rig, "inquiries", { limit: 5 }),
    await call(rig, "findings", {}),
    await call(rig, "findings", { inquiryId: "not-an-id" }),
    await call(rig, "findings", { inquiryId: "haaaaaaaaaaaaa", extra: true }),
  ];
  expect(outcomes.map((outcome) => outcome.kind)).toEqual([
    "params_invalid",
    "params_invalid",
    "params_invalid",
    "params_invalid",
    "params_invalid",
  ]);
  expect(rig.t.loop.turns.length + rig.t.loop.spawns.length).toBe(before);
});

test("threadless calls: without a thread the handlers give the idle defaults and touch no state", async () => {
  const rig = await createRig();
  await rig.runInquiry("캐시 무효화");
  const inquiryId = finishedOf(rig).inquiryId;
  expect(await call(rig, "status", {}, null)).toEqual({
    kind: "ok",
    value: {
      enabled: true,
      phase: "idle",
      inquiryId: null,
      topic: null,
      lenses: [],
      findings: 0,
      lease: "none",
    },
  });
  expect(await call(rig, "inquiries", {}, null)).toEqual({ kind: "ok", value: { inquiries: [] } });
  expect(await call(rig, "findings", { inquiryId }, null)).toEqual({
    kind: "ok",
    value: { inquiryId, findings: [] },
  });
});

test("result check: every method result passes the declared result schema in each state", async () => {
  const rig = await createRig();
  const idle = [
    await call(rig, "status", {}),
    await call(rig, "inquiries", {}),
    await call(rig, "findings", { inquiryId: "haaaaaaaaaaaaa" }),
  ];
  await rig.command("start 캐시 무효화");
  const waiting = [await call(rig, "status", {}), await call(rig, "inquiries", {})];
  await rig.drain();
  const finished = [await call(rig, "status", {}), await call(rig, "inquiries", {})];
  expect([...idle, ...waiting, ...finished].map((outcome) => outcome.kind)).toEqual([
    "ok",
    "ok",
    "ok",
    "ok",
    "ok",
    "ok",
    "ok",
  ]);
});

test("closed-thread: calls bound to a thread that is no longer open answer like a call without a thread", async () => {
  const rig = await createRig();
  await rig.command("start 캐시 무효화");
  await rig.drain();
  await rig.t.host.closeThread(rig.thread);
  const idle = {
    enabled: true,
    phase: "idle",
    inquiryId: null,
    topic: null,
    lenses: [],
    findings: 0,
    lease: "none",
  };
  expect(await call(rig, "status", {})).toEqual({ kind: "ok", value: idle });
  expect(await call(rig, "inquiries", {})).toEqual({ kind: "ok", value: { inquiries: [] } });
  expect(await call(rig, "findings", { inquiryId: "hqqqqqqqqqqqqq" })).toMatchObject({
    kind: "ok",
  });
  expect(await call(rig, "status", {}, rig.t.newThread())).toEqual({ kind: "ok", value: idle });
});
