// 층별 목록. 확장 화면의 본체다. 층마다 caustic `Table` 하나를 그리고(§6.23 열: 이름, 층, 종류, 등급, 상태, 버전, 켜짐), 층 머리에 켜짐 수를 보인다.
// 행을 누르거나 Enter·Space로 고르고(확장 묶음이면 그룹, 아니면 플러그인), 고른 행을 다시 고르면 푼다. 행 사이 화살표 이동은 Table이 한다.
import { t } from "@fresnel/client/i18n";
import { layerGroups, selectedName } from "@fresnel/client/workbench";
import { Table, type TableColumn } from "@caustic/react";
import type { ReactNode } from "react";
import { useWorkbench, useWorkbenchActions } from "../../state/workbench/index.ts";
import { ExtCell, extColumnOf } from "./ext-row.tsx";

export function LayerList(props: {
  readonly onToggle: (name: string, target: boolean) => void;
}): ReactNode {
  const state = useWorkbench((s) => s);
  const actions = useWorkbenchActions();
  const selected = selectedName(state);
  const groups = layerGroups(state);
  // 머리글은 그릴 때 고른다. 말투(로케일)가 연결 뒤에 바뀔 수 있다
  const columns: TableColumn[] = [
    { key: "name", header: t("desktop.workbench.col.name") },
    { key: "layer", header: t("desktop.workbench.col.layer") },
    { key: "kind", header: t("desktop.workbench.col.kind") },
    { key: "grade", header: t("desktop.workbench.col.grade") },
    { key: "state", header: t("desktop.workbench.col.state") },
    { key: "version", header: t("desktop.workbench.col.version"), align: "end" },
    { key: "switch", header: t("desktop.workbench.col.switch") },
  ];
  return (
    <div className="grid gap-4">
      {groups.map((group) => {
        const byName = new Map(group.rows.map((row) => [row.name, row] as const));
        return (
          <section key={group.layer} aria-label={group.layer} className="grid gap-1">
            <h3 className="flex items-baseline gap-2 px-2 text-ui-strong text-text-primary">
              <span className="font-mono">{group.layer}</span>
              <span className="text-ui-sm font-normal text-text-tertiary">
                {t("desktop.workbench.layers.count", { on: group.on, total: group.total })}
              </span>
            </h3>
            <Table
              columns={columns}
              rows={group.rows.map((row) => ({ id: row.name }))}
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
                const name = extColumnOf(column.key);
                if (row === undefined || name === undefined) return null;
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
          </section>
        );
      })}
    </div>
  );
}
