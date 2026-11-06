// 확장 목록. 확장 화면의 본체다. caustic `Table` 한 표(시안 c03·e04: 이름, 층, 신뢰 수준, 상태, 켜짐)에 층 순서(L3 → L2 → external → L1)로 행을 늘어놓는다.
// 층은 열이고, 거르기는 목록 머리의 층·켜짐 Select가 맡는다.
// 행을 누르거나 Enter·Space로 고르고(확장 묶음이면 그룹, 아니면 플러그인), 고른 행을 다시 고르면 푼다. 행 사이 화살표 이동은 Table이 한다.
import { t, type MessageId } from "@fresnel/client/i18n";
import { layerGroups, selectedName } from "@fresnel/client/workbench";
import { Table, type TableColumn } from "@caustic/react";
import type { ReactNode } from "react";
import { useWorkbench, useWorkbenchActions } from "../../state/workbench/index.ts";
import { ExtCell, extColumnOf } from "./ext-row.tsx";

/** 층 묶음 머리는 사람 말이다(시안 c03). 모르는 층은 id 그대로 */
const LAYER_NAME: Readonly<Record<string, MessageId>> = {
  L3: "term.layerOrchestration",
  L2: "term.layerCapabilities",
  external: "term.plugin",
  plugin: "term.plugin",
  L1: "term.layerAgentCore",
};

export const layerNameOf = (layer: string): string => {
  const id = LAYER_NAME[layer];
  return id === undefined ? layer : t(id);
};

export function LayerList(props: {
  readonly onToggle: (name: string, target: boolean) => void;
}): ReactNode {
  const state = useWorkbench((s) => s);
  const actions = useWorkbenchActions();
  const selected = selectedName(state);
  const rows = layerGroups(state).flatMap((group) => group.rows);
  const byName = new Map(rows.map((row) => [row.name, row] as const));
  // 머리글은 그릴 때 고른다. 말투(로케일)가 연결 뒤에 바뀔 수 있다
  const columns: TableColumn[] = [
    { key: "name", header: t("desktop.workbench.col.name") },
    { key: "layer", header: t("desktop.workbench.col.layer"), width: 112 },
    { key: "origin", header: t("desktop.workbench.col.trust"), width: 92 },
    { key: "state", header: t("desktop.workbench.col.state"), width: 128 },
    { key: "switch", header: t("desktop.workbench.col.switch"), align: "end", width: 64 },
  ];
  return (
    <Table
      variant="ghost"
      size="xs"
      className="[&_table]:table-fixed [&_thead_th]:bg-transparent"
      dividers={false}
      aria-label={t("desktop.workbench.list.title")}
      columns={columns}
      rows={rows.map((row) => ({ id: row.name }))}
      selectionMode="single"
      selectedKeys={selected === null ? [] : [selected]}
      onRowActivate={(picked) => {
        const row = byName.get(picked.id);
        if (row === undefined) return;
        if (selected === row.name) actions.clearPick();
        else if (row.kind === "group") actions.pickGroup(row.name);
        else actions.pickPlugin(row.name);
      }}
      renderCell={(picked, column) => {
        const row = byName.get(picked.id);
        if (row === undefined) return null;
        if (column.key === "layer") {
          return <span className="text-text-tertiary">{layerNameOf(row.layer)}</span>;
        }
        const name = extColumnOf(column.key);
        if (name === undefined) return null;
        return (
          <ExtCell
            row={row}
            column={name}
            onToggle={(target) => {
              props.onToggle(row.name, target);
            }}
          />
        );
      }}
    />
  );
}
