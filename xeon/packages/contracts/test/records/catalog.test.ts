import { describe, expect, test } from "bun:test";
import { Bug, parse } from "../../src/index.ts";
import {
  CORE_EVENT_CATALOG,
  CORE_EVENT_KINDS,
  DIALOG_EVENT_CATALOG,
  EVENT_CATALOG,
  WORK_EVENT_CATALOG,
  ItemRecordedPayloadSchema,
  PostAcceptedPayloadSchema,
  ScopeChangedPayloadSchema,
  LeaseReleasedPayloadSchema,
  LeafMovedPayloadSchema,
  CompactedPayloadSchema,
  BranchSummarizedPayloadSchema,
  PartRecordedPayloadSchema,
  SettingsChangedPayloadSchema,
  ApprovalRequestedPayloadSchema,
  ApprovalResolvedPayloadSchema,
  BLOB_PLACEHOLDER_PREFIX,
  catalogEntry,
  mergeCatalogs,
  type CatalogEntry,
  type CoreEventKind,
} from "../../src/records/index.ts";
import { rawId } from "../helpers/ids.ts";
import { EVENT, ITEM, PAYLOAD_FIXTURES, SHA, THREAD, partRecord } from "./fixtures/payloads.ts";

function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("core catalog", () => {
  test("has the 40 kinds of the spec table, each at version 1", () => {
    expect(CORE_EVENT_CATALOG.length).toBe(40);
    expect(CORE_EVENT_KINDS.length).toBe(40);
    expect(CORE_EVENT_CATALOG.map((e) => e.kind)).toEqual([...CORE_EVENT_KINDS]);
    for (const entry of CORE_EVENT_CATALOG) expect(entry.version).toBe(1);
  });

  test("kinds are unique and the merged catalog adds no duplicates", () => {
    expect(new Set(CORE_EVENT_CATALOG.map((e) => e.kind)).size).toBe(40);
    // 코어 40종에 내장 L2 도메인 카탈로그(work 10종, dialog 2종)가 이어 붙는다
    expect(EVENT_CATALOG.length).toBe(40 + WORK_EVENT_CATALOG.length + DIALOG_EVENT_CATALOG.length);
    expect(new Set(EVENT_CATALOG.map((e) => e.kind)).size).toBe(EVENT_CATALOG.length);
    expect(EVENT_CATALOG.slice(0, 40)).toEqual([...CORE_EVENT_CATALOG]);
    const entry = CORE_EVENT_CATALOG[0];
    expect(entry).toBeDefined();
    if (entry !== undefined) {
      expect(() => mergeCatalogs(CORE_EVENT_CATALOG, [entry])).toThrow(Bug);
    }
  });

  test("volatile kinds are exactly the five progress/notice kinds", () => {
    const volatile: string[] = CORE_EVENT_CATALOG.filter((e) => !e.durable).map((e) => e.kind);
    expect(volatile.toSorted()).toEqual(
      [
        "item.started",
        "item.updated",
        "scope.handler_failed",
        "step.updated",
        "turn.updated",
      ].toSorted(),
    );
  });

  test("catalogEntry looks up by kind", () => {
    expect(catalogEntry("effect.result").durable).toBe(true);
    expect(catalogEntry("item.updated").durable).toBe(false);
  });
});

describe("payload round trip (acceptance 9)", () => {
  for (const kind of CORE_EVENT_KINDS) {
    test(kind, () => {
      const fixture = PAYLOAD_FIXTURES[kind];
      const result = parse(catalogEntry(kind).payload, roundTrip(fixture));
      if (!result.ok) throw new Error(JSON.stringify(result.error.issues));
      expect(result.ok).toBe(true);
    });
  }

  test("every catalog kind has a fixture and every fixture a kind", () => {
    expect(Object.keys(PAYLOAD_FIXTURES).toSorted()).toEqual([...CORE_EVENT_KINDS].toSorted());
  });
});

function rejects(entry: CatalogEntry, value: unknown): void {
  expect(parse(entry.payload, value).ok).toBe(false);
}

function fixture(kind: CoreEventKind): Record<string, unknown> {
  return { ...PAYLOAD_FIXTURES[kind] };
}

