import { t } from "@fresnel/client/i18n";
import { TagInput, type TagInputProps } from "@caustic/react";
import { useEffect, useRef, type ReactNode } from "react";

// caustic TagInput의 칩 삭제 단추 이름은 영어 `Remove <값>`으로 굳어 있고 바꿀 prop이 없다(Chip의 `removeLabel`을 TagInput이 넘기지 않는다).
// 감싼 칸 안의 삭제 단추 이름을 앱 말투("<값> 빼기")로 다시 단다. 칩이 들고 나는 애니메이션 때문에 칸이 바뀔 때마다 다시 훑는다.

/** 칩 삭제 단추의 이름. 값이 없으면 단추 이름만 */
function tagRemoveLabelOf(value: string): string {
  return t("desktop.tagInput.remove", { value });
}

function relabel(root: HTMLElement): void {
  for (const button of root.querySelectorAll<HTMLElement>('[data-slot="chip-remove"]')) {
    const value = button.closest('[data-slot="chip"]')?.querySelector('[data-slot="chip-label"]');
    const next = tagRemoveLabelOf(value?.textContent ?? "");
    if (button.getAttribute("aria-label") !== next) button.setAttribute("aria-label", next);
  }
}

export function LocalizedTagInput(props: TagInputProps): ReactNode {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = root.current;
    if (node === null) return undefined;
    relabel(node);
    const watch = new MutationObserver(() => {
      relabel(node);
    });
    watch.observe(node, { childList: true, subtree: true });
    return () => {
      watch.disconnect();
    };
  });
  return (
    <div ref={root} className="contents">
      <TagInput {...props} />
    </div>
  );
}
