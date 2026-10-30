import { err, ok, parseJson, type Result } from "@xeon/contracts";
import type {
  CallOptions,
  DecideInput,
  DecideOutput,
  KnowledgeActor,
  Proposal,
  ProposalsInput,
  ProposalsOutput,
  WritableSkillScope,
  WriteOutcome,
} from "@xeon/contracts/capabilities";
import { actorOf } from "../actor.ts";
import { failure, fromStoreError, type KnowledgeFailure } from "../errors.ts";
import type { LedgerDeps } from "../ledger/change.ts";
import { unpinBlobs } from "../ledger/manifest.ts";
import type { KnowledgeSettings } from "../settings.ts";
import {
  closeProposal,
  expirePending,
  findProposal,
  listProposals,
  type ProposalMethod,
  type ProposalRecord,
} from "./proposals.ts";

// L2.knowledge.spec §4.5.2 제안 대기열: 목록, 만료, 결정. 승인(`approve`)은 저장한 입력을 쓰기 경로로 다시 실행하고(승인한 사람이
// 이미 봤으므로 게이트는 건너뛴다), 거절(`reject`)은 파일을 건드리지 않는다. 승인 전에는 어떤 상태의 제안도 정본 파일에 효과가 없다.

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 50;

/** 저장한 입력을 쓰기 경로로 다시 실행한다. 제안한 행위자를 원장 행위자로 남기고 제안 id를 싣는다 */
interface ReplayCall {
  readonly input: unknown;
  readonly actor: KnowledgeActor;
  readonly proposalId: string;
  /** 제안 당시의 `afterUntrusted`. 원장 행에 그대로 남긴다 */
  readonly afterUntrusted: boolean;
  /** `decide`의 메모. 원장 `reason`이 된다 */
  readonly note: string | undefined;
  readonly signal: AbortSignal | undefined;
}

export type Replayer = (call: ReplayCall) => Promise<Result<WriteOutcome, KnowledgeFailure>>;
export type Replayers = Readonly<Record<ProposalMethod, Replayer>>;

export interface QueueDeps extends LedgerDeps {
  readonly settings: (threadId: string | undefined) => KnowledgeSettings;
  readonly replayers: Replayers;
}

export interface ProposalQueue {
  proposals(input: ProposalsInput): Result<ProposalsOutput, KnowledgeFailure>;
  decide(
    input: DecideInput,
    options?: CallOptions,
  ): Promise<Result<DecideOutput, KnowledgeFailure>>;
  /** 만료 기한이 지난 pending 제안을 expired로 바꾼다. 시작 정리와 목록·결정 앞에서 부른다 */
  expire(): Result<number, KnowledgeFailure>;
}

