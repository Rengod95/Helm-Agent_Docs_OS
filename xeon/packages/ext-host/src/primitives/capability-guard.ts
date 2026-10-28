import {
  CapabilityError,
  type AnyCapabilityDef,
  type CallOptions,
  type CapabilityId,
  type MethodDef,
} from "@xeon/contracts/capabilities";
import {
  capabilityEffectOf,
  isEffectAllowed,
  REPLAY_EFFECT_TABLE,
  type ExtensionName,
  type ReplayContext,
  type ReplayEffect,
  type ScopeId,
} from "@xeon/contracts/extensions";
import { ambient, type Ambient } from "./ambient.ts";
import { hash12 } from "./keys.ts";

/**
 * 능력 id로 정의를 찾는다. `g.capability`가 돌려주는 서비스는 호출 때 메서드의 효과 분류(`idempotent`, `readOnly`)를 알아야 하는데
 * `ServiceKey`는 id와 버전만 싣는다. 그래서 조립 루트가 정의 표를 `ExtHostDeps.capabilityDefs`로 넘긴다(X.primitives.spec §4.4.7).
 * 정의를 못 찾으면 그 능력의 모든 메서드를 선언 없음으로 본다(재실행되는 코드에서는 거부)
 */
export type CapabilityDefLookup = (id: CapabilityId) => AnyCapabilityDef | undefined;

/** 정의 목록으로 조회 함수를 만든다. 같은 id가 여럿이면 뒤의 것이 이긴다 */
export function capabilityDefTable(defs: readonly AnyCapabilityDef[]): CapabilityDefLookup {
  const byId = new Map(defs.map((def) => [def.id, def]));
  return (id) => byId.get(id);
}

const NO_DEFS: CapabilityDefLookup = () => undefined;
export const EMPTY_CAPABILITY_DEFS: CapabilityDefLookup = NO_DEFS;

export interface GuardTarget {
  readonly id: CapabilityId;
  /** 공급자 서비스 객체. 메서드가 함수 값인 객체다 */
  readonly service: unknown;
  readonly defs: CapabilityDefLookup;
  readonly extension: ExtensionName;
  readonly scopeId: ScopeId;
}

type AnyMethod = (...args: readonly unknown[]) => unknown;

function isIndexable(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function isMethod(value: unknown): value is AnyMethod {
  return typeof value === "function";
}

/** `requestId` 길이 규칙(F.capabilities.spec §3.1) */
const REQUEST_ID_MAX = 64;

/** 재실행되는 문맥. 맥락이 없으면(setup, 명령 처리기, 도구 execute) 재실행되지 않으므로 null */
function replayContextOf(amb: Ambient | undefined): ReplayContext | null {
  if (amb === undefined) return null;
  return amb.drive === null ? "on" : "drive";
}

/**
 * drive 안 `idempotent` 쓰기의 기본 `requestId` [제안, ADR-0015 §6 미결 "drive의 idempotent 쓰기에 기본 키"].
 * ADR §3.4 3번 문장은 명시 키만 받는다고 적는다. 이 구현은 임대 차수(`leaseEpoch`)와 호출 시작 판·일련번호를 키로 준다.
 * 임대 차수는 `lease.acquired.leaseEpoch`로 커밋되고 재개 때 같은 임대가 같은 차수로 이어지므로 같은 상태 판의 재호출은 같은 키를 낸다.
 * scope id는 해시로 넣어 다른 scope의 키와 섞이지 않게 한다
 */
function defaultDriveRequestId(scopeId: ScopeId, drive: NonNullable<Ambient["drive"]>): string {
  const n = drive.i;
  drive.i += 1;
  return `cap:${hash12(scopeId)}:${drive.leaseEpoch}:${drive.baseRev}.${n}`;
}

function refuse(
  id: CapabilityId,
  method: string,
  code: "effect_not_allowed" | "invalid_input",
  message: string,
): Promise<never> {
  return Promise.reject(
    new CapabilityError({ capability: id, method, code, message, retryable: false }),
  );
}

function effectLabel(effect: ReplayEffect): string {
  const row = REPLAY_EFFECT_TABLE[effect];
  return `${effect} (on ${row.on}, drive ${row.drive})`;
}

/**
 * 능력 서비스를 감싼다(ADR-0015 §3.1 2번, §3.2). on 핸들러와 drive 함수 안의 호출만 검사한다.
 * 효과 분류는 정의의 메서드 선언에서 온다. 거부는 서비스 메서드의 실패 규약대로 `CapabilityError`(코드 `effect_not_allowed`)로
 * 거부(reject)하고 공급자를 부르지 않는다. 검사를 통과한 호출에는 호출 문맥(`CallOptions.context`)을 채운다
 */
export function guardCapabilityService(target: GuardTarget): Readonly<Record<string, unknown>> {
  const { id, service, defs } = target;
  const def = defs(id);
  if (!isIndexable(service)) return {};
  const names = def === undefined ? Object.keys(service) : Object.keys(def.service.methods);
  const wrapped: [string, AnyMethod][] = [];
  for (const name of names) {
    const method = service[name];
    if (!isMethod(method)) continue;
    const decl: MethodDef | undefined = def?.service.methods[name];
    const effect: ReplayEffect =
      decl === undefined ? "capability.undeclared" : capabilityEffectOf(decl);
    wrapped.push([
      name,
      (input, options) => {
        const given: CallOptions | undefined = isIndexable(options) ? options : undefined;
        const amb = ambient();
        const context = replayContextOf(amb);
        let requestId = given?.requestId;
        if (context !== null) {
          if (!isEffectAllowed(effect, context)) {
            return refuse(
              id,
              name,
              "effect_not_allowed",
              `${id}.${name} is ${effectLabel(effect)}; it cannot run in a ${context === "on" ? "handler" : "drive function"} that may be replayed`,
            );
          }
          if (effect === "capability.idempotent" && requestId === undefined) {
            const drive = amb?.drive;
            requestId =
              context === "drive" && drive !== undefined && drive !== null
                ? defaultDriveRequestId(target.scopeId, drive)
                : undefined;
            if (requestId === undefined) {
              return refuse(
                id,
                name,
                "invalid_input",
                `${id}.${name} is idempotent and needs an explicit requestId when called from a handler`,
              );
            }
          }
          if (
            requestId !== undefined &&
            (requestId.length < 1 || requestId.length > REQUEST_ID_MAX)
          ) {
            return refuse(id, name, "invalid_input", `requestId must be 1-${REQUEST_ID_MAX} chars`);
          }
        }
        const merged: CallOptions = {
          ...given,
          ...(requestId === undefined ? {} : { requestId }),
          context: {
            ...(amb === undefined ? {} : { threadId: amb.threadId }),
            caller: { kind: "extension", extension: target.extension },
          },
        };
        return method.call(service, input, merged);
      },
    ]);
  }
  return Object.fromEntries(wrapped);
}
