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
   * undefined이고, 그러면 실린 모든 외부 도구가 보인다
   */
  readonly pluginsOf: (threadId: ThreadId) => readonly string[] | undefined;
  readonly reserved?: ReservedNames;
}

/**
 * 대화별 도구 이름 규칙을 만든다. 내장 도구는 E(T)에 이름이 없어도 늘 보인다(코어가 이름 없이 싣는 내장 확장이 있다).
 * 외부 플러그인과 드래프트의 도구는 그 확장 이름이 E(T)에 있을 때만 보인다. 드래프트의 이름은 승인됐을 때와 같도록 실제 플러그인 이름으로 센다.
 * 한 대화에서 드래프트와 승인본은 함께 실리지 않으므로(E(T)가 같은 이름의 승인본을 뺀다) 서로 충돌로 세지 않는다
 */
export function createToolExposureOf(
  deps: ToolExposureDeps,
): (threadId: ThreadId | null) => ToolExposure | undefined {
  const reserved = deps.reserved ?? NO_RESERVED;
  return (threadId) => {
    const plugins = threadId === null ? undefined : deps.pluginsOf(threadId);
    const inSet = plugins === undefined ? undefined : new Set(plugins);
    const inputs: ToolNameInput[] = [];
    for (const record of deps.toolRecords()) {
      if (record.replaces !== undefined) continue;
      if (!record.builtin && inSet !== undefined && !inSet.has(record.extension)) continue;
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
