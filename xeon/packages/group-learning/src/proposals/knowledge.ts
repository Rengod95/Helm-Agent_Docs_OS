import { assertNever, attemptAsync, err, ok, type Result } from "@xeon/contracts";
import {
  isCapabilityError,
  type CallOptions,
  type CapabilityApi,
  type KnowledgeLedger,
  type KnowledgeMemory,
  type KnowledgeSearch,
  type KnowledgeSkills,
  type WriteOutcome,
} from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { ApplyResult } from "../results.ts";
import { parsePatchEdits, parseTarget, type ParsedTarget } from "./target.ts";
import type { Proposal } from "./proposal.ts";

// L3.learning.spec §3.6의 `KnowledgeChangeApi` 어댑터. 학습 그룹은 cap-knowledge를 import하지 않고 `g.capability(<ServiceKey>)`로 얻은
// 서비스 API만 쓴다(eng.context-map.design CM-05). 이 파일이 L2.knowledge 메서드 이름과 오류 코드를 아는 유일한 곳이다(L3.learning.plan §6 위험 "L2-d 쓰기 API 미확정").

export interface KnowledgeApis {
  readonly skills: CapabilityApi<typeof KnowledgeSkills>;
  readonly memory: CapabilityApi<typeof KnowledgeMemory>;
  readonly search: CapabilityApi<typeof KnowledgeSearch>;
  readonly ledger: CapabilityApi<typeof KnowledgeLedger>;
}

export type KnowledgeFailure = {
  readonly kind: "learning.knowledgeUnavailable";
  readonly detail?: string;
};

/** 호출 문맥. 도구 execute는 자기 thread를, 명령·결정 경로는 thread 없이 부른다 */
export interface KnowledgeCall {
  readonly signal: AbortSignal;
  readonly threadId?: ThreadId;
}

type ScanVerdict = { readonly blocked: boolean; readonly rules: readonly string[] };

type CurrentHash =
  | { readonly state: "present"; readonly hash: string }
  | { readonly state: "absent" };

/** 승인 증거 source. cap-knowledge의 `trustedEvidenceSources`에 조립 루트가 이 값을 넣는다(REQ-LN-09) */
export const APPROVAL_SOURCE = "learning.queue";

interface ApplyCall extends KnowledgeCall {
  readonly idempotencyKey: string;
  readonly decidedAt: number;
}

/** 학습 그룹이 쓰는 지식 저장소 면. 실패는 던지지 않고 값으로 돌려준다 */
export interface KnowledgePort {
  /** 스킬 트리 해시. 읽기 선행 가드(`baseHash`)와 같은 이름 확인에 쓴다 */
  skillHash(name: string, call: KnowledgeCall): Promise<Result<CurrentHash, KnowledgeFailure>>;
  /** 메모리 파일 해시. 읽기 선행 가드에 쓴다 */
  memoryHash(
    area: "user" | "environment",
    call: KnowledgeCall,
  ): Promise<Result<string, KnowledgeFailure>>;
  /** 이름이 다른 유사 스킬. 없으면 null */
  similarSkill(
    name: string,
    text: string,
    call: KnowledgeCall,
  ): Promise<Result<string | null, KnowledgeFailure>>;
  scan(
    kind: "skill" | "memory",
    text: string,
    call: KnowledgeCall,
  ): Promise<Result<ScanVerdict, KnowledgeFailure>>;
  /** 승인된 후보를 L2 쓰기 API로 반영한다. 증거는 `learning.queue`다 */
  apply(proposal: Proposal, call: ApplyCall): Promise<ApplyResult>;
  rollback(
    ledgerId: string,
    call: KnowledgeCall & { readonly idempotencyKey: string },
  ): Promise<
    Result<void, { readonly kind: "hash_mismatch" | "not_found" | "io"; readonly detail?: string }>
  >;
}

function optionsOf(call: KnowledgeCall, extension: string, requestId?: string): CallOptions {
  return {
    signal: call.signal,
    ...(requestId === undefined ? {} : { requestId }),
    context: {
      ...(call.threadId === undefined ? {} : { threadId: call.threadId }),
      caller: { kind: "extension", extension },
    },
  };
}

function detailOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

type ApplyFailure = "scan_failed" | "base_stale" | "approval_required" | "invalid" | "io";

const FAILURE_CODES: ReadonlyMap<string, ApplyFailure> = new Map<string, ApplyFailure>([
  ["scan_blocked", "scan_failed"],
  ["base_stale", "base_stale"],
  ["patch_mismatch", "base_stale"],
  ["name_conflict", "base_stale"],
  ["drift_detected", "base_stale"],
  ["approval_denied", "approval_required"],
  ["denied", "approval_required"],
  ["invalid_input", "invalid"],
  ["duplicate_entry", "invalid"],
  ["memory_full", "invalid"],
  ["unsupported", "invalid"],
]);