describe("new payload rejections", () => {
  test("LeafMoved: missing field, bad reason, bad id prefix", () => {
    const entry = catalogEntry("thread.leaf_moved");
    rejects(entry, { reason: "branch" });
    rejects(entry, { ...fixture("thread.leaf_moved"), reason: "expired" });
    rejects(entry, { ...fixture("thread.leaf_moved"), leafEventId: THREAD });
    expect(parse(LeafMovedPayloadSchema, fixture("thread.leaf_moved")).ok).toBe(true);
  });

  test("Compacted and BranchSummarized", () => {
    rejects(catalogEntry("thread.compacted"), { ...fixture("thread.compacted"), tokensBefore: -1 });
    rejects(catalogEntry("thread.compacted"), { summary: "x" });
    rejects(catalogEntry("thread.branch_summarized"), {
      fromEventId: "evt_bad",
      summary: "s",
      details: null,
      usage: null,
    });
    expect(parse(CompactedPayloadSchema, fixture("thread.compacted")).ok).toBe(true);
    expect(parse(BranchSummarizedPayloadSchema, fixture("thread.branch_summarized")).ok).toBe(true);
  });

  test("ItemRecorded and PartRecorded", () => {
    rejects(catalogEntry("item.recorded"), {});
    rejects(catalogEntry("part.recorded"), { part: { ...partRecord, partId: ITEM } });
    expect(parse(ItemRecordedPayloadSchema, fixture("item.recorded")).ok).toBe(true);
    expect(parse(PartRecordedPayloadSchema, fixture("part.recorded")).ok).toBe(true);
  });

  test("ScopeChanged: status and reason enums", () => {
    const entry = catalogEntry("scope.changed");
    rejects(entry, { ...fixture("scope.changed"), status: "entered" });
    rejects(entry, { ...fixture("scope.changed"), reason: "later" });
    rejects(entry, { status: "enabled" });
    expect(parse(ScopeChangedPayloadSchema, { scopeId: "helm", status: "disabled" }).ok).toBe(true);
  });

  test("LeaseAcquired / LeaseReleased", () => {
    rejects(catalogEntry("lease.released"), { ...fixture("lease.released"), reason: "expired" });
    rejects(catalogEntry("lease.acquired"), { leaseId: "l", scopeId: "helm" });
    expect(parse(LeaseReleasedPayloadSchema, fixture("lease.released")).ok).toBe(true);
  });

  test("post.accepted is retired and is the only retired core kind", () => {
    expect(CORE_EVENT_CATALOG.filter((e) => e.retired === true).map((e) => e.kind)).toEqual([
      "post.accepted",
    ]);
  });

  test("PostAccepted schema still reads old rows: inputId and a valid when", () => {
    const entry = catalogEntry("post.accepted");
    const { inputId: _inputId, ...withoutInput } = fixture("post.accepted");
    rejects(entry, withoutInput);
    rejects(entry, { ...fixture("post.accepted"), when: "later" });
    rejects(entry, { ...fixture("post.accepted"), inputId: rawId("itm", 9) });
    expect(parse(PostAcceptedPayloadSchema, fixture("post.accepted")).ok).toBe(true);
  });

  test("SettingsChanged accepts all five scopes", () => {
    for (const scope of ["managed", "user", "project", "local", "session"]) {
      expect(
        parse(SettingsChangedPayloadSchema, { key: "l1.loop.maxSteps", scope, value: null }).ok,
      ).toBe(true);
    }
    rejects(catalogEntry("settings.changed"), { key: "l1.loop.maxSteps" });
  });
});

