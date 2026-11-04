// 확장 행 부품(V-16, §6.21, §6.23): 표 칸 하나의 내용. 표 틀과 고르기·키보드는 `layer-list.tsx`의 caustic `Table`이 맡는다.
// 칸: 표시 이름과 id mono, 층 mono, 종류, 등급, 상태 점 + 글, 버전, 켜짐 스위치(그룹은 하나, 15-1).
import { t, type MessageId } from "@fresnel/client/i18n";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import type { ExtKind, ExtRowVM, ExtState, ToggleLock } from "@fresnel/client/workbench";
import { assertNever } from "@fresnel/contracts";
import { Badge, Button, StatusDot, Switch, Tooltip } from "@caustic/react";
import type { ReactNode } from "react";
import { removableOf } from "./remove-model.ts";

type DotTone = "neutral" | "success" | "warning" | "danger" | "info";

const STATE_TONE: Readonly<Record<ExtState, DotTone>> = {
  on: "success",
  off: "neutral",
  enabling: "info",
  disabling: "info",
  auto_disabled: "danger",
  safe_excluded: "warning",
};

const STATE_TEXT: Readonly<Record<ExtState, MessageId>> = {
  on: "desktop.workbench.state.on",
  off: "desktop.workbench.state.off",
  enabling: "desktop.workbench.state.enabling",
  disabling: "desktop.workbench.state.disabling",
  auto_disabled: "desktop.workbench.state.autoDisabled",
  safe_excluded: "desktop.workbench.state.safeExcluded",
};

const KIND_TEXT: Readonly<Record<ExtKind, MessageId>> = {
  group: "desktop.workbench.kind.group",
  plugin: "desktop.workbench.kind.plugin",
  core: "desktop.workbench.kind.core",
};

const LOCK_TEXT: Readonly<Record<Exclude<ToggleLock, null>, MessageId>> = {
  exempt: "desktop.workbench.lock.exempt",
  safe_mode: "desktop.workbench.lock.safeMode",
  managed: "desktop.workbench.lock.managed",
};

export const stateText = (state: ExtState): string => t(STATE_TEXT[state]);
export const kindText = (kind: ExtKind): string => t(KIND_TEXT[kind]);
export const lockText = (lock: Exclude<ToggleLock, null>): string => t(LOCK_TEXT[lock]);
export const stateTone = (state: ExtState): DotTone => STATE_TONE[state];

export function ExtName(props: { readonly row: ExtRowVM }): ReactNode {
  const { row } = props;
  return (
    <span className="min-w-0 truncate">
      {row.displayName !== null && <span className="text-text-primary">{row.displayName} </span>}
      <span className="font-mono text-text-tertiary">{row.name}</span>
    </span>
  );
}

/**
 * 켜짐 스위치. 잠긴 행은 스위치가 꺼져 포커스와 마우스 올림을 받지 못하므로, 스위치를 감싼 span에 `Tooltip`으로 이유를 보인다.
 * 이유는 `aria-description`으로도 준다.
 */
export function ExtSwitch(props: {
  readonly row: ExtRowVM;
  readonly onToggle: (target: boolean) => void;
}): ReactNode {
  const { row } = props;
  const reason = row.lock === null ? undefined : lockText(row.lock);
  const checked = row.pendingTarget ?? row.on;
  const control = (
    <Switch
      size="sm"
      checked={checked}
      disabled={row.lock !== null}
      aria-label={t("desktop.workbench.switch.label", { name: row.displayName ?? row.name })}
      aria-description={reason}
      onCheckedChange={props.onToggle}
    />
  );
  if (reason === undefined) return control;
  return (
    <Tooltip content={reason}>
      <span
        tabIndex={0}
        className="inline-flex rounded-full outline-none focus-visible:shadow-focus"
      >
        {control}
      </span>
    </Tooltip>
  );
}

/** 확장 표의 열(§6.23). 칸 내용은 이 이름으로 고른다 */
export type ExtColumn = "name" | "layer" | "kind" | "grade" | "state" | "version" | "switch";

const EXT_COLUMNS: readonly ExtColumn[] = [
  "name",
  "layer",
  "kind",
  "grade",
  "state",
  "version",
  "switch",
];

/** 표 열의 키(문자열)를 열 이름으로 바꾼다. 열 이름이 아니면 undefined */
export function extColumnOf(key: string): ExtColumn | undefined {
  return EXT_COLUMNS.find((column) => column === key);
}

/** 표 한 칸의 내용 */
export function ExtCell(props: {
  readonly row: ExtRowVM;
  readonly column: ExtColumn;
  readonly onToggle: (target: boolean) => void;
}): ReactNode {
  const { row } = props;
  switch (props.column) {
    case "name":
      return <ExtName row={row} />;
    case "layer":
      return <span className="font-mono text-text-tertiary">{row.layer}</span>;
    case "kind":
      return <Badge size="sm">{kindText(row.kind)}</Badge>;
    case "grade":
      return <span className="text-text-tertiary">{row.grade}</span>;
    case "state":
      return <StatusDot tone={stateTone(row.state)} label={stateText(row.state)} />;
    case "version":
      return <span className="font-mono text-text-tertiary">{row.version}</span>;
    case "switch":
      return <ExtSwitch row={row} onToggle={props.onToggle} />;
    default:
      return assertNever(props.column, "ExtCell");
  }
}

/**
 * "지우기" 단추(B-04). 사용자 위치의 설치본만 지운다. 지울 수 없는 확장은 단추가 꺼져 포커스를 받지 못하므로
 * 감싼 span에 `Tooltip`으로 이유를 보인다
 */
export function RemoveButton(props: {
  readonly entry: Pick<ExtListEntry, "origin">;
  readonly onRemove: () => void;
}): ReactNode {
  if (removableOf(props.entry)) {
    return (
      <Button size="sm" variant="outline" onClick={props.onRemove}>
        {t("desktop.workbench.remove.open")}
      </Button>
    );
  }
  return (
    <Tooltip content={t("desktop.workbench.remove.locked")}>
      <span tabIndex={0} className="inline-flex rounded-md outline-none focus-visible:shadow-focus">
        <Button size="sm" variant="outline" disabled>
          {t("desktop.workbench.remove.open")}
        </Button>
      </span>
    </Tooltip>
  );
}
