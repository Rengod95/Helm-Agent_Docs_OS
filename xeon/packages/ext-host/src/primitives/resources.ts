import { assertNever, err, ok, type Result } from "@xeon/contracts";
import { TOOL_NAME_WIRE_PATTERN } from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import {
  McpPortKey,
  ModelsPortKey,
  ToolsPortKey,
  type ExtensionName,
  type McpServerResourceDef,
  type PortLookup,
  type ProviderResourceDef,
  type ScopeId,
  type ToolResourceDef,
  type Unsubscribe,
} from "@xeon/contracts/extensions";
import { PrimitiveError, type ExtDiagnostic } from "./errors.ts";

export type {
  McpServerResourceDef,
  ProviderResourceDef,
  ToolResourceDef,
} from "@xeon/contracts/extensions";
export {
  McpPortKey,
  ModelsPortKey,
  ToolsPortKey,
  type McpPort,
  type ModelsPort,
  type ToolsPort,
} from "@xeon/contracts/extensions";

export type ResourceKind =
  | "tool"
  | "command"
  | "shortcut"
  | "flag"
  | "provider"
  | "mcp_server"
  | "message_renderer";

export interface ResourceRecord {
  readonly kind: ResourceKind;
  /** 등록을 요청한 이름 */
  readonly name: string;
  /** 사용자·모델에 보이는 이름. 이름 정책(`ResourcePolicy`)이 정한다. 정책이 없으면 name이다 */
  readonly exposed: string;
  readonly scopeId: ScopeId;
  readonly extension: ExtensionName;
  /** 내장 패키지의 등록인가. 이름 예약 판정에 쓴다(X.operations.spec §4.5 규칙 2) */
  readonly builtin: boolean;
  /** kind별 `*ResourceDef` */
  readonly def: unknown;
}

/** `ResourcePolicy.exposeAll`이 레코드마다 돌려주는 노출 이름. 레코드는 (kind, scopeId, name)으로 가리킨다 */
export interface ResourceExposure {
  readonly kind: ResourceKind;
  readonly scopeId: ScopeId;
  readonly name: string;
  readonly exposed: string;
  /** 짧은 이름을 받지 못한 이유. too_long이면 등록을 거부한다 */
  readonly reason?: "reserved" | "conflict" | "too_long";
}

/** X.operations가 구현한다(X.primitives.spec §3.9, X.operations.spec §3.5) */
export interface ResourcePolicy {
  /** 같은 kind·노출 이름이 이미 있을 때의 쌍 판정 */
  resolve(
    incoming: ResourceRecord,
    existing: ResourceRecord,
  ):
    | { readonly action: "reject" }
    | { readonly action: "replace" }
    | { readonly action: "rename"; readonly name: string };
  /**
   * 선택. 같은 kind의 전체 집합에서 노출 이름을 다시 정한다. 있으면 레지스트리는 쌍 판정 대신 이것을 쓴다.
   * 결과는 입력 순서와 무관해야 하고(X.operations.spec §4.5 규칙 3) 레코드마다 하나씩 돌려준다
   */
  exposeAll?(records: readonly ResourceRecord[]): readonly ResourceExposure[];
}

export interface CommandResourceDef {
  readonly description?: string;
  handler(
    args: string,
    ctx: {
      readonly threadId: ThreadId | null;
      /** 명령 호출 하나의 id. threadId가 있으면 X가 멱등 키의 디스패치 키로 쓴다(M3-REQ-102). 같은 호출을 다시 실행하면 같은 값을 넘긴다 */
      readonly invocationId: string;
    },
  ): Promise<void>;
}
export interface ShortcutResourceDef {
  readonly description?: string;
  handler(ctx: { readonly threadId: ThreadId | null }): Promise<void>;
}
export interface FlagResourceDef {
  readonly description?: string;
  readonly type: "boolean" | "string";
  readonly default?: boolean | string;
}
/** L4가 해석한다 [제안] */
export interface RendererResourceDef {
  readonly module: string;
  readonly export: string;
}

export type FlagValueError =
  | { readonly kind: "unknown_flag"; readonly name: string }
  | {
      readonly kind: "type_mismatch";
      readonly name: string;
      readonly expected: "boolean" | "string";
    };