/** 쓰기 실패 코드를 학습 대기열의 실패 이유로 옮긴다(§3.6 본문). 표에 없는 코드는 일시 실패(`io`)로 본다 */
function applyFailureOf(code: string): ApplyFailure {
  return FAILURE_CODES.get(code) ?? "io";
}

function unavailable(cause: unknown): KnowledgeFailure {
  return { kind: "learning.knowledgeUnavailable", detail: detailOf(cause) };
}

function memoryStoreOf(area: "user" | "environment"): "user" | "env" {
  return area === "user" ? "user" : "env";
}

/** 한 번 정한 API 묶음으로 만든 지식 저장소 면. `extension`은 호출 문맥의 확장 이름(그룹 이름)이다 */
export function createKnowledgePort(apis: KnowledgeApis, extension: string): KnowledgePort {
  return {
    async skillHash(name, call) {
      const viewed = await attemptAsync(() =>
        apis.skills.view({ name }, optionsOf(call, extension)),
      );
      if (viewed.ok) return ok({ state: "present", hash: viewed.value.treeHash });
      const cause = viewed.error.cause;
      if (isCapabilityError(cause) && cause.data.code === "not_found")
        return ok({ state: "absent" });
      return err(unavailable(cause));
    },
    async memoryHash(area, call) {
      const read = await attemptAsync(() =>
        apis.memory.read({ stores: [memoryStoreOf(area)] }, optionsOf(call, extension)),
      );
      if (!read.ok) return err(unavailable(read.error.cause));
      const view = read.value.stores[0];
      return view === undefined
        ? err({ kind: "learning.knowledgeUnavailable", detail: "memory store missing" })
        : ok(view.fileHash);
    },
    async similarSkill(name, text, call) {
      const query = `${name} ${text}`.slice(0, 256);
      const found = await attemptAsync(() =>
        apis.search.query({ query, kinds: ["skill"], limit: 5 }, optionsOf(call, extension)),
      );
      if (!found.ok) return err(unavailable(found.error.cause));
      const hit = found.value.hits.find(
        (candidate) => candidate.kind === "skill" && candidate.ref !== name,
      );
      return ok(hit === undefined ? null : hit.ref);
    },
    async scan(kind, text, call) {
      const scanned = await attemptAsync(() =>
        apis.ledger.scan({ kind, text }, optionsOf(call, extension)),
      );
      if (!scanned.ok) return err(unavailable(scanned.error.cause));
      const rules = scanned.value.findings.map((finding) => finding.rule);
      return ok({
        blocked: scanned.value.findings.some((finding) => finding.severity === "block"),
        rules,
      });
    },
    async apply(proposal, call) {
      const written = await attemptAsync(() => writeOf(apis, proposal, call, extension));
      if (!written.ok) {
        const cause = written.error.cause;
        if (isCapabilityError(cause)) {
          return {
            ok: false,
            reason: applyFailureOf(cause.data.code),
            detail: `${cause.data.code}: ${cause.data.message}`.slice(0, 500),
          };
        }
        return { ok: false, reason: "io", detail: detailOf(cause) };
      }
      const outcome = written.value;
      if (outcome === undefined) {
        return {
          ok: false,
          reason: "invalid",
          detail: "the proposal body does not fit its operation",
        };
      }
      if (
        outcome.status === "applied" &&
        outcome.ledgerId !== undefined &&
        outcome.afterHash !== undefined
      ) {
        return { ok: true, ledgerId: outcome.ledgerId, afterHash: outcome.afterHash };
      }
      // queued: L2가 이 증거를 믿지 않아 자기 대기열로 보냈다(trustedEvidenceSources에 learning.queue가 없음). 승인이 두 번 생기므로 적용하지 않은 것으로 본다
      return {
        ok: false,
        reason: "approval_required",
        detail: "the knowledge store queued the change instead of applying it",
      };
    },
    async rollback(ledgerId, call) {
      const done = await attemptAsync(() =>
        apis.ledger.rollback(
          { ledgerId, reason: "learning queue revert" },
          {
            ...optionsOf(call, extension, call.idempotencyKey),
            requestId: call.idempotencyKey,
          },
        ),
      );
      if (done.ok) return ok(undefined);
      const cause = done.error.cause;
      if (isCapabilityError(cause)) {
        if (cause.data.code === "rollback_conflict")
          return err({ kind: "hash_mismatch", detail: cause.data.message });
        if (cause.data.code === "not_found")
          return err({ kind: "not_found", detail: cause.data.message });
        return err({
          kind: "io",
          detail: `${cause.data.code}: ${cause.data.message}`.slice(0, 500),
        });
      }
      return err({ kind: "io", detail: detailOf(cause) });
    },
  };
}

