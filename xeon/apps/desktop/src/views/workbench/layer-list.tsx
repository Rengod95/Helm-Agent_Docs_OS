// 층별 목록. 확장 화면의 본체다. 행을 누르면 고르고(확장 묶음이면 그룹, 아니면 플러그인), 고른 행을 다시 누르면 푼다.
import { t } from "@fresnel/client/i18n";
import { layerGroups, selectedName } from "@fresnel/client/workbench";
import type { ReactNode } from "react";
import { useWorkbench, useWorkbenchActions } from "../../state/workbench/index.ts";
import { ExtRow } from "./ext-row.tsx";

export function LayerList(props: {
  readonly onToggle: (name: string, target: boolean) => void;
}): ReactNode {
  const state = useWorkbench((s) => s);
  const actions = useWorkbenchActions();
  const selected = selectedName(state);
  const groups = layerGroups(state);
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
                  if (selected === row.name) actions.clearPick();
                  else if (row.kind === "group") actions.pickGroup(row.name);
                  else actions.pickPlugin(row.name);
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
