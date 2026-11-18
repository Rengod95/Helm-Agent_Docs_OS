import { join } from "node:path";
import { err, ok, parse, type Logger, type Result } from "@fresnel/contracts";
import {
  isId,
  type ContextRef,
  type CraftChatSummary,
  type ThreadId,
} from "@fresnel/contracts/conversation";
import type { CraftContextError } from "@fresnel/contracts/extensions";
import {
  CraftContextPayloadSchema,
  type CraftContextPayload,
  type CraftPluginError,
  type DurableEventEnvelope,
  type ReadFailure,
} from "@fresnel/contracts/records";

// 테스트 대화(Craft)의 호스트 쪽 두 가지(M5c §4.8.2, §4.8.7, §4.9.1). 둘 다 작은 값 계산이고 저장소는 주입받는다.
// 1) 플러그인 원본 폴더: `<설정 폴더>/plugins/<이름>`. 사용자 플러그인 폴더(`discover.ts`)와 같은 자리다.
// 2) 초안을 만들면 그 대화를 초안의 플러그인에 한 번 묶는다. 이미 묶였거나 테스트 대화가 아니면 아무것도 쓰지 않는다.

/** 테스트 대화를 찾고 묶는 데 쓰는 세션 원천의 좁은 모양(시험이 가짜로 바꿔 끼운다) */
export interface CraftChatStore {
  /** 대화의 표지. 대화가 없으면 undefined, 표지가 없으면 `craftChat`이 없다 */
  readonly thread: (
    threadId: ThreadId,
  ) => Result<{ readonly craftChat?: CraftChatSummary } | undefined, unknown>;
  /** 쓰기 소유자가 부른다. 같은 이름은 아무것도 쓰지 않고, 다른 이름은 거절한다 */
  readonly setCraftPlugin: (
    threadId: ThreadId,
    plugin: string,
    requestKey: string,
  ) => Result<void, CraftPluginError>;
  /** 맥락 참조 사건(`craft.context`)을 남긴다. 쓰기 소유자가 부른다 */
  readonly recordCraftContext: (
    threadId: ThreadId,
    payload: CraftContextPayload,
    requestKey: string,
  ) => Result<void, CraftPluginError>;
  /** 대화의 `craft.context` 사건을 기록 순서대로 읽는다(모든 가지). 읽기 실패는 값이다 */
  readonly readContextEvents: (
    threadId: ThreadId,
  ) => Promise<Result<readonly DurableEventEnvelope[], ReadFailure>>;
}

export interface CraftChatPortDeps {
  /** 설정 폴더(`OsDirs.config`). 플러그인 원본은 그 아래 `plugins/<이름>`이다 */
  readonly configDir: string;
  readonly store: CraftChatStore;
  /** 요청 키 발급(이벤트 id 접두). 묶기 한 번마다 새 키다 */
  readonly nextKey: () => string;
  readonly logger: Logger;
}

export interface CraftChatPort {
  /** 플러그인 원본 폴더의 경로. 폴더가 있는지는 보지 않는다 */
  folderOf(plugin: string): string;
  /**
   * 초안이 만들어졌다. `originThreadId`가 묶이지 않은 테스트 대화면 초안의 플러그인에 한 번 묶는다.
   * 다른 경우(대화 없음, 일반 대화, 이미 묶임)는 아무것도 쓰지 않는다. 묶기가 실패해도 초안은 그대로 두고 기록만 남긴다
   */
  bindDraft(originThreadId: string, plugin: string): void;
  /**
   * 맥락 참조를 남긴다(M5c §4.8.8). 열 때마다 한 번이다. 대화가 테스트 대화가 아니거나 닫혔으면 실패 값이다.
   * 호출자는 쓰기 소유를 얻은 뒤에 부른다
   */
  recordContext(threadId: ThreadId, payload: CraftContextPayload): Result<void, CraftPluginError>;
  /**
   * 대화의 맥락 참조(`CraftContextPort`). 모든 `craft.context` 사건의 참조를 기록 순서대로 잇고 같은 참조는 한 번만 낸다.
   * 사건의 모양이 깨졌으면 `store` 실패다(조용히 거르지 않는다)
   */
  readContext(threadId: ThreadId): Promise<Result<readonly ContextRef[], CraftContextError>>;
}

export function createCraftChatPort(deps: CraftChatPortDeps): CraftChatPort {
  return {
    folderOf: (plugin) => join(deps.configDir, "plugins", plugin),
    recordContext: (threadId, payload) =>
      deps.store.recordCraftContext(threadId, payload, deps.nextKey()),
    readContext: async (threadId) => {
      const events = await deps.store.readContextEvents(threadId);
      if (!events.ok) return err({ kind: "store", code: events.error.kind });
      return refsOfEvents(events.value);
    },
    bindDraft(originThreadId, plugin) {
      const parsed = parseThreadId(originThreadId);
      if (parsed === undefined) return;
      const found = deps.store.thread(parsed);
      if (!found.ok) {
        deps.logger.warn("craft.bind_read_failed", { threadId: originThreadId });
        return;
      }
      // 테스트 대화가 아니거나 이미 묶였으면 쓰지 않는다(묶인 값은 바꾸지 않는다, §4.8.2)
      if (found.value?.craftChat === undefined || found.value.craftChat.plugin !== null) return;
      const bound = deps.store.setCraftPlugin(parsed, plugin, deps.nextKey());
      if (!bound.ok) {
        deps.logger.warn("craft.bind_failed", {
          threadId: originThreadId,
          reason: bound.error.kind,
        });
      }
    },
  };
}

/**
 * `craft.context` 사건들의 참조를 기록 순서대로 잇고 같은 참조는 한 번만 낸다. 사건의 모양이 맞지 않으면 실패 값이다
 * (저장된 옛 모양이 아니라 이 판의 모양만 읽는다. 맞지 않는 사건은 거르지 않고 알린다)
 */
export function refsOfEvents(
  events: readonly { readonly payload: unknown }[],
): Result<readonly ContextRef[], CraftContextError> {
  const seen = new Set<string>();
  const refs: ContextRef[] = [];
  for (const event of events) {
    const read = parse(CraftContextPayloadSchema, event.payload);
    if (!read.ok) return err({ kind: "store", code: "craft_context_unreadable" });
    for (const ref of read.value.refs) {
      const key = JSON.stringify(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(ref);
    }
  }
  return ok(refs);
}

/** 대화 id 모양이 아니면 없는 대화다(초안의 `originThreadId`는 호출자가 준 문자열이다) */
function parseThreadId(text: string): ThreadId | undefined {
  return isId("thr", text) ? text : undefined;
}