/** 후보 한 건을 연산에 맞는 L2 메서드로 보낸다. 본문이 연산에 맞지 않으면 undefined */
async function writeOf(
  apis: KnowledgeApis,
  proposal: Proposal,
  call: ApplyCall,
  extension: string,
): Promise<WriteOutcome | undefined> {
  const target = parseTarget(proposal.kind, proposal.op, proposal.target);
  if (!target.ok) return undefined;
  const options = {
    ...optionsOf(call, extension, call.idempotencyKey),
    requestId: call.idempotencyKey,
  };
  const approval = {
    source: APPROVAL_SOURCE,
    ref: `${proposal.id}:${String(proposal.revision)}`,
    decidedAt: call.decidedAt,
  };
  const parsed = target.value;
  switch (parsed.kind) {
    case "skill":
      return writeSkill(apis, proposal, parsed, approval, options);
    case "memory":
      return writeMemory(apis, proposal, parsed, approval, options);
    case "feedback": {
      // 승인된 피드백은 메모리 user 영역의 항목으로 더한다(§4.7). 별도 저장소를 만들지 않는다
      const written = await apis.memory.add(
        { store: "user", text: proposal.body, approval },
        options,
      );
      return written.outcome;
    }
    default:
      return assertNever(parsed, "ParsedTarget");
  }
}

type Approval = { readonly source: string; readonly ref: string; readonly decidedAt: number };
type IdempotentOptions = CallOptions & { readonly requestId: string };

async function writeSkill(
  apis: KnowledgeApis,
  proposal: Proposal,
  target: Extract<ParsedTarget, { kind: "skill" }>,
  approval: Approval,
  options: IdempotentOptions,
): Promise<WriteOutcome | undefined> {
  const scope = proposal.scope;
  switch (proposal.op) {
    case "create":
      return apis.skills.create(
        {
          name: target.name,
          description: proposal.description ?? descriptionOf(proposal.body),
          body: proposal.body,
          scope,
          approval,
        },
        options,
      );
    case "patch": {
      const edits = parsePatchEdits(proposal.body);
      if (!edits.ok || proposal.baseHash === null) return undefined;
      return apis.skills.patch(
        {
          name: target.name,
          scope,
          baseHash: proposal.baseHash,
          edits: [...edits.value],
          approval,
        },
        options,
      );
    }
    case "add_file":
      if (target.file === null) return undefined;
      return apis.skills.writeFile(
        { name: target.name, scope, path: target.file, content: proposal.body, approval },
        options,
      );
    case "archive":
      if (proposal.baseHash === null) return undefined;
      return apis.skills.remove(
        { name: target.name, scope, baseHash: proposal.baseHash, mode: "archive", approval },
        options,
      );
    case "add":
    case "replace":
    case "remove":
      return undefined;
    default:
      return assertNever(proposal.op, "ProposalOp");
  }
}

async function writeMemory(
  apis: KnowledgeApis,
  proposal: Proposal,
  target: Extract<ParsedTarget, { kind: "memory" }>,
  approval: Approval,
  options: IdempotentOptions,
): Promise<WriteOutcome | undefined> {
  const store = memoryStoreOf(target.area);
  switch (proposal.op) {
    case "add": {
      const written = await apis.memory.add({ store, text: proposal.body, approval }, options);
      return written.outcome;
    }
    case "replace": {
      if (target.entryId === null || proposal.baseHash === null) return undefined;
      const written = await apis.memory.replace(
        {
          store,
          entryId: target.entryId,
          text: proposal.body,
          baseHash: proposal.baseHash,
          approval,
        },
        options,
      );
      return written.outcome;
    }
    case "remove": {
      if (target.entryId === null || proposal.baseHash === null) return undefined;
      const written = await apis.memory.remove(
        { store, entryId: target.entryId, baseHash: proposal.baseHash, approval },
        options,
      );
      return written.outcome;
    }
    case "create":
    case "patch":
    case "add_file":
    case "archive":
      return undefined;
    default:
      return assertNever(proposal.op, "ProposalOp");
  }
}

/** 스킬 create에 설명 입력이 없을 때: 본문 첫 비어 있지 않은 줄(최대 1024자) */
export function descriptionOf(body: string): string {
  const first = body.split("\n").find((line) => line.trim().length > 0) ?? "";
  const trimmed = first.replace(/^#+\s*/u, "").trim();
  return (trimmed.length === 0 ? "learned skill" : trimmed).slice(0, 1024);
}
