// 층별 목록. 지도·순서·링크가 등록되기 전의 개요 캔버스 대신이고, 층 패널(고리를 누르면 그 층)도 이 부품이다.
import { t } from "@fresnel/client/i18n";
import { layerGroups, selectedName } from "@fresnel/client/workbench";
import type { ReactNode } from "react";
import { useWorkbench, useWorkbenchActions } from "../../state/workbench/index.ts";
import { ExtRow } from "./ext-row.tsx";

export function LayerList(props: {
  /** 하나만 보일 층. 없으면 전부 */
  readonly only?: string | null;
  readonly onToggle: (name: string, target: boolean) => void;
}): ReactNode {
  const state = useWorkbench((s) => s);
  const actions = useWorkbenchActions();
  const selected = selectedName(state);
  const groups = layerGroups(state).filter(
    (g) => props.only === undefined || props.only === null || g.layer === props.only,
  );
  return (
    <div className="grid gap-4">
      {groups.map((group) => (
        <section key={group.layer} aria-label={group.layer} className="grid gap-1">
          <h3 className="flex items-baseline gap-2 px-2 text-ui-strong text-text-primary">
            <span className="font-mono">{group.layer}</span>
            <span className="text-ui-sm font-normal text-text-tertiary">
              {t("desktop.workbench.layers.count", { on: group.on, total: group.total })}
            </span>
          </h3>
          <ul className="grid gap-0.5">
            {group.rows.map((row) => (
              <ExtRow
                key={row.name}
                row={row}
                selected={selected === row.name}
                onSelect={() => {
                  actions.select(selected === row.name ? null : row.name);
                }}
                onToggle={(target) => {
                  props.onToggle(row.name, target);
                }}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
