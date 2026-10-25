import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { ok, parse, type Result } from "../../src/base/index.ts";
import {
  EventIdSchema,
  ThreadIdSchema,
  type JsonValue,
  type ThreadId,
} from "../../src/conversation/index.ts";
import {
  COMMIT_KEY_PATTERN,
  MAX_REPLAY_ATTEMPTS,
  APPROVAL_REQUEST_KEY_MAX,
  ApprovalRequestedPayloadSchema,
  RESERVED_SOURCE_KEYS,
  commitKeyPart,
  isApprovalRequestKey,
  requestKeyFor,
  ownerOfKind,
  type DurableEventDraft,
  type ExtCommitRequest,
  type ExtCommitResult,
  type ExtRecordQuery,
  type ExtRecordRow,
  type ReadFailure,
  type ExtThreadSnapshot,
  type ExtensionEventKind,
  type RecordCommitPort,
} from "../../src/records/index.ts";
import { L2_APPROVAL_REQUEST_ID_MAX } from "../../src/services/index.ts";
import { must, rawId } from "../helpers/ids.ts";
import { PAYLOAD_FIXTURES } from "./fixtures/payloads.ts";

const THREAD_ID = must(ThreadIdSchema, rawId("thr", 1));

let counter = 0;

function draftOf(kind: ExtensionEventKind): DurableEventDraft {
  counter += 1;
  return {
    id: must(EventIdSchema, rawId("evt", counter)),
    kind,
    version: 1,
    threadId: THREAD_ID,
    turnId: null,
    stepId: null,
    causationId: null,
    correlationId: null,
    payload: { n: counter },
    durable: true,
  };
}

interface StoredRow {
  readonly row: ExtRecordRow;
  readonly privateOwner: string | null;
}

/**
 * 테스트용 가짜 RecordCommitPort. 비공개 기록 규칙(F.records.spec §3.9)만 흉내 낸다. 실제 구현은 core-persistence 몫이고
 * L1.persistence.plan이 같은 적합성 사례를 실제 구현에 돌린다.
 */
function isExtensionKind(kind: string): kind is ExtensionEventKind {
  return kind.startsWith("x.") || kind.startsWith("grp.");
}

function fakePort(committer: string): RecordCommitPort {
  const rows: StoredRow[] = [];
  const seen = new Set<string>();
  const none: JsonValue = null;
  const mine = (kind: string): boolean =>
    kind.startsWith(`x.${committer}.`) || kind.startsWith(`grp.${committer}.`);
  return {
    commit(request: ExtCommitRequest): Promise<ExtCommitResult> {
      if (seen.has(request.requestId)) return Promise.resolve({ status: "replayed" });
      const isPrivate = request.visibility === "private";
      if (isPrivate && !request.drafts.every((draft) => mine(draft.kind))) {
        return Promise.resolve({ status: "rejected", code: "invalid" });
      }
      seen.add(request.requestId);
      for (const draft of request.drafts) {
        if (!isExtensionKind(draft.kind)) continue;
        const owner = ownerOfKind(draft.kind)?.replace(/^ext\./, "") ?? "";
        rows.push({
          privateOwner: isPrivate ? owner : null,
          row: {
            groupId: owner,
            kind: draft.kind,
            version: draft.version,
            subject: { type: "thread", id: request.threadId },
            payload: none,
          },
        });
      }
      return Promise.resolve({ status: "committed" });
    },
    loadThread(): Promise<Result<ExtThreadSnapshot, ReadFailure>> {
      return Promise.resolve(
        ok({
          enabled: [],
          disabled: [],
          scopeTransitions: {},
          enabledAtSeq: {},
          states: [],
          openLease: null,
          leaseEpochs: {},
        }),
      );
    },
    queryRecords(_threadId: ThreadId, query: ExtRecordQuery, reader: string) {
      const wildcard = query.kind.endsWith(".*");
      const prefix = wildcard ? query.kind.slice(0, -1) : query.kind;
      return Promise.resolve(
        ok(
          rows
            .filter((r) => (wildcard ? r.row.kind.startsWith(prefix) : r.row.kind === prefix))
            .filter((r) => r.privateOwner === null || r.privateOwner === reader)
            .map((r) => r.row),
        ),
      );
    },
  };
}

function rowsOf(result: Result<readonly ExtRecordRow[], ReadFailure>): readonly ExtRecordRow[] {
  if (!result.ok) throw new Error(`unexpected read failure: ${result.error.kind}`);
  return result.value;
}

