import { join } from "node:path";
import type { Logger, Result } from "@fresnel/contracts";
import { isId, type CraftChatSummary, type ThreadId } from "@fresnel/contracts/conversation";
import type { CraftPluginError } from "@fresnel/contracts/records";

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
}

export function createCraftChatPort(deps: CraftChatPortDeps): CraftChatPort {
  return {
    folderOf: (plugin) => join(deps.configDir, "plugins", plugin),
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

/** 대화 id 모양이 아니면 없는 대화다(초안의 `originThreadId`는 호출자가 준 문자열이다) */
function parseThreadId(text: string): ThreadId | undefined {
  return isId("thr", text) ? text : undefined;
}
