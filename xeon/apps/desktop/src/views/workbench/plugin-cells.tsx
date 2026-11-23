// 플러그인 목록의 두 보기(표, 카드)가 같이 쓰는 칸(AGE-76 plugTab): 상태 한 칸, 이름 한 줄, 쓰는 곳 글. 상세 머리도 상태 칸을 쓴다.
// 표(`plugin-list.tsx`)와 카드(`plugin-cards.tsx`)가 서로 가져오지 않도록 여기 둔다.
import { t, type MessageId } from "@fresnel/client/i18n";
import type { ExtRowVM } from "@fresnel/client/workbench";
import type { ReactNode } from "react";
import { DotOrb } from "../effects/dot-orb.tsx";
import { profileUseOf, profileUseText, type ProfileSet } from "./profile-use.ts";

/** 줄의 상태 한 칸. 문제가 있을 때만 주의 구슬과 글, 아니면 흐린 "준비됨". "준비 안 됨"은 꼭 필요한 도구가 없을 때다 */
export type RowHealth = "stopped" | "safeMode" | "problem" | "notReady" | "ready";

/** 상태 우선순위: 멈춤 > 안전 모드에서 빠짐 > 문제 있음 > 준비 안 됨 > 준비됨 */
export function rowHealthOf(row: Pick<ExtRowVM, "state" | "failed">, blocked = false): RowHealth {
  if (row.state === "auto_disabled") return "stopped";
  if (row.state === "safe_excluded") return "safeMode";
  if (row.failed) return "problem";
  if (blocked) return "notReady";
  return "ready";
}

const HEALTH_TEXT: Readonly<Record<RowHealth, MessageId>> = {
  stopped: "desktop.workbench.health.stopped",
  safeMode: "desktop.workbench.health.safeMode",
  problem: "desktop.workbench.health.problem",
  notReady: "desktop.workbench.health.notReady",
  ready: "desktop.workbench.health.ready",
};

export function HealthCell(props: {
  readonly row: Pick<ExtRowVM, "state" | "failed">;
  readonly blocked?: boolean;
}): ReactNode {
  const health = rowHealthOf(props.row, props.blocked);
  if (health === "ready") {
    return <span className="text-ui-sm text-text-tertiary">{t(HEALTH_TEXT.ready)}</span>;
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-ui-sm text-text-primary">
      <span
        aria-hidden="true"
        className="inline-flex size-icon-sm shrink-0 items-center justify-center"
      >
        <DotOrb state="listening" tone="warm" size={12} kind="mark" live={false} />
      </span>
      <span className="min-w-0 truncate">{t(HEALTH_TEXT[health])}</span>
    </span>
  );
}

/**
 * 표시 이름과 회색 mono id. 표시 이름이 없으면 id만 보인다. 칸이 좁으면 id가 먼저 줄고(`min-w-0`), 이름은 혼자서도 넘칠 때만 줄인다
 * (`shrink-0` + `max-w-full`)
 */
export function RowName(props: { readonly row: ExtRowVM }): ReactNode {
  const { row } = props;
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="max-w-full shrink-0 truncate text-text-primary">
        {row.displayName ?? row.name}
      </span>
      {row.displayName !== null && (
        <span className="min-w-0 truncate font-mono text-mono-sm text-text-tertiary">
          {row.name}
        </span>
      )}
    </span>
  );
}

/** 쓰는 곳 글: "프로필 N개", "어느 프로필에도 없음", "모든 대화". 프로필 목록을 아직 못 읽었으면 빈 글 */
export function UseText(props: {
  readonly row: ExtRowVM;
  readonly profiles: ProfileSet | null;
}): ReactNode {
  const { row, profiles } = props;
  return (
    <span className="block min-w-0 truncate text-ui-sm text-text-secondary">
      {profiles === null ? "" : profileUseText(profileUseOf(row.name, row.appCore, profiles))}
    </span>
  );
}