function request(
  requestId: string,
  kinds: readonly ExtensionEventKind[],
  visibility?: "public" | "private",
): ExtCommitRequest {
  return {
    threadId: THREAD_ID,
    requestId,
    drafts: kinds.map((kind) => draftOf(kind)),
    ...(visibility === undefined ? {} : { visibility }),
  };
}

describe("commit keys and replay limits", () => {
  test("COMMIT_KEY_PATTERN accepts the documented key shapes", () => {
    const pattern = new RegExp(COMMIT_KEY_PATTERN);
    for (const key of ["tool:call_1:result", "in:user:req-1", "resp:trn_X:3", "a"]) {
      expect(pattern.test(key)).toBe(true);
    }
    for (const key of ["", ":start", "has space", "a/b", "x".repeat(201)]) {
      expect(pattern.test(key)).toBe(false);
    }
    expect(MAX_REPLAY_ATTEMPTS).toBe(2);
  });
});

const fakeHash = (text: string): string =>
  `${text.length.toString(16).padStart(2, "0")}${"ab".repeat(40)}`;

const sha256Hex = (text: string): string => createHash("sha256").update(text).digest("hex");

describe("requestKeyFor (U-13, approval request keys)", () => {
  const KEY_SHAPE = /^[A-Za-z0-9_.-]{1,48}$/;

  test("the limit equals the record schema's requestKey maxLength and the L2 port limit", () => {
    expect(APPROVAL_REQUEST_KEY_MAX).toBe(48);
    const base = PAYLOAD_FIXTURES["approval.requested"];
    const withKey = (requestKey: string) =>
      parse(ApprovalRequestedPayloadSchema, { ...base, requestKey }).ok;
    expect(withKey("k".repeat(APPROVAL_REQUEST_KEY_MAX))).toBe(true);
    expect(withKey("k".repeat(APPROVAL_REQUEST_KEY_MAX + 1))).toBe(false);
    expect(L2_APPROVAL_REQUEST_ID_MAX).toBe(APPROVAL_REQUEST_KEY_MAX);
  });

  test("a plain id up to 48 characters is used as is", () => {
    expect(requestKeyFor("call_1", sha256Hex)).toBe("call_1");
    expect(requestKeyFor("x".repeat(48), sha256Hex)).toBe("x".repeat(48));
  });

  test("an id of 49 or more characters becomes h_ plus the first 40 hex of its sha256", () => {
    const raw = "x".repeat(49);
    expect(requestKeyFor(raw, sha256Hex)).toBe(`h_${sha256Hex(raw).slice(0, 40)}`);
    const long = "y".repeat(500);
    expect(requestKeyFor(long, sha256Hex)).toBe(`h_${sha256Hex(long).slice(0, 40)}`);
  });

  test("an id with characters outside the key alphabet is hashed to the same shape", () => {
    for (const raw of ["a:b", "call|odd id/with space", "", "한글", "h_plain"]) {
      const key = requestKeyFor(raw, sha256Hex);
      expect(key).toBe(`h_${sha256Hex(raw).slice(0, 40)}`);
      expect(KEY_SHAPE.test(key)).toBe(true);
    }
  });

  test("different raw ids give different keys and the same raw id the same key", () => {
    const a = requestKeyFor("x".repeat(60), sha256Hex);
    const b = requestKeyFor(`${"x".repeat(59)}y`, sha256Hex);
    expect(a).not.toBe(b);
    expect(requestKeyFor("x".repeat(60), sha256Hex)).toBe(a);
    // 해시 결과를 다시 넣어도 자기 자신이 되지 않는다(h_ 접두 원문은 해시된다)
    expect(requestKeyFor(a, sha256Hex)).not.toBe(a);
  });
});

describe("isApprovalRequestKey (U-13)", () => {
  test("accepts what requestKeyFor produces and nothing that it would hash", () => {
    for (const raw of ["call_1", "x".repeat(48), "x".repeat(60), "h_plain", "a:b", ""]) {
      const key = requestKeyFor(raw, sha256Hex);
      expect(isApprovalRequestKey(key)).toBe(true);
    }
    expect(isApprovalRequestKey("call_1.ask-2")).toBe(true);
  });

  test("rejects an h_ prefixed raw id, odd characters, empty and too long values", () => {
    for (const raw of [
      "h_plain",
      `h_${"a".repeat(39)}`,
      `h_${"A".repeat(40)}`,
      `h_${"a".repeat(41)}`,
    ]) {
      expect(isApprovalRequestKey(raw)).toBe(false);
    }
    for (const raw of ["", "a:b", "ask one", "한글", "x".repeat(49)]) {
      expect(isApprovalRequestKey(raw)).toBe(false);
    }
  });
});

