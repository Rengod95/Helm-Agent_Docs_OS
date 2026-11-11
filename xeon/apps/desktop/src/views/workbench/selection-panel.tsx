// 선택 패널(확장 화면 오른쪽): 이름·표식, 켜짐 스위치 하나, 자동 꺼짐 알림, "자세히 보기". 고른 확장을 읽는다.
import { t } from "@fresnel/client/i18n";
import { rowOf, type WorkbenchState } from "@fresnel/client/workbench";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { Button, StatusDot } from "@caustic/react";
import type { ReactNode } from "react";
import { AutoOffNotice } from "./craft-parts.tsx";
import {
  ExtName,
  ExtSwitch,
  RemoveButton,
  kindText,
  lockText,
  stateText,
  stateTone,
} from "./ext-row.tsx";

export function SelectionPanel(props: {
  readonly state: WorkbenchState;
  readonly entry: ExtListEntry;
  readonly onToggle: (target: boolean) => void;
  readonly onDetail: () => void;
  readonly onClear: () => void;
  readonly onReenable: () => void;
  readonly onKeepOff: () => void;
  readonly onRemove: () => void;
}): ReactNode {
  const { entry } = props;
  const row = rowOf(entry, props.state.pending);
  return (
    <aside
      aria-label={t("desktop.workbench.selection.label")}
      className="grid min-h-0 w-80 shrink-0 content-start gap-3 overflow-y-auto p-4"
    >
      <div className="flex items-center gap-2">
        <ExtName row={row} />
        <Button size="xs" variant="ghost" className="ms-auto" onClick={props.onClear}>
          {t("desktop.workbench.selection.close")}
        </Button>
      </div>
      {/* 시안의 머리 줄처럼 층 mono, 종류·등급 글, 상태 점을 한 줄에 둔다. 종류와 등급은 칩이 아니라 글이다 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-dense">
        <span className="font-mono text-mono-sm text-text-tertiary">{row.layer}</span>
        <span className="text-text-secondary">
          {kindText(row.kind)} · {row.grade}
        </span>
        <StatusDot tone={stateTone(row.state)} label={stateText(row.state)} />
      </div>
      <div className="flex items-center gap-3">
        <ExtSwitch row={row} onToggle={props.onToggle} />
        {row.pendingTarget !== null && (
          <span className="text-ui text-text-tertiary">
            {t("desktop.workbench.toggle.pending")}
          </span>
        )}
      </div>
      {row.lock !== null && <p className="text-ui text-text-tertiary">{lockText(row.lock)}</p>}
      {/* 크래프트 선택 패널(`craft/selection-panel.tsx`)과 같은 부품이다: 질문, 자동 꺼짐 줄, 답한 뒤의 결과 줄. 확장이 바뀌면 기억을 새로 한다 */}
      <AutoOffNotice
        key={entry.name}
        entry={entry}
        onKeepOn={props.onReenable}
        onKeepOff={props.onKeepOff}
      />
      <p className="text-ui text-text-secondary">
        {t("desktop.workbench.selection.hooks", { count: row.hookCount })}
      </p>
      <Button size="sm" onClick={props.onDetail}>
        {t("desktop.workbench.selection.detail")}
      </Button>
      <RemoveButton entry={entry} onRemove={props.onRemove} />
    </aside>
  );
}
