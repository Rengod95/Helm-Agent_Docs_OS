import { assertNever } from "@fresnel/contracts";
import { t } from "@fresnel/client/i18n";
import type { ConvoMarker } from "../../state/engine/convo.ts";
import type { LeadSegment, TurnSummary } from "../../state/engine/index.ts";
import { durationText } from "./tool-view-model.ts";

// 턴 발 줄·멈춘 사유·변화 표지·주도 구간 머리의 글(dzT2a 시안 7, 8, 10절). 순수 함수이고 화면 없이 시험한다.

/** 턴 발 줄 오른쪽 메타: "12단계 · 1분 4초 · 3.4만 토큰 · claude-opus" */
export function turnMetaOf(turn: TurnSummary): string {
  const parts: string[] = [];
  if (turn.steps > 0) parts.push(t("desktop.convo.foot.steps", { count: turn.steps }));
  if (turn.durationMs !== null) parts.push(durationText(turn.durationMs));
  if (turn.usage !== null && turn.usage.totalTokens > 0) {
    parts.push(t("desktop.convo.foot.tokens", { n: turn.usage.totalTokens }));
  }
  if (turn.model !== null) parts.push(turn.model);
  return parts.join(" · ");
}

/** 메타 툴팁의 상세 줄 */
export function turnDetailLinesOf(turn: TurnSummary): readonly string[] {
  const usage = turn.usage;
  if (usage === null) return [];
  const lines = [
    t("desktop.convo.foot.input", { n: usage.input }),
    t("desktop.convo.foot.output", { n: usage.output }),
  ];
  if (usage.cacheRead + usage.cacheWrite > 0) {
    lines.push(t("desktop.convo.foot.cache", { read: usage.cacheRead, write: usage.cacheWrite }));
  }
  if (usage.cost !== null && usage.cost > 0)
    lines.push(t("desktop.convo.foot.cost", { cost: usage.cost }));
  return lines;
}

/** 멈춘 사유 안내. 계속할 수 있으면 `canContinue` */
export type StopNotice = {
  readonly text: string;
  readonly canContinue: boolean;
  readonly tone: "warning" | "quiet";
};

export function stopNoticeOf(turn: TurnSummary): StopNotice | null {
  const end = turn.end;
  if (end?.kind === "limit") {
    return {
      text:
        end.limit === "step_limit"
          ? t("desktop.convo.stop.stepLimit", { steps: turn.steps })
          : t("desktop.convo.stop.childLimit"),
      canContinue: true,
      tone: "warning",
    };
  }
  // 알림은 되풀이와 검사 한도 두 가지다. 먼저 온 것을 보인다
  const notice = turn.notices[0];
  if (notice !== undefined) {
    if (notice.code === "repeat_detected") {
      return {
        text:
          notice.count === null
            ? t("desktop.convo.stop.repeat")
            : t("desktop.convo.stop.repeatCount", { count: notice.count }),
        canContinue: true,
        tone: "warning",
      };
    }
    return {
      text:
        notice.limit === null
          ? t("desktop.convo.stop.gate")
          : t("desktop.convo.stop.gateCount", { limit: notice.limit }),
      canContinue: true,
      tone: "warning",
    };
  }
  if (end?.kind === "interrupted") {
    return {
      text:
        end.code === "user" || end.code === null
          ? t("desktop.convo.stop.user")
          : t("desktop.convo.stop.interrupted"),
      canContinue: false,
      tone: "quiet",
    };
  }
  return null;
}

/** 변화 표지 한 줄 */
export function markerTextOf(marker: ConvoMarker): string {
  const change = marker.change;
  switch (change.kind) {
    case "model":
      return t("desktop.convo.marker.model", { model: change.model });
    case "permission_mode":
      return change.value === null
        ? t("desktop.convo.marker.permissionReset")
        : t("desktop.convo.marker.permission", { mode: change.value });
    case "resumed":
      return change.mode === "auto"
        ? t("desktop.convo.marker.resumedAuto", { attempt: change.attempt })
        : t("desktop.convo.marker.resumed");
    case "scheduled_start":
      return t("desktop.convo.marker.scheduled");
    case "leaf_moved":
      return change.reason === "branch"
        ? t("desktop.convo.marker.branched")
        : change.reason === "restore"
          ? t("desktop.convo.marker.restored")
          : t("desktop.convo.marker.rewound");
    case "branch_summarized":
      return t("desktop.convo.marker.branchSummarized");
    default:
      return assertNever(change, "ConvoMarker");
  }
}

/** 시각 "14:02" */
export function clockOf(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  return t("desktop.convo.clock", { at: new Date(at) });
}

export type LeadMeter = { readonly text: string; readonly warn: boolean };

/** 주도 구간 한도 칸: "턴 3/8", "토큰 1.2만/5만", "위임 1/3". 한도가 없는 칸은 뺀다. 90%를 넘으면 경고 */
export function leadMetersOf(lead: LeadSegment): readonly LeadMeter[] {
  const out: LeadMeter[] = [];
  const meter = (
    used: number,
    max: number | undefined,
    id: "turns" | "tokens" | "spawns",
  ): void => {
    if (max === undefined) return;
    const warn = max > 0 && used / max >= 0.9;
    if (id === "turns") out.push({ text: t("desktop.convo.lead.turns", { used, max }), warn });
    if (id === "tokens") out.push({ text: t("desktop.convo.lead.tokens", { used, max }), warn });
    if (id === "spawns") out.push({ text: t("desktop.convo.lead.spawns", { used, max }), warn });
  };
  meter(lead.used.turns, lead.limits.maxTurns, "turns");
  meter(lead.used.tokens, lead.limits.maxTokens, "tokens");
  meter(lead.used.spawns, lead.limits.maxSpawns, "spawns");
  return out;
}

/** 주도자 이름. scope id의 접두(`ext:`)를 뗀다 */
export function leaderNameOf(scopeId: string): string {
  return scopeId.replace(/^ext:/, "");
}

export function releaseTextOf(lead: LeadSegment): string {
  const name = leaderNameOf(lead.scopeId);
  switch (lead.releaseReason) {
    case "budget":
      return t("desktop.convo.lead.release.budget", { name });
    case "idle":
      return t("desktop.convo.lead.release.idle", { name });
    case "waiting":
      return t("desktop.convo.lead.release.waiting", { name });
    case "error":
      return t("desktop.convo.lead.release.error", { name });
    case "disabled":
    case "revoked":
      return t("desktop.convo.lead.release.revoked", { name });
    case "restart":
      return t("desktop.convo.lead.release.restart", { name });
    case null:
      return t("desktop.convo.lead.release.done", { name });
    default:
      return assertNever(lead.releaseReason, "LeaseReleaseReason");
  }
}
