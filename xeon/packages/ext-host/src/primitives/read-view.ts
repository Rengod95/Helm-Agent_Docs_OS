import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  PluginSetPortKey,
  type HookName,
  type RegistrationId,
  type RegistrationStatus,
} from "@fresnel/contracts/extensions";
import { sortEntries } from "./dispatch.ts";
import { hostInternalsOf, type ExtHost } from "./host.ts";
import type { HandlerEntry } from "./registry.ts";

/** 호스트 핸들러 레지스트리의 행 하나. 같은 훅 안의 순서는 디스패치 순서다(기본 정렬 뒤 순서 덮어쓰기를 적용한다) */
export interface HookHandlerView {
  readonly point: HookName;
  readonly scopeId: RegistrationId;
  readonly extension: string;
  readonly tier: number;
  readonly loadIndex: number;
  readonly seq: number;
}

/** 지금 바인딩된 기능 공급자 하나(X.primitives.spec §3.7) */
export interface BoundCapabilityView {
  readonly capability: string;
  /** 공급 확장 이름 */
  readonly provider: string;
  readonly version: string;
}

/** 조립 루트가 wire 확장 읽기(`ext.list`)에 쓰는 읽기 전용 조회. 주도권 스택 읽기는 `ExtHost.driveFrames`다 */
export interface ExtReadView {
  /**
   * 그 thread에서의 Registration 상태. thread가 열려 있지 않거나 모르는 Registration이면 undefined.
   * 켜져 있고 요청도 켜짐이면 enabled, 꺼져 있고 요청도 꺼짐이면 disabled, 둘이 다르면 enabling·disabling이다
   */
  threadStatus(threadId: ThreadId, scopeId: RegistrationId): RegistrationStatus | undefined;
  /**
   * 레지스트리에 실제로 등록된 핸들러 전부를, 훅별로 모아 디스패치 순서로 돌려준다.
   * 디스패치 순서 = 기본 정렬(tier, loadIndex, seq, F.extensions.spec §4.2) 뒤에 순서 덮어쓰기를 적용한 순서다. 덮어쓰기가 없으면 guard tier가 앞이고, guard도 덮어쓰기로 옮길 수 있다.
   * 훅 순서는 훅 이름 오름차순이다. 꺼진 scope의 핸들러도 있다(디스패치는 `isOpen`으로 거르고 이 조회는 거르지 않는다)
   */
  handlers(threadId?: ThreadId): readonly HookHandlerView[];
  /** 지금 바인딩된 기능 공급자. 기능 id 오름차순 */
  boundCapabilities(): readonly BoundCapabilityView[];
}

/** 내부는 부를 때 얻는다. `createExtHost`가 만들지 않은 대역 ExtHost로도 만들 수 있게 한다(`traceReadOf`와 같다) */
export function extReadViewOf(host: ExtHost): ExtReadView {
  return {
    handlers(threadId) {
      const { core } = hostInternalsOf(host);
      const pluginOrder =
        threadId === undefined
          ? undefined
          : core.ports.get(PluginSetPortKey)?.resolve(threadId).plugins;
      const { policy } = core.deps;
      const byHook = new Map<HookName, HandlerEntry[]>();
      for (const entry of core.registry.entries()) {
        const list = byHook.get(entry.point) ?? [];
        list.push(entry);
        byHook.set(entry.point, list);
      }
      return [...byHook.keys()]
        .toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .flatMap((point) =>
          sortEntries(byHook.get(point) ?? [], point, policy, pluginOrder).map((entry) => ({
            point: entry.point,
            scopeId: entry.scopeId,
            extension: entry.extension,
            tier: policy.tierOf(entry),
            loadIndex: entry.loadIndex,
            seq: entry.seq,
          })),
        );
    },
    boundCapabilities() {
      return hostInternalsOf(host)
        .bound()
        .map((item) => ({ capability: item.id, provider: item.provider, version: item.version }))
        .toSorted((a, b) =>
          a.capability < b.capability ? -1 : a.capability > b.capability ? 1 : 0,
        );
    },
    threadStatus(threadId, scopeId) {
      const { core } = hostInternalsOf(host);
      const thread = core.threads.get(threadId);
      const record = core.scopes.get(scopeId);
      if (thread === undefined || record === undefined) return undefined;
      const running = thread.active.has(scopeId);
      const wanted = thread.want.get(scopeId)?.enabled ?? record.desired;
      if (running) return wanted ? "enabled" : "disabling";
      return wanted ? "enabling" : "disabled";
    },
  };
}