function scopeRefused(message: string): KnowledgeFailure {
  return failure("invalid_input", message, { detail: { reason: "scope_not_allowed" } });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 승인 때 고른 범위를 저장한 입력에 반영한다. 새 스킬(`skills.create`)만 범위를 바꿀 수 있다(D-M3-09) */
function withChosenScope(
  record: ProposalRecord,
  stored: unknown,
  chosen: WritableSkillScope,
): Result<unknown, KnowledgeFailure> {
  if (record.proposal.target.kind !== "skill") {
    return err(scopeRefused("only a skill proposal has a scope"));
  }
  if (chosen === (record.proposal.target.scope ?? "user")) return ok(stored);
  if (record.method !== "skills.create") {
    return err(scopeRefused("only a new skill can be applied to another scope"));
  }
  if (!isRecord(stored)) {
    return err(failure("internal", "the proposal input is not a JSON object"));
  }
  return ok({ ...stored, scope: chosen });
}

/** 대상이 제안 이후 바뀌었음을 뜻하는 실패. 제안은 stale이 된다 */
function makesStale(error: KnowledgeFailure): boolean {
  return (
    error.kind === "base_stale" ||
    error.kind === "name_conflict" ||
    error.kind === "patch_mismatch" ||
    error.kind === "rollback_conflict"
  );
}

export function createProposalQueue(deps: QueueDeps): ProposalQueue {
  const { db, blobs, clock, logger } = deps;

  const expire: ProposalQueue["expire"] = () => {
    const days = deps.settings(undefined).write.proposalExpiryDays;
    const now = clock.now();
    const expired = db.write((tx) => expirePending(tx, now - days * DAY_MS, now));
    if (!expired.ok) return err(fromStoreError(expired.error, "proposal expiry"));
    // 만료된 제안은 다시 실행하지 않으므로 입력 블롭의 고정을 푼다
    for (const proposalId of expired.value) unpinBlobs(blobs, logger, proposalId);
    return ok(expired.value.length);
  };

  const load = (proposalId: string): Result<ProposalRecord, KnowledgeFailure> => {
    const read = db.read((tx) => findProposal(tx, proposalId));
    if (!read.ok) return err(fromStoreError(read.error, "proposal lookup"));
    if (!read.value.ok) return read.value;
    return read.value.value === undefined
      ? err(failure("not_found", `proposal ${proposalId} does not exist`))
      : ok(read.value.value);
  };

  const close = (
    record: ProposalRecord,
    status: Exclude<Proposal["status"], "pending">,
    ledgerId: string | undefined,
  ): Result<Proposal, KnowledgeFailure> => {
    const decidedAt = clock.now();
    const closed = db.write((tx) =>
      closeProposal(tx, record.proposal.proposalId, status, decidedAt, ledgerId),
    );
    if (!closed.ok) return err(fromStoreError(closed.error, "proposal close"));
    if (!closed.value) {
      return err(failure("proposal_closed", "the proposal was decided by someone else"));
    }
    // 닫힌 제안은 입력을 다시 읽지 않는다. 입력 블롭의 고정을 푼다(닫힌 뒤라 결정은 이미 남았으므로 실패는 기록만 한다)
    unpinBlobs(blobs, logger, record.proposal.proposalId);
    return ok({
      ...record.proposal,
      status,
      ...(ledgerId === undefined ? {} : { ledgerId }),
    });
  };

  const proposals: ProposalQueue["proposals"] = (input) => {
    const swept = expire();
    if (!swept.ok) return swept;
    const read = db.read((tx) =>
      listProposals(tx, {
        statuses: [
          ...new Set([
            ...(input.status === undefined ? [] : [input.status]),
            ...(input.statuses ?? []),
          ]),
        ],
        limit: input.limit ?? DEFAULT_LIMIT,
        ...(input.before === undefined ? {} : { before: input.before }),
      }),
    );
    if (!read.ok) return err(fromStoreError(read.error, "proposal list"));
    if (!read.value.ok) return read.value;
    return ok({ proposals: read.value.value.map((record) => record.proposal) });
  };

  const decide: ProposalQueue["decide"] = async (input, options) => {
    // 결정은 사람의 일이다. 호출 확장에는 증거를 실을 자리가 없어(`DecideInput`) 호스트(사용자)만 결정한다
    const actor = actorOf(options?.context);
    if (!actor.ok) return actor;
    if (actor.value.kind !== "user") {
      return err(failure("denied", "only the user can decide a proposal"));
    }
    const swept = expire();
    if (!swept.ok) return swept;
    const loaded = load(input.proposalId);
    if (!loaded.ok) return loaded;
    const record = loaded.value;
    if (record.proposal.status !== "pending") {
      return err(
        failure("proposal_closed", `this proposal is already ${record.proposal.status}`, {
          detail: { status: record.proposal.status },
        }),
      );
    }
    if (input.decision === "reject") {
      const closed = close(record, "rejected", undefined);
      return closed.ok ? ok({ proposal: closed.value }) : closed;
    }

    const stored = blobs.readBlob(record.input);
    if (!stored.ok) {
      return err(failure("internal", `the proposal input is unreadable: ${stored.error.kind}`));
    }
    const parsed = parseJson(new TextDecoder().decode(stored.value));
    if (!parsed.ok) return err(failure("internal", "the proposal input is not JSON"));
    const chosen =
      input.scope === undefined
        ? ok(parsed.value)
        : withChosenScope(record, parsed.value, input.scope);
    if (!chosen.ok) return chosen;
    const replay = deps.replayers[record.method];
    const applied = await replay({
      input: chosen.value,
      actor: record.proposal.actor,
      proposalId: record.proposal.proposalId,
      afterUntrusted: record.proposal.afterUntrusted === true,
      note: input.note,
      signal: options?.signal,
    });
    if (!applied.ok) {
      if (makesStale(applied.error)) {
        const staled = close(record, "stale", undefined);
        if (!staled.ok) return staled;
      }
      return applied;
    }
    const closed = close(record, "applied", applied.value.ledgerId);
    if (!closed.ok) return closed;
    return ok({ proposal: closed.value, outcome: applied.value });
  };

  return { proposals, decide, expire };
}
