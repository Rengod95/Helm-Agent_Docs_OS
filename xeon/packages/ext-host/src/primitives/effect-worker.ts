import { CapabilityError, isCapabilityId, type CapabilityId } from "@xeon/contracts/capabilities";
import { parse } from "@xeon/contracts";
import { toJsonValue, type JsonValue, type ThreadId } from "@xeon/contracts/conversation";
import { RecordCommitPortKey, type ExtensionName, type ScopeId } from "@xeon/contracts/extensions";
import type { ExtensionEventKind } from "@xeon/contracts/records";
import { Type, type Static } from "typebox";
import { withoutAmbient } from "./ambient.ts";
import type { CapabilityDefLookup } from "./capability-guard.ts";
import type { HostCore } from "./core.ts";
import { makeDraft } from "./drafts.ts";
import { eachInOrder } from "./sequence.ts";
import { hash12, keyPart } from "./keys.ts";
import { capabilityServiceName } from "./services.ts";

/**
 * 선언 없는 쓰기의 요청 레코드와 워커(ADR-0015 §3.5, M3-REQ-27). [제안] 워커는 X가 소유한다.
 * 소유가 L1 백그라운드 작업으로 바뀌면 `EffectWorkerPort` 구현만 바꾼다.
 *
 * 레코드는 확장 비공개(`recordPrivate`와 같은 공개 범위)이고 kind는 `<x|grp>.<이름>.effect.<requested|started|settled>`다.
 * 영역 `effect`는 X 예약이다. 결과는 요청한 그룹이 `readRecords`로 다음 경계나 on 핸들러에서 읽는다(결과 통지 [제안])
 */
export interface EffectRequest {
  readonly capability: CapabilityId;
  readonly method: string;
  readonly input: JsonValue;
  /** 요청 키. 결정적이어야 하고 같은 scope 안에서 겹치지 않는다. 1~48자 */
  readonly key: string;
}

export const EFFECT_KEY_MAX = 48;

type EffectOutcome =
  /** 메서드가 성공했다 */
  | { readonly kind: "ok"; readonly output: JsonValue }
  /** 메서드가 오류로 거부했거나 공급자가 없다 */
  | { readonly kind: "failed"; readonly code: string; readonly message: string }
  /** `started`만 있고 결과가 없는 채 재시작했고 메서드 `replay`가 `unsafe`라 다시 부르지 않았다 */
  | { readonly kind: "unknown" };

const RequestedSchema = Type.Object({
  key: Type.String(),
  capability: Type.String(),
  method: Type.String(),
  input: Type.Unknown(),
});
const StartedSchema = Type.Object({ key: Type.String() });
const SettledSchema = Type.Object({
  key: Type.String(),
  outcome: Type.Union([
    Type.Object({ kind: Type.Literal("ok"), output: Type.Unknown() }),
    Type.Object({ kind: Type.Literal("failed"), code: Type.String(), message: Type.String() }),
    Type.Object({ kind: Type.Literal("unknown") }),
  ]),
});
type Requested = Static<typeof RequestedSchema>;

export type EffectKindArea = "requested" | "started" | "settled";

export function effectKindOf(
  manifest: { readonly kind: string; readonly name: string },
  area: EffectKindArea,
): ExtensionEventKind {
  return `${manifest.kind === "group" ? "grp" : "x"}.${manifest.name}.effect.${area}`;
}

interface EffectJob {
  readonly threadId: ThreadId;
  readonly scopeId: ScopeId;
  readonly extension: ExtensionName;
  readonly kind: "group" | "plugin";
}

/** 워커 포트. 커밋된 요청을 읽어 실행하는 쪽이 구현한다(기본 구현은 X의 `createEffectWorker`) */
export interface EffectWorkerPort {
  /** 요청이 커밋된 뒤, 또는 thread를 다시 열 때 부른다. 기다리지 않고 돌아온다 */
  schedule(job: EffectJob): void;
}

