import { parse, parseJson, type Clock, type Logger, type Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { Type } from "typebox";
import type { MeasureStore } from "./store.ts";
import type { TrThreadRow } from "./turn-tables.ts";

// Test run 대화의 표지를 측정 저장소의 `tr_thread`에 내구 기록한다(정본 `docs/xeon/review/m5/turn-record-metrics.md` §4.6 규칙 32).
// 메모리 표지(`Set`, `Map`)는 그대로 두고, 같은 대화를 이 표로도 적는다. 재시작 뒤에는 `recall`이 표지를 되살린다.
// 계측 설정과 무관하게 쓴다. 저장소가 없거나 쓰지 못하면 메모리 표지만 남는다(폴백). 대화를 지우면 `forgetThread`가 행을 지운다.

/** 대화 범위 표지의 값. `test`는 Test run 대화, `craft`는 테스트 대화(M5c §4.8.9, 규칙 36)다 */
type ThreadScopeMark = "test" | "craft";

/**
 * 고정 초안 하나의 기록(`tr_thread.draft_json`의 항목). `plugin`은 검토본의 이름이고 `contentHash`는 초안의 내용 해시다.
 * `startDrive`는 그 초안이 시작 Drive를 쓸 때만 참이다(없으면 옛 기록과 같다, §4.8.1 항목 3)
 */
export interface TestRunDraftRecord {
  readonly plugin: string;
  readonly draftId: string;
  readonly contentHash: string;
  readonly startDrive?: boolean;
}

const TestRunDraftsJsonSchema = Type.Object(
  {
    drafts: Type.Array(
      Type.Object(
        {
          plugin: Type.String({ minLength: 1, maxLength: 96 }),
          draftId: Type.String({ minLength: 1, maxLength: 128 }),
          contentHash: Type.String({ minLength: 1, maxLength: 128 }),
          startDrive: Type.Optional(Type.Literal(true)),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

/** 고정 초안 표지 하나를 `draft_json`의 기록 한 줄로 옮긴다. `startDrive`는 참일 때만 싣는다 */
export function draftRecordOf(mark: {
  readonly replaces: string;
  readonly draftId: string;
  readonly contentHash: string;
  readonly startDrive?: boolean;
}): TestRunDraftRecord {
  const record: TestRunDraftRecord = {
    plugin: mark.replaces,
    draftId: mark.draftId,
    contentHash: mark.contentHash,
  };
  return mark.startDrive === true ? { ...record, startDrive: true } : record;
}

/** 고정 초안 목록을 `draft_json` 글로 쓴다(M5c §4.8.1). 모양은 `{drafts:[{plugin,draftId,contentHash[,startDrive]}]}`다 */
export function encodeTestRunDrafts(drafts: readonly TestRunDraftRecord[]): string {
  return JSON.stringify({
    drafts: drafts.map((draft) => ({
      plugin: draft.plugin,
      draftId: draft.draftId,
      contentHash: draft.contentHash,
      ...(draft.startDrive === true ? { startDrive: true } : {}),
    })),
  });
}

/**
 * `draft_json`을 읽는다. 값이 없으면 초안이 없는 것이다. 글이 깨졌거나 모양이 다르면 `corrupt`다(저장 데이터 손상, 열기는 초안 없이 한다)
 */
export function decodeTestRunDrafts(
  text: string | null,
): Result<readonly TestRunDraftRecord[], { readonly kind: "corrupt" }> {
  if (text === null) return { ok: true, value: [] };
  const json = parseJson(text);
  if (!json.ok) return { ok: false, error: { kind: "corrupt" } };
  const parsed = parse(TestRunDraftsJsonSchema, json.value);
  if (!parsed.ok) return { ok: false, error: { kind: "corrupt" } };
  return { ok: true, value: parsed.value.drafts };
}

export interface TestRunMarks {
  /**
   * 표지를 쓴다. 이미 있는 행의 생성 시각과 대상 확장은 지킨다. 쓰지 못했으면 거짓이다.
   * `scopeKind`를 생략하면 `test`다. `craft`는 테스트 대화의 턴을 `scope_kind = craft`로 적게 한다.
   * `runGroupId`를 생략하면 이미 있는 행의 값을 지킨다(테스트 실행의 묶음 id, M5c §4.8.1).
   * `draftJson`을 생략하면 이미 있는 행의 고정 초안 기록을 지킨다(§4.8.1 3)
   */
  remember(
    threadId: ThreadId,
    testBaseProfile: string | null,
    scopeKind?: ThreadScopeMark,
    runGroupId?: string,
    draftJson?: string,
  ): boolean;
  /** 저장된 표지. Test run 대화가 아니거나 저장소가 없으면 undefined */
  recall(threadId: ThreadId): TrThreadRow | undefined;
}

export interface TestRunMarksDeps {
  /** 열린 측정 저장소. 열지 못했으면 undefined */
  readonly store: () => MeasureStore | undefined;
  readonly clock: Pick<Clock, "now">;
  readonly logger: Logger;
}

export function createTestRunMarks(deps: TestRunMarksDeps): TestRunMarks {
  return {
    remember(threadId, testBaseProfile, scopeKind = "test", runGroupId, draftJson) {
      const store = deps.store();
      if (store === undefined) return false;
      const existing = store.getThread(threadId);
      if (!existing.ok) {
        deps.logger.warn("measure.test_marker_read_failed", { reason: existing.error.kind });
        return false;
      }
      const row = existing.value;
      const written = store.upsertThread({
        threadId,
        scopeKind,
        testBaseProfile,
        testTarget: row?.testTarget ?? null,
        runGroupId: runGroupId ?? row?.runGroupId ?? null,
        inputHash: row?.inputHash ?? null,
        createdAt: row?.createdAt ?? deps.clock.now(),
        draftJson: draftJson ?? row?.draftJson ?? null,
      });
      if (!written.ok) {
        deps.logger.warn("measure.test_marker_write_failed", { reason: written.error.kind });
        return false;
      }
      return true;
    },
    recall(threadId) {
      const store = deps.store();
      if (store === undefined) return undefined;
      const found = store.getThread(threadId);
      if (!found.ok) {
        deps.logger.warn("measure.test_marker_read_failed", { reason: found.error.kind });
        return undefined;
      }
      return found.value?.scopeKind === "test" ? found.value : undefined;
    },
  };
}
