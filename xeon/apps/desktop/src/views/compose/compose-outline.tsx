// 좁은 폭의 개요(§6.28.6, §6.28.8): 캔버스 대신 caustic `LayerTree`로 단계와 그 단계에서 나가는 선을 보인다. 순서는 흐름이 정하므로 끌어 옮기지 않는다(보기 전용).
// 고르기와 펼치기만 한다. 고르면 그 단계가 속성 자리에 보인다. 선을 잇는 일은 속성에서 한다.
import { t } from "@fresnel/client/i18n";
import { outlineOf, type FlowDraft } from "@fresnel/client/workbench";
import type { PhaseNodeKind } from "@fresnel/contracts/extensions";
import { LayerTree, LayerTreeItem, type LayerTreeAnnouncement } from "@caustic/react";
import { useState, type ReactNode } from "react";
import { NODE_TEXT } from "./compose-text.ts";

/** 살아 있는 글: 고르기와 펼치기만 말한다. 나머지 종류는 이 화면에서 일어나지 않아 빈 글이다 */
export function announceOf(event: LayerTreeAnnouncement): string {
  if (event.type === "selected")
    return t("desktop.compose.flow.outline.selected", { names: event.names.join(", ") });
  if (event.type === "expanded")
    return t("desktop.compose.flow.outline.expanded", { names: event.names.join(", ") });
  if (event.type === "collapsed")
    return t("desktop.compose.flow.outline.collapsed", { names: event.names.join(", ") });
  return "";
}

/** 끌기 시작을 막는다. LayerTreeItem은 자기 포인터 처리 뒤에 받은 props를 펼치므로 이 값이 끌기 처리를 대신한다 */
const NO_DRAG = (): void => {};

export interface FlowOutlineProps {
  readonly draft: FlowDraft;
  readonly selected: string | null;
  readonly onSelect: (id: string) => void;
}

export function FlowOutline(props: FlowOutlineProps): ReactNode {
  const { draft } = props;
  const rows = outlineOf(draft);
  // 접힌 노드만 든다. 새로 생긴 노드는 펼쳐진 채 나타난다
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const nodeIds = draft.nodes.map((node) => `node:${node.id}`);
  const expanded = nodeIds.filter((id) => !collapsed.includes(id));
  const kindOf = new Map(draft.nodes.map((node): [string, PhaseNodeKind] => [node.id, node.kind]));
  const withLines = new Set(
    rows.filter((row) => row.kind === "transition").map((row) => row.nodeId),
  );
  // 접힌 노드의 선 줄은 빼고, 남은 줄을 순서대로 그린다
  const visible = rows.filter(
    (row) => row.kind === "node" || expanded.includes(`node:${row.nodeId}`),
  );
  const titleOf = (id: string): string => draft.nodes.find((node) => node.id === id)?.title ?? id;
  return (
    <LayerTree
      aria-label={t("desktop.compose.flow.outline.label")}
      announce={announceOf}
      value={props.selected === null ? [] : [`node:${props.selected}`]}
      expanded={expanded}
      onValueChange={(ids) => {
        const row = rows.find((item) => item.id === ids.at(-1));
        if (row !== undefined) props.onSelect(row.nodeId);
      }}
      onExpandedChange={(ids) => {
        setCollapsed(nodeIds.filter((id) => !ids.includes(id)));
      }}
      // 흐름이 순서를 정하므로 Alt+화살표로 옮기지 않는다
      onKeyDown={(e) => {
        if (e.altKey) e.preventDefault();
      }}
    >
      {visible.map((row) => {
        if (row.kind === "node") {
          const kind = kindOf.get(row.nodeId);
          return (
            <LayerTreeItem
              key={row.id}
              itemId={row.id}
              depth={0}
              label={row.label}
              tag={kind === undefined ? undefined : t(NODE_TEXT[kind])}
              expandable={withLines.has(row.nodeId)}
              onPointerDown={NO_DRAG}
            />
          );
        }
        const to = row.target ?? row.label;
        return (
          <LayerTreeItem
            key={row.id}
            itemId={row.id}
            depth={1}
            label={t("desktop.compose.flow.to", { to: titleOf(to) })}
            // 선에 이벤트가 있으면 outlineOf가 이벤트를 label로 주고, 없으면 도착 id를 준다
            caption={row.label === to ? undefined : row.label}
            onPointerDown={NO_DRAG}
          />
        );
      })}
    </LayerTree>
  );
}