function isIndexable(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function isMethod(value: unknown): value is (...args: readonly unknown[]) => unknown {
  return typeof value === "function";
}

export function createEffectWorker(core: HostCore, defs: CapabilityDefLookup): EffectWorkerPort {
  const running = new Map<string, "running" | "again">();

  async function call(request: Requested, job: EffectJob): Promise<EffectOutcome> {
    if (!isCapabilityId(request.capability)) {
      return { kind: "failed", code: "invalid_input", message: "capability id is malformed" };
    }
    const service = core.bridge.service(capabilityServiceName(request.capability));
    const method = isIndexable(service) ? service[request.method] : undefined;
    if (!isMethod(method)) {
      return {
        kind: "failed",
        code: "unavailable",
        message: `${request.capability}.${request.method} has no active provider`,
      };
    }
    try {
      const output: unknown = await method.call(service, request.input, {
        requestId: request.key,
        context: {
          threadId: job.threadId,
          caller: { kind: "extension", extension: job.extension },
        },
      });
      return { kind: "ok", output: toJsonValue(output) ?? null };
    } catch (cause) {
      if (cause instanceof CapabilityError) {
        return { kind: "failed", code: cause.data.code, message: cause.data.message };
      }
      return {
        kind: "failed",
        code: "internal",
        message: cause instanceof Error ? cause.message : "effect call threw",
      };
    }
  }

  async function commitMarker(
    job: EffectJob,
    area: EffectKindArea,
    key: string,
    payload: JsonValue,
  ): Promise<boolean> {
    const port = core.ports.get(RecordCommitPortKey);
    if (port === undefined) return false;
    const result = await port.commit({
      threadId: job.threadId,
      requestId: `eff:${hash12(job.scopeId)}:${keyPart(key)}:${area}`,
      visibility: "private",
      drafts: [
        makeDraft(core.deps.ids, {
          threadId: job.threadId,
          kind: effectKindOf({ kind: job.kind, name: job.extension }, area),
          payload,
        }),
      ],
    });
    return result.status !== "rejected";
  }

  async function drainOnce(job: EffectJob): Promise<void> {
    const port = core.ports.get(RecordCommitPortKey);
    if (port === undefined) return;
    const prefix = `${job.kind === "group" ? "grp" : "x"}.${job.extension}.effect.`;
    const queried = await port.queryRecords(
      job.threadId,
      { kind: `${prefix.slice(0, -1)}.*` },
      job.extension,
    );
    if (!queried.ok) {
      core.deps.report({
        level: "warning",
        code: "storage_unavailable",
        scopeId: job.scopeId,
        message: `effect requests of ${job.scopeId} could not be read: ${queried.error.kind}`,
      });
      return;
    }
    const requested: Requested[] = [];
    const started = new Set<string>();
    const settled = new Set<string>();
    for (const row of queried.value) {
      const area = row.kind.slice(prefix.length);
      if (area === "requested") {
        const parsed = parse(RequestedSchema, row.payload);
        if (parsed.ok) requested.push(parsed.value);
      } else if (area === "started") {
        const parsed = parse(StartedSchema, row.payload);
        if (parsed.ok) started.add(parsed.value.key);
      } else if (area === "settled") {
        const parsed = parse(SettledSchema, row.payload);
        if (parsed.ok) settled.add(parsed.value.key);
      }
    }
    await eachInOrder(requested, async (request) => {
      if (settled.has(request.key)) return "continue";
      const capability = isCapabilityId(request.capability) ? request.capability : undefined;
      const replay =
        capability === undefined
          ? undefined
          : defs(capability)?.service.methods[request.method]?.replay;
      let outcome: EffectOutcome;
      if (started.has(request.key) && replay !== "safe") {
        // 시작은 했지만 결과를 못 남기고 끝났다. 효과가 났는지 알 수 없어 다시 부르지 않는다(ADR-0015 §3.5 2번 3)
        outcome = { kind: "unknown" };
      } else {
        if (
          !started.has(request.key) &&
          !(await commitMarker(job, "started", request.key, { key: request.key }))
        ) {
          return "stop";
        }
        outcome = await call(request, job);
      }
      const done = await commitMarker(job, "settled", request.key, { key: request.key, outcome });
      return done ? "continue" : "stop";
    });
  }

  async function drain(job: EffectJob): Promise<void> {
    const key = `${job.threadId}|${job.scopeId}`;
    if (running.has(key)) {
      running.set(key, "again");
      return;
    }
    running.set(key, "running");
    await drainOnce(job);
    const again = running.get(key) === "again";
    running.delete(key);
    if (again) await drain(job);
  }

  return {
    schedule(job) {
      core.track(withoutAmbient(() => drain(job)));
    },
  };
}
