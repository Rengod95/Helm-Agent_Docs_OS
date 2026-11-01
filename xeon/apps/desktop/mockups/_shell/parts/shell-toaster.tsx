// 묶음 D(S-04, 결정 14): 토스트 자리. 오른쪽 well이 열려 있으면 well 왼쪽 끝으로 옮겨 well 내용을 가리지 않는다.
// well이 닫혀 있으면 떠 있는 막대 왼쪽(예전 s04 자리 bottom-10 end-14). 좁은 폭(compact)에서 well은 위에 뜨는 면이라
// 토스트는 well 위가 아니라 가운데 아래(상태 표시줄 위)로 내린다. 위치만 바꾸고 토스트 규칙(4초, danger는 머묾)은 caustic 그대로.
// 이 부품을 쓰지 않는 페이지는 예전 자리 그대로다.
import { Toaster } from "@caustic/react";
import { useShell } from "../state";

/** well 폭 352 + 막대와 well 사이 1.5 + 막대 폭과 창 여백. */
const WELL_END = "end-[calc(352px+3.5rem+0.75rem)]";

export function ShellToaster({ label = "알림" }: { label?: string }) {
  const m = useShell();
  const place =
    m.layout === "compact"
      ? "bottom-10 inset-x-2 end-2"
      : m.endOpen
        ? `bottom-10 ${WELL_END}`
        : "bottom-10 end-14";
  return <Toaster label={label} className={`${place} transition-[inset] duration-quick`} />;
}