/** L4가 읽는다. command, shortcut, flag, message_renderer는 X가 보관하고 나머지는 포트로 넘긴 기록만 보관한다 */
export interface ResourceRegistry {
  list(kind?: ResourceKind): readonly ResourceRecord[];
  subscribe(
    listener: (change: {
      readonly type: "added" | "removed";
      readonly record: ResourceRecord;
    }) => void,
  ): Unsubscribe;
  /**
   * L4가 CLI 인자 해석 결과를 넘긴다 [제안]. exposed는 `ResourceRecord.exposed`다.
   * `hostOf(g).getFlag(name)`이 이 값을 돌려준다
   */
  setFlag(exposed: string, value: boolean | string | undefined): Result<void, FlagValueError>;
}

/** 이름 정책이 정식 이름을 만들 수 있는 종류. 나머지는 같은 이름이면 거부한다(X.operations.spec §4.5 규칙 9) */
const GOVERNED: ReadonlySet<ResourceKind> = new Set(["tool", "command", "shortcut", "flag"]);

const TOOL_NAME_REGEX = new RegExp(TOOL_NAME_WIRE_PATTERN);
const MAX_NAME_LENGTH = 64;

/** 공백이나 제어 문자가 하나라도 있는가 */
function hasBlankOrControl(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f || /\s/u.test(ch)) return true;
  }
  return false;
}

/** 한 scope가 등록하는 리소스 하나의 정보와 포트 연결 */
export interface ResourceSpec {
  readonly kind: ResourceKind;
  readonly name: string;
  readonly scopeId: ScopeId;
  readonly extension: ExtensionName;
  readonly builtin: boolean;
  readonly def: unknown;
}

export interface ResourceStore extends ResourceRegistry {
  /**
   * 리소스를 등록한다. 돌려주는 함수가 등록을 해제한다(멱등). 이름 충돌은 `resource_conflict`,
   * 이름 형식 위반은 `resource_name_invalid`, 대상 포트가 없으면 `port_unavailable`이다
   */
  add(spec: ResourceSpec): Result<() => void, PrimitiveError>;
  /** 이 scope가 등록한 flag의 현재 값. L4가 정한 값이 없으면 선언의 기본값 */
  flagValue(scopeId: ScopeId, name: string): boolean | string | undefined;
}

interface Entry {
  record: ResourceRecord;
  /** 포트에 건 등록 해제. 포트가 없는 종류는 NOOP */
  unbind: () => void;
}

const NOOP = (): void => {};

function keyOf(kind: ResourceKind, scopeId: ScopeId, name: string): string {
  return `${kind}\u0000${scopeId}\u0000${name}`;
}

function nameProblem(kind: ResourceKind, name: string): string | undefined {
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    return `a ${kind} name must be 1..${MAX_NAME_LENGTH} characters`;
  }
  if (hasBlankOrControl(name))
    return `a ${kind} name cannot contain whitespace or control characters`;
  if (kind === "tool" && !TOOL_NAME_REGEX.test(name)) {
    return `a tool name must match ${TOOL_NAME_WIRE_PATTERN}`;
  }
  return undefined;
}

export interface ResourceStoreDeps {
  readonly ports: PortLookup;
  readonly policy: ResourcePolicy | undefined;
  readonly report: (diagnostic: ExtDiagnostic) => void;
}