describe("commitKeyPart (U-13)", () => {
  test("a plain id is used as is", () => {
    expect(commitKeyPart("call_1", fakeHash)).toBe("call_1");
    expect(commitKeyPart("toolu_01A.b-c", fakeHash)).toBe("toolu_01A.b-c");
  });

  test("ids with the key separator, odd characters, empty or too long are hashed", () => {
    for (const raw of ["a:b", "call|odd id/with space", "", "x".repeat(121), "한글"]) {
      const part = commitKeyPart(raw, fakeHash);
      expect(part.startsWith("h_")).toBe(true);
      expect(part.length).toBe(42);
      expect(new RegExp(COMMIT_KEY_PATTERN).test(`tool:${part}:result`)).toBe(true);
    }
  });

  test("an id that starts with h_ is hashed so it cannot equal a hash result", () => {
    const hashed = commitKeyPart("anything:else", fakeHash);
    expect(commitKeyPart(hashed, fakeHash)).not.toBe(hashed);
    expect(commitKeyPart("h_plain", fakeHash).startsWith("h_")).toBe(true);
    expect(commitKeyPart("h_plain", fakeHash)).not.toBe("h_plain");
  });

  test("the part is deterministic", () => {
    expect(commitKeyPart("a:b", fakeHash)).toBe(commitKeyPart("a:b", fakeHash));
  });

  test("reserved source keys are user, deleg, timer", () => {
    expect([...RESERVED_SOURCE_KEYS]).toEqual(["user", "deleg", "timer"]);
  });
});

describe("private records (acceptance 13)", () => {
  const query: ExtRecordQuery = { kind: "x.alpha.*" };

  test("only the owning extension sees its private rows", async () => {
    const port = fakePort("alpha");
    expect(await port.commit(request("k1", ["x.alpha.note.added"], "private"))).toEqual({
      status: "committed",
    });
    expect(rowsOf(await port.queryRecords(THREAD_ID, query, "alpha")).length).toBe(1);
    expect(rowsOf(await port.queryRecords(THREAD_ID, query, "beta")).length).toBe(0);
  });

  test("rows committed without visibility are visible to everyone", async () => {
    const port = fakePort("alpha");
    await port.commit(request("k1", ["x.alpha.note.added"]));
    await port.commit(request("k2", ["x.alpha.note.added"], "public"));
    expect(rowsOf(await port.queryRecords(THREAD_ID, query, "alpha")).length).toBe(2);
    expect(rowsOf(await port.queryRecords(THREAD_ID, query, "beta")).length).toBe(2);
  });

  test("a private commit of another extension's kind is rejected as invalid", async () => {
    const port = fakePort("alpha");
    expect(await port.commit(request("k1", ["x.beta.note.added"], "private"))).toEqual({
      status: "rejected",
      code: "invalid",
    });
    expect(
      await port.commit(request("k2", ["x.alpha.note.added", "x.beta.note.added"], "private")),
    ).toEqual({
      status: "rejected",
      code: "invalid",
    });
  });

  test("the same requestId is replayed, not stored twice", async () => {
    const port = fakePort("alpha");
    await port.commit(request("same", ["x.alpha.note.added"]));
    expect(await port.commit(request("same", ["x.alpha.note.added"]))).toEqual({
      status: "replayed",
    });
    expect(rowsOf(await port.queryRecords(THREAD_ID, query, "alpha")).length).toBe(1);
  });
});

describe("ExtThreadSnapshot scope history", () => {
  test("a snapshot carries disabled scopes, transition counts and enable seqs", async () => {
    const snapshot: ExtThreadSnapshot = {
      enabled: ["alpha"],
      disabled: ["beta"],
      scopeTransitions: { alpha: 1, beta: 2 },
      enabledAtSeq: { alpha: 7 },
      states: [],
      openLease: null,
      leaseEpochs: {},
    };
    const port: Pick<RecordCommitPort, "loadThread"> = {
      loadThread: () => Promise.resolve(ok(snapshot)),
    };
    const loadedResult = await port.loadThread(THREAD_ID);
    expect(loadedResult.ok).toBe(true);
    if (!loadedResult.ok) return;
    const loaded = loadedResult.value;
    expect(loaded.disabled).toEqual(["beta"]);
    expect(loaded.scopeTransitions["beta"]).toBe(2);
    // 켜진 scope만 enabledAtSeq 키를 갖는다
    expect(Object.keys(loaded.enabledAtSeq)).toEqual([...loaded.enabled]);
  });
});
