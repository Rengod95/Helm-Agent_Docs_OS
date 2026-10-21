import { test } from "bun:test";
import type { SecretAuditRecord } from "../../src/capabilities/index.ts";
import type {
  CommitRequest,
  DurableEventEnvelope,
  EventEnvelope,
  ProducerId,
  RecordCommitPort,
  SecretApprovedPayload,
  SecretDeniedPayload,
  SecretMaskedPayload,
  SecretUsedPayload,
  SessionService,
  StepCheckpoint,
  StepCheckpointInput,
  VolatileEventEnvelope,
} from "../../src/records/index.ts";
import type { Assignable, Equal, Expect } from "../types/expect.ts";

// 이 파일의 단언은 tsc -b가 판정한다(컴파일 시점). 아래 테스트는 파일이 bun test와 knip 진입점에 들게 한다.

/** SessionService.ext는 X 기록 포트다 */
export type ExtIsRecordPort = Expect<Equal<SessionService["ext"], RecordCommitPort>>;

/** commit 요청의 checkpoint 입력은 저장소가 채우는 네 필드를 뺀 것이다 */
export type CheckpointInputOmitsStoreFields = Expect<
  Equal<
    keyof StepCheckpointInput,
    Exclude<keyof StepCheckpoint, "checkpointId" | "schemaVersion" | "threadId" | "leafEventId">
  >
>;

/** 내구/휘발 envelope는 durable 리터럴로 갈린다 */
export type EnvelopeDiscriminant = Expect<
  Equal<
    EventEnvelope["durable"],
    DurableEventEnvelope["durable"] | VolatileEventEnvelope["durable"]
  >
>;
export type DurableLiteral = Expect<Equal<DurableEventEnvelope["durable"], true>>;
export type VolatileLiteral = Expect<Equal<VolatileEventEnvelope["durable"], false>>;
export type VolatileHasNoSeq = Expect<
  Equal<"seq" extends keyof VolatileEventEnvelope ? true : false, false>
>;
export type DurableHasNoN = Expect<
  Equal<"n" extends keyof DurableEventEnvelope ? true : false, false>
>;

/** 생산자 id 형식 */
export type ProducerIds = Expect<
  Assignable<"core.loop" | "cap.work" | "xh" | "ext.helm", ProducerId>
>;
export type NoUnknownProducer = Expect<Equal<Assignable<"somebody", ProducerId>, false>>;

export type CommitRequestHasBuild = Expect<Assignable<"build", keyof CommitRequest>>;

/**
 * secret.* payload는 SecretAuditRecord의 같은 type 변형과 필드 이름이 같다. 감사 레코드의 threadId와 type은
 * envelope로 옮겨졌고, used의 decision("allow" 고정)은 payload에 없다(F.records.spec §3.3.1, F.capabilities.spec §3.10).
 */
type AuditKeys<T extends SecretAuditRecord["type"]> = Exclude<
  keyof Extract<SecretAuditRecord, { type: T }>,
  "type" | "threadId" | "decision"
>;
export type UsedKeys = Expect<Equal<keyof SecretUsedPayload, AuditKeys<"secret.used">>>;
export type DeniedKeys = Expect<Equal<keyof SecretDeniedPayload, AuditKeys<"secret.denied">>>;
export type ApprovedKeys = Expect<Equal<keyof SecretApprovedPayload, AuditKeys<"secret.approved">>>;
export type MaskedKeys = Expect<Equal<keyof SecretMaskedPayload, AuditKeys<"secret.masked">>>;

test("type assertions compile", () => {});