export function createResourceStore(deps: ResourceStoreDeps): ResourceStore {
  const entries = new Map<string, Entry>();
  const flagValues = new Map<string, boolean | string>();
  const listeners = new Set<
    (change: { readonly type: "added" | "removed"; readonly record: ResourceRecord }) => void
  >();

  function emit(type: "added" | "removed", record: ResourceRecord): void {
    for (const listener of listeners) {
      try {
        listener({ type, record });
      } catch (cause) {
        deps.report({
          level: "error",
          code: "handler_failed",
          scopeId: record.scopeId,
          extension: record.extension,
          message: "a ResourceRegistry listener threw",
          cause,
        });
      }
    }
  }

  function recordsOf(kind: ResourceKind): ResourceRecord[] {
    return [...entries.values()].map((entry) => entry.record).filter((r) => r.kind === kind);
  }

  /** 레코드의 종류에 맞는 포트에 등록한다. 해제 함수를 돌려준다 */
  function bind(record: ResourceRecord): Result<() => void, PrimitiveError> {
    switch (record.kind) {
      case "tool": {
        const port = deps.ports.get(ToolsPortKey);
        if (port === undefined) return err(portMissing("xeon.tools", record.scopeId));
        // 정의의 이름은 노출 이름으로 바꿔 넘긴다. 메서드는 원본 객체를 그대로 부른다
        const original = toolDefOf(record.def);
        if (original === undefined) return ok(NOOP);
        const registered = port.register(record.scopeId, {
          name: record.exposed,
          description: original.description,
          parameters: original.parameters,
          replay: original.replay,
          ...(original.risk === undefined ? {} : { risk: original.risk }),
          ...(original.hints === undefined ? {} : { hints: original.hints }),
          execute: (args, ctx) => original.execute(args, ctx),
        });
        if (!registered.ok) {
          return err(
            new PrimitiveError(
              "resource_conflict",
              `tool ${record.exposed} is already registered in xeon.tools`,
              { scopeId: record.scopeId },
            ),
          );
        }
        return ok(registered.value);
      }
      case "provider": {
        const port = deps.ports.get(ModelsPortKey);
        if (port === undefined) return err(portMissing("xeon.models", record.scopeId));
        const config = providerDefOf(record.def);
        return ok(port.registerProvider(record.scopeId, record.exposed, config));
      }
      case "mcp_server": {
        const port = deps.ports.get(McpPortKey);
        if (port === undefined) return err(portMissing("xeon.mcp", record.scopeId));
        const config = mcpDefOf(record.def);
        return ok(port.registerServer(record.scopeId, record.exposed, config));
      }
      case "command":
      case "shortcut":
      case "flag":
      case "message_renderer":
        return ok(NOOP);
      default:
        return assertNever(record.kind, "ResourceKind");
    }
  }

  /** 노출 이름이 바뀐 기존 레코드를 새 이름으로 다시 건다. 포트가 거부하면 옛 이름을 유지하고 진단한다 */
  function rename(entry: Entry, exposed: string): void {
    if (entry.record.exposed === exposed) return;
    const next: ResourceRecord = { ...entry.record, exposed };
    entry.unbind();
    const rebound = bind(next);
    if (!rebound.ok) {
      const restored = bind(entry.record);
      entry.unbind = restored.ok ? restored.value : NOOP;
      deps.report({
        level: "warning",
        code: "resource_conflict",
        scopeId: entry.record.scopeId,
        extension: entry.record.extension,
        message: `could not expose ${entry.record.kind} ${entry.record.name} as ${exposed}: ${rebound.error.message}`,
      });
      return;
    }
    const previous = entry.record;
    entry.record = next;
    entry.unbind = rebound.value;
    emit("removed", previous);
    emit("added", next);
  }

  /**
   * 정책의 집합 판정을 같은 종류 전체에 적용한다. 변경이 있으면 기존 레코드의 노출 이름을 바꾼다.
   * extra(아직 등록하지 않은 들어오는 레코드)가 있으면 집합에 함께 넣어 판정하고 그 노출 이름을 돌려준다.
   * 들어오는 레코드를 거부해야 하면(too_long) 기존 레코드는 건드리지 않는다
   */
  function reexpose(kind: ResourceKind, extra?: ResourceRecord): ResourceExposure | undefined {
    const policy = deps.policy;
    if (policy?.exposeAll === undefined || !GOVERNED.has(kind)) return undefined;
    const records = recordsOf(kind);
    const exposures = policy.exposeAll(extra === undefined ? records : [...records, extra]);
    const mine =
      extra === undefined
        ? undefined
        : exposures.find(
            (exposure) =>
              exposure.kind === extra.kind &&
              exposure.scopeId === extra.scopeId &&
              exposure.name === extra.name,
          );
    if (mine?.reason === "too_long") return mine;
    for (const exposure of exposures) {
      if (exposure === mine) continue;
      const entry = entries.get(keyOf(exposure.kind, exposure.scopeId, exposure.name));
      if (entry !== undefined) rename(entry, exposure.exposed);
    }
    return mine;
  }

  function remove(key: string): void {
    const entry = entries.get(key);
    if (entry === undefined) return;
    entries.delete(key);
    entry.unbind();
    flagValues.delete(key);
    emit("removed", entry.record);
    reexpose(entry.record.kind);
  }

  return {
    list(kind) {
      const all = [...entries.values()].map((entry) => entry.record);
      return kind === undefined ? all : all.filter((record) => record.kind === kind);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setFlag(exposed, value) {
      const found = recordsOf("flag").find((record) => record.exposed === exposed);
      if (found === undefined) return err({ kind: "unknown_flag", name: exposed });
      const key = keyOf("flag", found.scopeId, found.name);
      if (value === undefined) {
        flagValues.delete(key);
        return ok(undefined);
      }
      const expected = flagDefOf(found.def)?.type ?? "string";
      if (typeof value !== expected) return err({ kind: "type_mismatch", name: exposed, expected });
      flagValues.set(key, value);
      return ok(undefined);
    },
    flagValue(scopeId, name) {
      const key = keyOf("flag", scopeId, name);
      return flagValues.get(key) ?? flagDefOf(entries.get(key)?.record.def)?.default;
    },
    add(spec) {
      const problem = nameProblem(spec.kind, spec.name);
      if (problem !== undefined) {
        return err(new PrimitiveError("resource_name_invalid", problem, { scopeId: spec.scopeId }));
      }
      const key = keyOf(spec.kind, spec.scopeId, spec.name);
      if (entries.has(key)) {
        return err(
          new PrimitiveError(
            "resource_conflict",
            `${spec.scopeId} already registered ${spec.kind} ${spec.name}`,
            { scopeId: spec.scopeId },
          ),
        );
      }
      let record: ResourceRecord = { ...spec, exposed: spec.name };
      const sameKind = recordsOf(spec.kind);
      const policy = deps.policy;
      let setLevel = false;
      if (policy?.exposeAll !== undefined && GOVERNED.has(spec.kind)) {
        setLevel = true;
        const mine = reexpose(spec.kind, record);
        if (mine?.reason === "too_long") {
          return err(
            new PrimitiveError(
              "resource_name_invalid",
              `${spec.kind} ${spec.name} of ${spec.extension} is too long to expose`,
              { scopeId: spec.scopeId },
            ),
          );
        }
        if (mine !== undefined) record = { ...record, exposed: mine.exposed };
      } else {
        const clash = sameKind.find((other) => other.exposed === record.exposed);
        if (clash !== undefined) {
          const decision =
            policy === undefined ? ({ action: "reject" } as const) : policy.resolve(record, clash);
          if (decision.action === "reject") {
            return err(
              new PrimitiveError(
                "resource_conflict",
                `${spec.kind} ${record.exposed} is already registered by ${clash.scopeId}`,
                { scopeId: spec.scopeId },
              ),
            );
          }
          if (decision.action === "rename") {
            const renamed: ResourceRecord = { ...record, exposed: decision.name };
            if (sameKind.some((other) => other.exposed === renamed.exposed)) {
              return err(
                new PrimitiveError(
                  "resource_conflict",
                  `${spec.kind} ${renamed.exposed} is already registered`,
                  { scopeId: spec.scopeId },
                ),
              );
            }
            record = renamed;
          } else {
            remove(keyOf(clash.kind, clash.scopeId, clash.name));
          }
        }
      }
      const bound = bind(record);
      if (!bound.ok) {
        // 앞서 기존 레코드의 이름을 바꿨다면 들어오는 레코드가 없는 집합으로 되돌린다
        if (setLevel) reexpose(spec.kind);
        return bound;
      }
      const entry: Entry = { record, unbind: bound.value };
      entries.set(key, entry);
      emit("added", record);
      let released = false;
      return ok(() => {
        if (released) return;
        released = true;
        remove(key);
      });
    },
  };
}

function portMissing(name: string, scopeId: ScopeId): PrimitiveError {
  return new PrimitiveError("port_unavailable", `port ${name} is not provided`, { scopeId });
}

// def는 ResourceRecord에서 unknown으로 보관한다. kind별로 등록 때 받은 모양으로 좁힌다

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function toolDefOf(def: unknown): ToolResourceDef | undefined {
  return isToolDef(def) ? def : undefined;
}

function isToolDef(def: unknown): def is ToolResourceDef {
  return (
    isObject(def) &&
    typeof def["name"] === "string" &&
    typeof def["description"] === "string" &&
    typeof def["execute"] === "function"
  );
}

function providerDefOf(def: unknown): ProviderResourceDef {
  return isJson(def) ? def : null;
}

function mcpDefOf(def: unknown): McpServerResourceDef {
  return isJson(def) ? def : null;
}

function isJson(value: unknown): value is ProviderResourceDef {
  return value === null || ["string", "number", "boolean", "object"].includes(typeof value);
}

function flagDefOf(def: unknown): FlagResourceDef | undefined {
  return isObject(def) && (def["type"] === "boolean" || def["type"] === "string")
    ? { type: def["type"], ...flagDefault(def) }
    : undefined;
}

function flagDefault(def: Readonly<Record<string, unknown>>): { default?: boolean | string } {
  const value = def["default"];
  return typeof value === "boolean" || typeof value === "string" ? { default: value } : {};
}
