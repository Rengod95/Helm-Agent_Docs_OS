import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  attemptAsync,
  detach,
  err,
  ok,
  parse,
  parseJson,
  type Clock,
  type Logger,
  type Result,
} from "@xeon/contracts";
import {
  SecretHandleSchema,
  SecretUseModeSchema,
  type SecretAuditRecord,
} from "@xeon/contracts/capabilities";
import { Type } from "typebox";
import { SECRETS_SUBDIR } from "./config.ts";
import { errorCode } from "./errors.ts";

// L0.secrets.spec §3.9. 감사 파일 `<OsDirs.config>/secrets/audit.log`: 줄마다 JSON 하나, 추가 전용, 기록마다 fsync, 0600.
// 어느 레코드에도 값, 값의 일부, 값의 해시를 싣지 않는다(레코드 타입이 그런 필드를 갖지 않는다).
// 쓰기는 이 프로세스 안에서 한 줄로 이어 붙인다(순서 유지). 다른 프로세스와의 동시 쓰기는 O_APPEND에 맡기고,
// 보관 기간 정리(prune)만 파일을 다시 쓰므로 정리 중에 다른 프로세스가 붙인 줄이 사라질 수 있다 [가정: 한 사용자의 CLI와 호스트는
// 정리를 시작 시점에 한 번만 하고, 정리 시각이 겹칠 가능성은 낮다].

const AUDIT_FILE_NAME = "audit.log";

const DAY_MS = 86_400_000;
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

type AuditWriteError = {
  readonly kind: "audit_io";
  readonly code: string;
  /** 감사 파일 경로 */
  readonly path: string;
};

export interface AuditLog {
  /** 대기열 뒤에 붙인다. 실패는 기록하고 호출 경로를 막지 않는다(사용·거부 레코드) */
  record(record: SecretAuditRecord): void;
  /** 디스크에 fsync될 때까지 기다린다. 열람처럼 기록 없이는 진행하면 안 되는 동작에 쓴다 */
  appendDurable(record: SecretAuditRecord): Promise<Result<void, AuditWriteError>>;
  /** 대기 중인 쓰기를 모두 기다린 뒤 읽는다. 해석할 수 없는 줄은 건너뛴다 */
  read(): Promise<Result<readonly SecretAuditRecord[], AuditWriteError>>;
  /** 대기 중인 쓰기가 끝나기를 기다린다 */
  flush(): Promise<void>;
}

export interface AuditLogDeps {
  /** `<OsDirs.config>` */
  readonly configDir: string;
  readonly clock: Clock;
  readonly logger: Logger;
  /** l0.secrets.audit.retentionDays. 호출마다 읽는다 */
  readonly retentionDays: () => number;
}

// ── 줄 해석 ──────────────────────────────────────────────────────────────

const ReauthSchema = Type.Union([
  Type.Literal("os-auth"),
  Type.Literal("passphrase"),
  Type.Literal("tty-confirm"),
]);
const LayerSchema = Type.Union([
  Type.Literal("human-input"),
  Type.Literal("tool-result"),
  Type.Literal("outbound"),
  Type.Literal("model-projection"),
  Type.Literal("ops-log"),
]);
const DenyReasonSchema = Type.Union([
  Type.Literal("host_mismatch"),
  Type.Literal("origin_mismatch"),
  Type.Literal("command_mismatch"),
  Type.Literal("approval_missing"),
  Type.Literal("expired"),
  Type.Literal("lease_expired"),
  Type.Literal("lease_exhausted"),
  Type.Literal("mode_not_allowed"),
  Type.Literal("tool_not_allowed"),
  Type.Literal("scope_mismatch"),
]);
const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableNumber = Type.Union([Type.Number(), Type.Null()]);
const ApprovalScopeSchema = Type.Union([Type.Literal("per-session"), Type.Literal("per-use")]);

const AuditRecordSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("secret.used"),
      handle: SecretHandleSchema,
      mode: SecretUseModeSchema,
      toolCallId: NullableString,
      threadId: NullableString,
      host: NullableString,
      commandHash: NullableString,
      decision: Type.Literal("allow"),
      leaseId: Type.String(),
      at: Type.Number(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("secret.denied"),
      handle: SecretHandleSchema,
      mode: SecretUseModeSchema,
      reason: DenyReasonSchema,
      purpose: Type.String(),
      toolCallId: NullableString,
      threadId: NullableString,
      at: Type.Number(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("secret.approved"),
      handle: SecretHandleSchema,
      scope: ApprovalScopeSchema,
      approvalId: Type.String(),
      expiresAt: NullableNumber,
      threadId: NullableString,
      at: Type.Number(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Union([
        Type.Literal("secret.created"),
        Type.Literal("secret.updated"),
        Type.Literal("secret.deleted"),
        Type.Literal("secret.rotated"),
      ]),
      handle: SecretHandleSchema,
      fields: Type.Array(Type.String()),
      actor: Type.Literal("human"),
      at: Type.Number(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("secret.revealed"),
      handle: SecretHandleSchema,
      reauth: ReauthSchema,
      actor: Type.Literal("human"),
      at: Type.Number(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("secret.masked"),
      hits: Type.Array(
        Type.Object({ kind: Type.String(), count: Type.Number() }, { additionalProperties: false }),
      ),
      layer: LayerSchema,
      threadId: NullableString,
      at: Type.Number(),
    },
    { additionalProperties: false },
  ),
]);

/** 감사 파일의 한 줄을 레코드로 들인다. 해석할 수 없으면 null */
export function parseAuditLine(line: string): SecretAuditRecord | null {
  const json = parseJson(line);
  if (!json.ok) return null;
  const checked = parse(AuditRecordSchema, json.value);
  return checked.ok ? checked.value : null;
}

/** 정리 기준에 쓰는 시각. 줄이 JSON 객체이고 at이 숫자일 때만 돌려준다(해석할 수 없는 줄은 보존한다) */
function timestampOf(line: string): number | null {
  const json = parseJson(line);
  if (!json.ok) return null;
  const value = json.value;
  if (typeof value !== "object" || value === null) return null;
  const at: unknown = Reflect.get(value, "at");
  return typeof at === "number" ? at : null;
}

// ── 파일 ─────────────────────────────────────────────────────────────────

export function auditFilePath(configDir: string): string {
  return join(configDir, SECRETS_SUBDIR, AUDIT_FILE_NAME);
}

function ignore(): void {
  // 쓰기 순서 꼬리를 값으로 잇는 용도다. 실패는 task를 기다린 호출자에게 간다.
}

export function createAuditLog(deps: AuditLogDeps): AuditLog {
  const path = auditFilePath(deps.configDir);
  const ioError = (error: unknown): AuditWriteError => ({
    kind: "audit_io",
    code: errorCode(error),
    path,
  });
  /** 앞선 쓰기가 모두 끝난 시점에 풀린다. 어떤 단계도 reject하지 않는다(실패는 Result로 돌려준다) */
  let tail: Promise<unknown> = Promise.resolve();
  let pruned = false;

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = tail.then(task);
    // task가 reject해도 꼬리는 풀린 채로 이어 가야 이후 쓰기가 건너뛰어지지 않는다
    tail = next.then(ignore, ignore);
    return next;
  }

  async function prune(): Promise<Result<void, AuditWriteError>> {
    const cutoff = deps.clock.now() - deps.retentionDays() * DAY_MS;
    const read = await attemptAsync(() => readFile(path, "utf8"));
    if (!read.ok) {
      const code = errorCode(read.error.cause);
      return code === "ENOENT" ? ok(undefined) : err(ioError(read.error.cause));
    }
    const lines = read.value.split("\n").filter((line) => line !== "");
    const kept = lines.filter((line) => {
      const at = timestampOf(line);
      return at === null || at >= cutoff;
    });
    if (kept.length === lines.length) return ok(undefined);
    const temp = `${path}.prune-${process.pid}`;
    const written = await attemptAsync(async () => {
      const handle = await open(temp, "w", FILE_MODE);
      try {
        await handle.chmod(FILE_MODE);
        await handle.writeFile(kept.length === 0 ? "" : `${kept.join("\n")}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, path);
    });
    if (!written.ok) {
      await attemptAsync(() => rm(temp, { force: true }));
      return err(ioError(written.error.cause));
    }
    return ok(undefined);
  }

  async function append(record: SecretAuditRecord): Promise<Result<void, AuditWriteError>> {
    if (!pruned) {
      pruned = true;
      const result = await prune();
      if (!result.ok) deps.logger.warn("secrets.audit.prune_failed", { code: result.error.code });
    }
    const line = `${JSON.stringify(record)}\n`;
    const written = await attemptAsync(async () => {
      await mkdir(dirname(path), { recursive: true, mode: DIR_MODE });
      const handle = await open(path, "a", FILE_MODE);
      try {
        // 이미 있던 파일의 권한이 넓어도 0600으로 되돌린다
        await handle.chmod(FILE_MODE);
        await handle.appendFile(line);
        await handle.sync();
      } finally {
        await handle.close();
      }
    });
    return written.ok ? ok(undefined) : err(ioError(written.error.cause));
  }

  return {
    record(record) {
      // 반환 Promise는 tail에 이어져 flush가 기다린다. append 안의 실패는 Result로 돌아와 여기서 기록한다.
      // 예상 밖 거부는 onFailure가 기록한다
      detach(
        enqueue(async () => {
          const result = await append(record);
          if (!result.ok) {
            deps.logger.error("secrets.audit.write_failed", {
              type: record.type,
              code: result.error.code,
            });
          }
        }),
        (cause) => {
          deps.logger.error("secrets.audit.write_crashed", { code: errorCode(cause) });
        },
      );
    },
    appendDurable(record) {
      return enqueue(() => append(record));
    },
    async read() {
      await tail;
      const text = await attemptAsync(() => readFile(path, "utf8"));
      if (!text.ok) {
        const code = errorCode(text.error.cause);
        return code === "ENOENT" ? ok([]) : err(ioError(text.error.cause));
      }
      const records: SecretAuditRecord[] = [];
      let skipped = 0;
      for (const line of text.value.split("\n")) {
        if (line === "") continue;
        const record = parseAuditLine(line);
        if (record === null) skipped += 1;
        else records.push(record);
      }
      if (skipped > 0) deps.logger.warn("secrets.audit.lines_skipped", { count: skipped });
      return ok(records);
    },
    async flush() {
      await tail;
    },
  };
}