describe("requested kinds (F.records.spec 3.3.1)", () => {
  test("secret payloads carry no value field", () => {
    for (const kind of [
      "secret.used",
      "secret.denied",
      "secret.approved",
      "secret.masked",
    ] as const) {
      const entry = catalogEntry(kind);
      expect(parse(entry.payload, { ...PAYLOAD_FIXTURES[kind], value: "s3cret" }).ok).toBe(false);
      if (kind !== "secret.masked") {
        expect(parse(entry.payload, { ...PAYLOAD_FIXTURES[kind], handle: "plain-name" }).ok).toBe(
          false,
        );
      }
    }
  });

  test("approval.requested body kinds are tool, question, plan only", () => {
    const base = PAYLOAD_FIXTURES["approval.requested"];
    const question = {
      kind: "question",
      question: {
        questions: [
          {
            id: "q1",
            text: "Which?",
            options: [{ id: "a", label: "A" }],
            multiSelect: false,
            allowFreeText: true,
          },
        ],
      },
    };
    const plan = {
      kind: "plan",
      plan: { plan: "do things", planRef: null, nextModes: ["default"] },
    };
    expect(parse(ApprovalRequestedPayloadSchema, { ...base, body: question }).ok).toBe(true);
    expect(parse(ApprovalRequestedPayloadSchema, { ...base, body: plan }).ok).toBe(true);
    expect(parse(ApprovalRequestedPayloadSchema, { ...base, body: { kind: "other" } }).ok).toBe(
      false,
    );
    expect(
      parse(ApprovalRequestedPayloadSchema, {
        ...base,
        body: { kind: "question", question: { questions: [] } },
      }).ok,
    ).toBe(false);
  });

  test("approval.requested carries an optional expiry that old records do not have", () => {
    const base = PAYLOAD_FIXTURES["approval.requested"];
    // 만료 필드가 생기기 전에 기록된 요청도 그대로 읽힌다
    const old = parse(ApprovalRequestedPayloadSchema, base);
    expect(old.ok).toBe(true);
    if (old.ok) {
      expect(old.value.expiresAt).toBeUndefined();
      expect(old.value.onExpire).toBeUndefined();
    }
    const deny = { ...base, expiresAt: 1_790_000_060_000, onExpire: { decision: "deny" } };
    const answer = {
      ...base,
      expiresAt: 1_790_000_060_000,
      onExpire: { decision: "answer", answer: { q1: { selected: ["a"] } } },
    };
    const parsed = parse(ApprovalRequestedPayloadSchema, answer);
    expect(parsed.ok && parsed.value.onExpire).toEqual({
      decision: "answer",
      answer: { q1: { selected: ["a"] } },
    });
    expect(parse(ApprovalRequestedPayloadSchema, deny).ok).toBe(true);
    expect(parse(ApprovalRequestedPayloadSchema, { ...base, expiresAt: 1.5 }).ok).toBe(false);
    expect(parse(ApprovalRequestedPayloadSchema, { ...base, expiresAt: -1 }).ok).toBe(false);
    // allow는 만료로 정할 수 없다. 응답 없는 요청이 허용으로 끝나면 안 된다
    expect(
      parse(ApprovalRequestedPayloadSchema, {
        ...base,
        expiresAt: 1,
        onExpire: { decision: "allow" },
      }).ok,
    ).toBe(false);
    expect(
      parse(ApprovalRequestedPayloadSchema, {
        ...base,
        expiresAt: 1,
        onExpire: { decision: "answer" },
      }).ok,
    ).toBe(false);
  });

  test("approval.resolved names an expiry as its resolver", () => {
    const base = PAYLOAD_FIXTURES["approval.resolved"];
    expect(parse(ApprovalResolvedPayloadSchema, { ...base, resolvedBy: "expired" }).ok).toBe(true);
    expect(parse(ApprovalResolvedPayloadSchema, { ...base, resolvedBy: "timeout" }).ok).toBe(false);
    for (const resolvedBy of ["user", "noninteractive", "cancelled", "superseded"]) {
      expect(parse(ApprovalResolvedPayloadSchema, { ...base, resolvedBy }).ok).toBe(true);
    }
  });

  test("input.queued accepts context items and every source", () => {
    const entry = catalogEntry("input.queued");
    const context = {
      kind: "context",
      customType: "grp.helm.item.tagged",
      content: "x",
      display: true,
      details: null,
    };
    const sources: unknown[] = [
      { type: "user", via: "rpc" },
      { type: "extension", scopeId: "helm" },
      { type: "delegation", childThreadId: rawId("thr", 3) },
      { type: "schedule", timerId: "tmr_1" },
    ];
    for (const source of sources) {
      expect(
        parse(entry.payload, { mode: "steer", item: context, requestId: "r", source }).ok,
      ).toBe(true);
    }
    expect(
      parse(entry.payload, { mode: "later", item: context, requestId: "r", source: sources[0] }).ok,
    ).toBe(false);
  });

  test("agent payloads", () => {
    const spawned = PAYLOAD_FIXTURES["agent.spawned"];
    const owners: unknown[] = [
      { kind: "drive", turnId: null, scopeId: "helm", leaseId: "l1" },
      { kind: "scope", scopeId: "helm" },
    ];
    for (const owner of owners) {
      expect(parse(catalogEntry("agent.spawned").payload, { ...spawned, owner }).ok).toBe(true);
    }
    expect(
      parse(catalogEntry("agent.spawned").payload, {
        ...spawned,
        fork: { at: "event", eventId: EVENT },
      }).ok,
    ).toBe(true);
    expect(
      parse(catalogEntry("agent.judged").payload, {
        ...PAYLOAD_FIXTURES["agent.judged"],
        verdict: "maybe",
      }).ok,
    ).toBe(false);
    expect(
      parse(catalogEntry("agent.settled").payload, {
        ...PAYLOAD_FIXTURES["agent.settled"],
        status: "ok",
      }).ok,
    ).toBe(false);
  });
});

describe("blob placeholders", () => {
  test("the prefix is blob:sha256:", () => {
    expect(BLOB_PLACEHOLDER_PREFIX).toBe("blob:sha256:");
  });

  test("an image data replaced by a placeholder still passes the item payload schema", () => {
    const withImage = {
      item: {
        itemId: ITEM,
        status: "completed",
        kind: "user",
        message: {
          role: "user",
          content: [
            { type: "image", data: `${BLOB_PLACEHOLDER_PREFIX}${SHA}`, mimeType: "image/png" },
          ],
          timestamp: 1,
        },
        requestId: null,
      },
    };
    expect(parse(ItemRecordedPayloadSchema, withImage).ok).toBe(true);
  });
});
