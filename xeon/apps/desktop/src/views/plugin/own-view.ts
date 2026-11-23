import type { ExtUiEntry } from "@fresnel/contracts/wire";
import { isScreenEntry } from "./addon-model.ts";

// 플러그인 화면의 열기 링크와 바뀜 알림의 거름(ADR-0021 §3.4, §3.4.2, AGE-78). React와 DOM이 없어 시험이 같은 함수를 돈다.

/**
 * 같은 확장의 다른 화면을 여는 요청(`navigate { view }`, 카드의 `ViewLink`)의 화면 키(`<확장>/<id>`).
 * 플레이그라운드가 세는 화면 항목(`isScreenEntry`)이고 이 확장의 것이어야 한다. 다른 확장의 화면이나 목록에 없는 id면 undefined다
 */
export function ownScreenKeyOf(
  entries: readonly ExtUiEntry[],
  extension: string,
  view: string,
): string | undefined {
  const hit = entries.find(
    (entry) => entry.extension === extension && entry.id === view && isScreenEntry(entry),
  );
  return hit === undefined ? undefined : `${hit.extension}/${hit.id}`;
}

/**
 * 같은 확장의 다른 화면을 여는 함수(`navigate { view }`, 카드의 `ViewLink`가 같은 길을 쓴다). 목록에 없는 id면 열지 않고 거짓이다.
 * 여는 일(플레이그라운드 탭을 열고 대화 영역에서 올리기)은 `open`이 맡는다. 화면 훅(`plugin-view.tsx`)이 셸 동작을 넘긴다
 */
export function screenOpenerOf(options: {
  readonly entries: () => readonly ExtUiEntry[];
  readonly extension: string;
  readonly open: (name: string, screenKey: string) => void;
}): (view: string) => boolean {
  return (view) => {
    const key = ownScreenKeyOf(options.entries(), options.extension, view);
    if (key === undefined) return false;
    options.open(options.extension, key);
    return true;
  };
}

/**
 * 확장 바뀜 알림(`ext.ui.changed`)의 구독 함수 모양. `commands.pluginUi.onChanged`가 이 모양이다.
 * 값 `null`은 "어느 확장이든 바뀌었을 수 있으니 다시 읽어라"(재연결 뒤)다
 */
export type ExtensionChangeSubscribe = (listener: (extension: string | null) => void) => () => void;

/**
 * 이 확장이 바뀌었을 때(또는 재연결로 어느 확장이든 바뀌었을 수 있을 때, 값 `null`) `listener`를 부른다.
 * 다른 확장의 알림은 닿지 않는다. 구독을 끊는 함수를 돌려준다
 */
export function onExtensionChanged(
  subscribe: ExtensionChangeSubscribe,
  extension: string,
  listener: () => void,
): () => void {
  return subscribe((changed) => {
    if (changed === null || changed === extension) listener();
  });
}
