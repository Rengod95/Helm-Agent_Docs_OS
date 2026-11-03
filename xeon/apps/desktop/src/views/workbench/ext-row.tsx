// 확장 행 부품(V-16, §6.21): 표시 이름, id mono, 층 mono, 종류, 등급, 상태 점 + 글, 버전, 켜짐 스위치(그룹은 하나, 15-1).
import { t, type MessageId } from "@fresnel/client/i18n";
import type { ExtKind, ExtRowVM, ExtState, ToggleLock } from "@fresnel/client/workbench";
import { Badge, StatusDot, Switch } from "@caustic/react";
import type { ReactNode } from "react";

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

/** 켜짐 스위치. 잠긴 행은 이유를 `title`과 `aria-description`으로 준다 */
export function ExtSwitch(props: {
  readonly row: ExtRowVM;
  readonly onToggle: (target: boolean) => void;
}): ReactNode {
  const { row } = props;
  const reason = row.lock === null ? undefined : lockText(row.lock);
  const checked = row.pendingTarget ?? row.on;
  return (
    <Switch
      size="sm"
      checked={checked}
      disabled={row.lock !== null}
      aria-label={t("desktop.workbench.switch.label", { name: row.displayName ?? row.name })}
      title={reason}
      aria-description={reason}
      onCheckedChange={props.onToggle}
    />
  );
}

export interface ExtRowProps {
  readonly row: ExtRowVM;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onToggle: (target: boolean) => void;
}

export function ExtRow(props: ExtRowProps): ReactNode {
  const { row } = props;
  return (
    <li
      data-selected={props.selected}
      className="flex items-center gap-3 rounded-md px-2 py-1.5 text-ui-sm data-[selected=true]:bg-control-raised"
    >
      <button
        type="button"
        aria-pressed={props.selected}
        onClick={props.onSelect}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="w-12 shrink-0 font-mono text-text-tertiary">{row.layer}</span>
        <ExtName row={row} />
        <Badge size="sm">{kindText(row.kind)}</Badge>
        <span className="ms-auto shrink-0">
          <StatusDot tone={stateTone(row.state)} label={stateText(row.state)} />
        </span>
        <span className="w-14 shrink-0 text-end font-mono text-text-tertiary">{row.version}</span>
      </button>
      <ExtSwitch row={row} onToggle={props.onToggle} />
    </li>
  );
}
