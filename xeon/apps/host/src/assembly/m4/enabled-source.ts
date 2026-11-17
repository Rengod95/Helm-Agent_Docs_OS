import { isId, type ThreadId } from "@fresnel/contracts/conversation";
import type { EnabledSource } from "@fresnel/contracts/wire";
import type { ExtReadSources } from "./ext-read-port.ts";

// `ext.list.enabledSource`의 원천 연결. `ext-read-sources.ts`가 설정 원천(`settings-sources.ts`)을 거쳐 `types.ts`와 이어지므로,
// 조립(`m4/index.ts`)이 쓰는 이 부분은 따로 둬서 순환을 만들지 않는다.

function threadIdOf(value: string | undefined): ThreadId | undefined {
  return isId("thr", value) ? value : undefined;
}

/**
 * 대화별 켜짐 집합(E(T))을 쥔 쪽이 주는 읽기 면(M5c §4.1). 호스트 조립의 플러그인 집합이 구현한다.
 * `sourceOf`는 관리 잠금, 오류 정지, 코어, 공통 묶음, 프로필 순으로 출처를 정한다.
 */
export interface EnabledSourceView {
  sourceOf(threadId: ThreadId | undefined, extension: string): EnabledSource;
  /** 열린 대화의 E(T)를 다시 맞춘다. 정지가 풀리면(`ext.reenable`, `ext.disableConfirm`) 쓴다 */
  recomputeAll(): void;
}

/**
 * 켜짐의 출처(`ext.list`의 `enabledSource`, M5c §3.4). 관리 잠금은 `managed`, 코어 단위는 `core`, 공통 묶음은 `common`,
 * 대화의 프로필은 `profile`, 덧씌우기는 아직 없어 `overlay`를 내지 않는다, 그 밖은 `none`이다.
 * 오류로 멈춘 플러그인은 E(T)에서 빠지므로 `none`이다(§4.1.12).
 */
function enabledSourceOf(
  view: EnabledSourceView,
  threadId: ThreadId | undefined,
  extension: string,
): EnabledSource {
  return view.sourceOf(threadId, extension);
}

/**
 * 확장 읽기 원천에 E(T) 출처를 붙인다. `enabledSource`는 등록의 확장 이름으로 `enabledSourceOf`를 부른다.
 * `ext.reenable`과 `ext.disableConfirm`은 정지 상태를 바꾸므로 원천을 부른 뒤 열린 대화의 E(T)를 다시 맞춘다.
 */
export function withEnabledSources(
  sources: ExtReadSources,
  view: EnabledSourceView,
  registrationsOf: () => readonly { readonly id: string; readonly extension: string }[],
): ExtReadSources {
  return {
    ...sources,
    enabledSource(registrationId, threadId) {
      const info = registrationsOf().find((item) => item.id === registrationId);
      if (info === undefined) return "none";
      return enabledSourceOf(view, threadIdOf(threadId), info.extension);
    },
    reenable(name) {
      sources.reenable(name);
      view.recomputeAll();
    },
    disableConfirm(name) {
      sources.disableConfirm(name);
      view.recomputeAll();
    },
  };
}
