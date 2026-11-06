import { List, ListRow, type ListReorderAnnouncement } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { keyboardMoveOf, movedOrderOf } from "./order-keys.ts";

// 순서를 바꾸는 행 목록. 끌기(caustic `List reorderable`의 손잡이)와 키(행에 초점, ↑·↓ 또는 Alt+↑·↓)를 함께 받는다.
// 순서는 호출자가 가진다(`order`는 화면에 보이는 순서). 바뀌면 `onMove`가 전체 순서를 한 번 준다.

export interface OrderedItem {
  readonly id: string;
  readonly title: string;
  readonly detail?: ReactNode;
  readonly end?: ReactNode;
}

export interface OrderedListProps {
  /** 접근 이름. 목록 머리글이기도 하다 */
  readonly label: string;
  /** 지금 보이는 순서의 행들 */
  readonly items: readonly OrderedItem[];
  /** 끌기와 키 옮기기를 받는다. 오프라인이면 거짓이다 */
  readonly editable: boolean;
  /** 행 앞에 순서 번호를 보인다(목업 P-12 검색 순서). 기본은 끌기 손잡이만 보인다 */
  readonly numbered?: boolean;
  /** 옮긴 뒤의 전체 id 순서 */
  readonly onMove: (order: readonly string[]) => void;
}

function announceOf(event: ListReorderAnnouncement): string {
  if (event.type === "picked") return t("desktop.order.announce.picked", { title: event.title });
  if (event.type === "cancelled")
    return t("desktop.order.announce.cancelled", { title: event.title });
  return t("desktop.order.announce.moved", { title: event.title, position: event.position });
}

export function OrderedList(props: OrderedListProps): ReactNode {
  const { label, items, editable, numbered = false, onMove } = props;
  const ids = items.map((item) => item.id);
  return (
    <List
      reorderable
      numbered={numbered}
      size="xs"
      variant="ghost"
      aria-label={label}
      disabled={!editable}
      order={ids}
      onReorder={(event) => {
        onMove(event.order);
      }}
      handleLabel={(title) => t("desktop.order.handle", { title })}
      instructions={t("desktop.order.instructions")}
      announce={announceOf}
    >
      {items.map((item, index) => (
        <ListRow
          key={item.id}
          itemValue={item.id}
          title={item.title}
          description={item.detail}
          end={item.end}
          tabIndex={editable ? 0 : undefined}
          onKeyDown={(event) => {
            // 손잡이에서 누른 키는 caustic이 받는다. 행 자체에 초점이 있을 때만 한 칸 옮긴다
            if (!editable || event.target !== event.currentTarget) return;
            const move = keyboardMoveOf(event.key, index, items.length);
            if (move === null) return;
            event.preventDefault();
            onMove(movedOrderOf(ids, move));
          }}
        />
      ))}
    </List>
  );
}
