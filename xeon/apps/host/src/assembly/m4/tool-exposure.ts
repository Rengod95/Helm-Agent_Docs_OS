import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ToolExposure } from "@fresnel/core-tools";
import {
  exposeToolNames,
  toolNameKey,
  type ReservedNames,
  type ResourceRecord,
  type ToolNameInput,
} from "@fresnel/ext-host";

// L1.tools.spec §3.3.1, X.operations.spec §4.5.1 [결정: 2026-11-19, 사용자, AGE-56]: 대화가 보는 도구 이름과 가시성.
// 도구 포트에 `perThread`로 등록된 확장 도구마다, 이 대화가 그 확장을 실었는지(E(T))와 이 대화에서 보이는 이름을 정한다.

/** 조립은 예약 이름이 없다(내장 도구의 등록만 짧은 이름을 지킨다) */
const NO_RESERVED: ReservedNames = {
  tool: new Set(),
  command: new Set(),
  shortcut: new Set(),
  flag: new Set(),
};

export interface ToolExposureDeps {
  /** 등록된 도구 레코드(`ExtHost.resources.list("tool")`) */
  readonly toolRecords: () => readonly ResourceRecord[];
  /** 확장 이름이 로더가 싣은 드래프트의 내부 이름이면 그 실제 플러그인 이름. 아니면 undefined */
  readonly realNameOf: (extension: string) => string | undefined;
  /**
   * 대화가 실은 플러그인 이름(E(T)). 하위 대화는 맨 위 부모의 것을 쓴다. 읽을 수 없으면(대화가 아니거나 복사를 아직 못 읽었거나 엔진 포트가 뜨기 전)
   * undefined다. 읽지 못함(undefined)과 빈 집합(`[]`)은 다르다: 빈 집합은 외부 도구를 하나도 싣지 않은 대화이고, 읽지 못함은 알 수 없는 대화다.
   * 알 수 없는 대화에는 내장 도구만 보인다(드래프트와 검토 전 코드의 도구가 일반 대화에 광고되지 않도록 닫는다)
   */
  readonly pluginsOf: (threadId: ThreadId) => readonly string[] | undefined;
  readonly reserved?: ReservedNames;
}

/**
 * 대화별 도구 이름 규칙을 만든다. 내장 도구는 E(T)에 이름이 없어도 늘 보인다(코어가 이름 없이 싣는 내장 확장이 있다).
 * 외부 플러그인과 드래프트의 도구는 그 확장 이름이 E(T)에 있을 때만 보이고, E(T)를 읽지 못하면 하나도 보이지 않는다. 드래프트의 이름은 승인됐을 때와 같도록 실제 플러그인 이름으로 센다.
 * 한 대화에서 드래프트와 승인본은 함께 실리지 않으므로(E(T)가 같은 이름의 승인본을 뺀다) 서로 충돌로 세지 않는다
 */
export function createToolExposureOf(
  deps: ToolExposureDeps,
): (threadId: ThreadId | null) => ToolExposure | undefined {
  const reserved = deps.reserved ?? NO_RESERVED;
  return (threadId) => {
    const plugins = threadId === null ? undefined : deps.pluginsOf(threadId);
    // 읽지 못하면 빈 집합으로 센다: 내장 도구만 남는다
    const inSet = new Set(plugins ?? []);
    const inputs: ToolNameInput[] = [];
    for (const record of deps.toolRecords()) {
      if (record.replaces !== undefined) continue;
      if (!record.builtin && !inSet.has(record.extension)) continue;
      inputs.push({
        scopeId: record.scopeId,
        owner: deps.realNameOf(record.extension) ?? record.extension,
        name: record.name,
        builtin: record.builtin,
      });
    }
    const names = exposeToolNames(inputs, reserved);
    return { nameOf: (owner, requested) => names.get(toolNameKey(owner, requested)) ?? null };
  };
}

export interface ToolPluginsOfDeps {
  /** 엔진 포트가 떠 있고 프로필 복사를 읽었는가. 아니면 어떤 대화도 E(T)를 읽을 수 없다 */
  readonly ready: () => boolean;
  /** 대화 id인가 */
  readonly isThread: (id: string) => id is ThreadId;
  /** 하위 대화의 부모. 부모가 없으면 undefined(맨 위 대화), 조회가 실패하면 null(읽을 수 없음) */
  readonly parentOf: (threadId: ThreadId) => ThreadId | undefined | null;
  /** 대화 하나의 E(T) */
  readonly resolve: (threadId: ThreadId) => readonly string[];
}

/** 부모 사슬을 따라 오르는 한도 */
const PARENT_DEPTH = 16;

/**
 * 대화가 실은 플러그인 이름(E(T))을 읽는다. 하위 대화는 맨 위 부모의 집합을 쓴다.
 * 엔진 포트가 아직 없거나, 프로필 복사를 읽지 못했거나(그때 `resolve`는 등록된 모든 확장을 돌려 드래프트도 든다), 대화 id가 아니거나,
 * 부모 조회가 실패하거나, 사슬이 한도를 넘으면 undefined(읽지 못함)다
 */
export function createToolPluginsOf(
  deps: ToolPluginsOfDeps,
): (threadId: string) => readonly string[] | undefined {
  return (threadId) => {
    if (!deps.ready()) return undefined;
    let top = threadId;
    for (let depth = 0; depth < PARENT_DEPTH; depth += 1) {
      if (!deps.isThread(top)) return undefined;
      const parent = deps.parentOf(top);
      if (parent === null) return undefined;
      if (parent === undefined) return deps.resolve(top);
      top = parent;
    }
    return undefined;
  };
}

/**
 * 대화가 보는 도구 이름으로 그 도구를 등록한 레코드를 찾는다. 같은 이름의 도구가 여러 주인에게 있어도 이 대화가 보는 쪽만 고른다.
 * 대화가 보지 못하는 도구의 이름은 찾지 못한다
 */
export function createToolOwnerIn(
  deps: Pick<ToolExposureDeps, "toolRecords" | "realNameOf"> & {
    readonly exposureOf: (threadId: ThreadId | null) => ToolExposure | undefined;
  },
): (name: string, threadId: ThreadId) => ResourceRecord | undefined {
  return (name, threadId) => {
    const exposure = deps.exposureOf(threadId);
    if (exposure === undefined) return undefined;
    return deps.toolRecords().find((record) => {
      if (record.replaces !== undefined) return false;
      const owner = deps.realNameOf(record.extension) ?? record.extension;
      return exposure.nameOf(owner, record.name) === name;
    });
  };
}

/** 대화별 도구 가시성: 도구 연결의 이름 규칙과 승격 집계의 도구 주인 조회. 둘이 같은 규칙을 쓴다 */
export interface ToolVisibility {
  readonly exposureOf: (threadId: ThreadId | null) => ToolExposure | undefined;
  readonly toolOwnerIn: (name: string, threadId: ThreadId) => ResourceRecord | undefined;
}

export function createToolVisibility(deps: ToolExposureDeps): ToolVisibility {
  const exposureOf = createToolExposureOf(deps);
  return { exposureOf, toolOwnerIn: createToolOwnerIn({ ...deps, exposureOf }) };
}
