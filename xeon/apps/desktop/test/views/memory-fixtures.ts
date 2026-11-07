import type { MemoryStoreView } from "@fresnel/contracts/capabilities";
import type { MemoryPanelViewProps } from "../../src/views/pages/settings/settings-memory-view.tsx";

// 기억 구역 시험의 공용 값. 항목 55개는 "배포"를 찾으면 한 개만 남도록 만들었다.
// 항목에는 날짜와 출처가 없다(데이터에 없다). 그래서 시험 값에도 날짜와 출처를 두지 않는다.

/** "배포" 글이 든 자리(0부터). 파일 순서는 넣은 순서다 */
export const DEPLOY_INDEX = 36;

/** 항목 55개의 글. "배포"는 `DEPLOY_INDEX` 한 곳에만 있다 */
export const ENTRY_TEXTS: readonly string[] = Array.from({ length: 55 }, (_, index) =>
  index === DEPLOY_INDEX
    ? "금요일에는 배포를 하지 않아요"
    : `메모 ${index + 1}번: 설정한 값 ${index + 1}`,
);

/** 시험용 저장소 묶음. 글 순서가 파일 순서이고, id는 자리 번호를 열두 자리 16진수로 쓴 것이다 */
export function storeOf(name: "user" | "env", texts: readonly string[]): MemoryStoreView {
  return {
    store: name,
    entries: texts.map((text, index) => ({
      id: index.toString(16).padStart(12, "0"),
      text,
      chars: text.length,
    })),
    usedChars: texts.join("").length,
    limitChars: 1375,
    fileHash: "a".repeat(64),
    writeBlocked: false,
  };
}

const NOOP = (): void => {};

/** 기억 구역 그림의 props. 읽기 상태는 `over.load`로 정하고, 나머지는 닫히고 빈 상태다 */
export function memoryPropsOf(over: Partial<MemoryPanelViewProps> = {}): MemoryPanelViewProps {
  return {
    load: { kind: "ready", stores: [storeOf("user", []), storeOf("env", [])] },
    notice: null,
    editor: { kind: "closed" },
    removing: null,
    busy: false,
    search: "",
    sort: "recent",
    onSearch: NOOP,
    onSort: NOOP,
    onOpenAdd: NOOP,
    onOpenEdit: NOOP,
    onText: NOOP,
    onSave: NOOP,
    onCloseEditor: NOOP,
    onAskRemove: NOOP,
    onConfirmRemove: NOOP,
    onCloseRemove: NOOP,
    ...over,
  };
}
