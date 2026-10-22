import { createHash } from "node:crypto";
import { assertNever, attempt, type Logger } from "@xeon/contracts";
import type {
  ReauthMethod,
  RedactionHit,
  RedactionLayer,
  SecretAuditRecord,
  SecretDenyReason,
  SecretHandle,
  SecretUseMode,
} from "@xeon/contracts/capabilities";
import type { ApprovalEvidence, UseCtx } from "@xeon/contracts/services";

// L0.secrets.spec §3.9. 어느 레코드에도 값, 값의 일부, 값의 해시를 싣지 않는다.
// 이 패키지는 레코드를 만들어 onAudit 수신자에게 배포하고 감사 파일(audit-file.ts)에 쓴다.
// 세션 이벤트 기록은 core-tools다.

/** 명령줄(값이 아닌 문자열)의 SHA-256 hex 앞 16자 */
export function commandHash(commandLine: string): string {
  return createHash("sha256").update(commandLine).digest("hex").slice(0, 16);
}

export interface AuditBus {
  emit(record: SecretAuditRecord): void;
  onAudit(sink: (record: SecretAuditRecord) => void): Disposable;
}

export function createAuditBus(deps: { readonly logger: Logger }): AuditBus {
  const sinks = new Set<(record: SecretAuditRecord) => void>();
  return {
    emit(record) {
      for (const sink of sinks) {
        try {
          sink(record);
        } catch (error: unknown) {
          // 수신자 하나의 실패가 비밀 사용 경로를 막지 않는다. 기록에는 오류 이름만 남긴다
          deps.logger.warn("secrets.audit.sink_failed", {
            recordType: record.type,
            error: error instanceof Error ? error.name : "unknown",
          });
        }
      }
    },
    onAudit(sink) {
      sinks.add(sink);
      return {
        [Symbol.dispose]() {
          sinks.delete(sink);
        },
      };
    },
  };
}

/** 사용 대상에서 감사 레코드의 host 칸에 적을 값. origin은 호스트(와 포트)만 적는다 */
function hostOf(target: UseCtx["target"]): string | null {
  switch (target.kind) {
    case "host":
      return target.host;
    case "origin": {
      const parsed = attempt(() => new URL(target.origin));
      return parsed.ok ? parsed.value.host : null;
    }
    case "command":
      return null;
    default:
      return assertNever(target, "hostOf");
  }
}

export function usedRecord(args: {
  readonly handle: SecretHandle;
  readonly ctx: UseCtx;
  readonly leaseId: string;
  readonly at: number;
}): SecretAuditRecord {
  const target = args.ctx.target;
  return {
    type: "secret.used",
    handle: args.handle,
    mode: args.ctx.mode,
    toolCallId: args.ctx.toolCallId,
    threadId: args.ctx.threadId,
    host: hostOf(target),
    commandHash: target.kind === "command" ? commandHash(target.commandLine) : null,
    decision: "allow",
    leaseId: args.leaseId,
    at: args.at,
  };
}

export function deniedRecord(args: {
  readonly handle: SecretHandle;
  readonly mode: SecretUseMode;
  readonly reason: SecretDenyReason;
  readonly ctx: Pick<UseCtx, "purpose" | "toolCallId" | "threadId">;
  readonly at: number;
}): SecretAuditRecord {
  return {
    type: "secret.denied",
    handle: args.handle,
    mode: args.mode,
    reason: args.reason,
    purpose: args.ctx.purpose,
    toolCallId: args.ctx.toolCallId,
    threadId: args.ctx.threadId,
    at: args.at,
  };
}

export function approvedRecord(args: {
  readonly handle: SecretHandle;
  readonly approval: ApprovalEvidence;
  readonly threadId: string | null;
  readonly at: number;
}): SecretAuditRecord {
  return {
    type: "secret.approved",
    handle: args.handle,
    scope: args.approval.scope,
    approvalId: args.approval.approvalId,
    expiresAt: args.approval.expiresAt,
    threadId: args.threadId,
    at: args.at,
  };
}

export function maskedRecord(args: {
  readonly hits: readonly RedactionHit[];
  readonly layer: RedactionLayer;
  readonly threadId: string | null;
  readonly at: number;
}): SecretAuditRecord {
  return {
    type: "secret.masked",
    hits: args.hits,
    layer: args.layer,
    threadId: args.threadId,
    at: args.at,
  };
}

/** 관리 동작(secret.created·updated·deleted·rotated) 레코드. fields에는 바뀐 필드 이름만 싣는다 */
export function adminRecord(args: {
  readonly type: "secret.created" | "secret.updated" | "secret.deleted" | "secret.rotated";
  readonly handle: SecretHandle;
  readonly fields: readonly string[];
  readonly at: number;
}): SecretAuditRecord {
  return {
    type: args.type,
    handle: args.handle,
    fields: args.fields,
    actor: "human",
    at: args.at,
  };
}

export function revealedRecord(args: {
  readonly handle: SecretHandle;
  readonly reauth: ReauthMethod;
  readonly at: number;
}): SecretAuditRecord {
  return {
    type: "secret.revealed",
    handle: args.handle,
    reauth: args.reauth,
    actor: "human",
    at: args.at,
  };
}
